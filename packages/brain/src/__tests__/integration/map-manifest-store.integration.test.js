import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { activateMapManifest, submitMapManifest } from '../../lib/map-manifest-store.js';
import {
  activateManifest,
  computeManifestDigest,
  submitManifestDraft,
} from '../../map/manifest-store.js';
import { runProjection } from '../../map/projector.js';
import { DB_DEFAULTS } from '../../db-config.js';

const testConnectionString = process.env.TEST_DATABASE_URL;
const databaseName = testConnectionString
  ? decodeURIComponent(new URL(testConnectionString).pathname.slice(1))
  : DB_DEFAULTS.database;
if (!/(_test|_scratch)$/.test(databaseName)) {
  throw new Error(`Map manifest integration test 拒绝连接非测试库: ${databaseName}`);
}

const fixtureUrl = new URL('../../../config/map-manifests/cecelia.v1.json', import.meta.url);
const baseManifest = JSON.parse(readFileSync(fixtureUrl, 'utf8'));
const pool = new pg.Pool(testConnectionString
  ? { connectionString: testConnectionString, max: 4 }
  : { ...DB_DEFAULTS, max: 4 });
const decisionId = randomUUID();
const scopePrefix = `map-manifest-itest-${process.pid}`;
const baseRevision = 'a'.repeat(40);

function manifest(name = '工厂', scopeKey = `${scopePrefix}-default`) {
  return {
    ...structuredClone(baseManifest),
    scope_key: scopeKey,
    source_decision_id: decisionId,
    value_streams: [
      { ...baseManifest.value_streams[0], name },
      ...structuredClone(baseManifest.value_streams.slice(1)),
    ],
  };
}

beforeAll(async () => {
  await pool.query('DELETE FROM map_projection_runs WHERE scope_key LIKE $1', [`${scopePrefix}-%`]);
  await pool.query('DELETE FROM map_manifest_versions WHERE scope_key LIKE $1', [`${scopePrefix}-%`]);
  await pool.query('DELETE FROM decisions WHERE id = $1', [decisionId]);
  await pool.query(
    `INSERT INTO decisions
      (id, category, topic, decision, reason, status, author, made_by, priority)
     VALUES ($1, 'feature', 'map-manifest-integration', 'integration fixture',
       'verify immutable manifests', 'active', 'codex', 'user', 'P2')`,
    [decisionId],
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM map_projection_runs WHERE scope_key LIKE $1', [`${scopePrefix}-%`]);
  await pool.query('DELETE FROM map_manifest_versions WHERE scope_key LIKE $1', [`${scopePrefix}-%`]);
  await pool.query('DELETE FROM decisions WHERE id = $1', [decisionId]);
  await pool.end();
});

describe('Map Manifest Store — 真实 PostgreSQL', () => {
  it('同一完整 manifest 并发提交只创建一个 draft/version', async () => {
    const scopeKey = `${scopePrefix}-concurrent`;
    const [left, right] = await Promise.all([
      submitMapManifest(pool, manifest('工厂', scopeKey)),
      submitMapManifest(pool, manifest('工厂', scopeKey)),
    ]);

    expect(left.manifest_version.id).toBe(right.manifest_version.id);
    expect([left.created, right.created].sort()).toEqual([false, true]);
    const { rows } = await pool.query(
      `SELECT version, status, count(*) OVER ()::int AS total
         FROM map_manifest_versions WHERE scope_key = $1`,
      [scopeKey],
    );
    expect(rows).toEqual([{ version: 1, status: 'draft', total: 1 }]);
  });

  it('正式 Map 路由 store 串行化同 scope 的不同 digest 并发版本号', async () => {
    const scopeKey = `${scopePrefix}-route-concurrent`;
    const [first, second] = await Promise.all([
      submitManifestDraft({
        scopeKey,
        manifest: manifest('路由并发一', scopeKey),
        sourceDecisionId: decisionId,
      }, { db: pool }),
      submitManifestDraft({
        scopeKey,
        manifest: manifest('路由并发二', scopeKey),
        sourceDecisionId: decisionId,
      }, { db: pool }),
    ]);

    expect([first.version, second.version].sort()).toEqual([1, 2]);
  });

  it('不同 digest 单调增加版本，数据库 trigger 拒绝修改完整 manifest', async () => {
    const scopeKey = `${scopePrefix}-versioning`;
    await submitMapManifest(pool, manifest('工厂', scopeKey));
    const second = await submitMapManifest(pool, manifest('软件工厂', scopeKey));
    expect(second).toMatchObject({ created: true, manifest_version: { version: 2, status: 'draft' } });

    await expect(pool.query(
      `UPDATE map_manifest_versions SET manifest = manifest || '{"consumer_color":"green"}'::jsonb
        WHERE id = $1`,
      [second.manifest_version.id],
    )).rejects.toMatchObject({ code: 'P0001' });
  });

  it('projector 与 active 切换同事务；失败保留旧 active，成功后只留一个 active', async () => {
    const scopeKey = `${scopePrefix}-activation`;
    const { manifest_version: first } = await submitMapManifest(pool, manifest('工厂', scopeKey));
    const firstActive = await activateMapManifest(pool, first.id, {
      projector: async ({ client, manifestVersion }) => {
        const { rows } = await client.query('SELECT $1::text AS projected', [manifestVersion.digest]);
        expect(rows[0].projected).toBe(manifestVersion.digest);
      },
    });
    expect(firstActive.manifest_version.status).toBe('active');

    const { manifest_version: second } = await submitMapManifest(pool, manifest('软件工厂', scopeKey));
    await expect(activateMapManifest(pool, second.id, {
      projector: async () => { throw new Error('projection failed'); },
    })).rejects.toThrow('projection failed');

    let statuses = await pool.query(
      'SELECT version, status FROM map_manifest_versions WHERE scope_key=$1 ORDER BY version',
      [scopeKey],
    );
    expect(statuses.rows).toEqual([
      { version: 1, status: 'active' },
      { version: 2, status: 'draft' },
    ]);

    const secondActive = await activateMapManifest(pool, second.id, { projector: async () => {} });
    expect(secondActive.manifest_version.status).toBe('active');
    statuses = await pool.query(
      'SELECT version, status FROM map_manifest_versions WHERE scope_key=$1 ORDER BY version',
      [scopeKey],
    );
    expect(statuses.rows).toEqual([
      { version: 1, status: 'superseded' },
      { version: 2, status: 'active' },
    ]);
  });

  it('正式 Map 路由 store 在同一 PostgreSQL 事务切换 manifest 与 projection', async () => {
    const scopeKey = `${scopePrefix}-route-atomic`;
    const input = manifest('原子地图', scopeKey);
    const digest = computeManifestDigest(input);
    const { rows: inserted } = await pool.query(
      `INSERT INTO map_manifest_versions
         (scope_key, version, source_decision_id, manifest, digest, status)
       VALUES ($1, 1, $2, $3::jsonb, $4, 'draft')
       RETURNING id`,
      [scopeKey, decisionId, JSON.stringify(input), digest],
    );
    const manifestId = inserted[0].id;

    await expect(activateManifest({ manifestId, scopeKey }, {
      db: pool,
      projector: async () => { throw new Error('projection transaction failed'); },
    })).rejects.toThrow('projection transaction failed');
    expect((await pool.query(
      'SELECT status FROM map_manifest_versions WHERE id=$1', [manifestId],
    )).rows[0].status).toBe('draft');

    const activated = await activateManifest({ manifestId, scopeKey }, {
      db: pool,
      projector: ({ client, manifestVersion }) => runProjection({
        client,
        manifestId: manifestVersion.id,
        manifestDigest: manifestVersion.digest,
        scopeKey,
        manifest: manifestVersion.manifest,
        factRevisions: { [scopeKey]: baseRevision },
      }),
    });

    expect(activated).toMatchObject({ status: 'active' });
    const state = await pool.query(
      `SELECT manifest.status AS manifest_status,
              projection.status AS projection_status,
              projection.manifest_version_id,
              projection.manifest_digest
         FROM map_manifest_versions AS manifest
         JOIN map_projection_runs AS projection
           ON projection.manifest_version_id = manifest.id
        WHERE manifest.id = $1`,
      [manifestId],
    );
    expect(state.rows).toEqual([{
      manifest_status: 'active',
      projection_status: 'active',
      manifest_version_id: manifestId,
      manifest_digest: digest,
    }]);
  });
});
