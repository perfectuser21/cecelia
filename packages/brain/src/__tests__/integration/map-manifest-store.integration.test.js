import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { activateMapManifest, submitMapManifest } from '../../lib/map-manifest-store.js';

const connectionString = process.env.TEST_DATABASE_URL || 'postgresql://localhost/cecelia_test';
const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
if (!/(_test|_scratch)$/.test(databaseName)) {
  throw new Error(`Map manifest integration test 拒绝连接非测试库: ${databaseName}`);
}

const fixtureUrl = new URL('../../../config/map-manifests/cecelia.v1.json', import.meta.url);
const baseManifest = JSON.parse(readFileSync(fixtureUrl, 'utf8'));
const pool = new pg.Pool({ connectionString, max: 4 });
const decisionId = randomUUID();
const scopeKey = `map-manifest-itest-${process.pid}`;

function manifest(name = '工厂') {
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
  await pool.query('DELETE FROM map_manifest_versions WHERE scope_key = $1', [scopeKey]);
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
  await pool.query('DELETE FROM map_manifest_versions WHERE scope_key = $1', [scopeKey]);
  await pool.query('DELETE FROM decisions WHERE id = $1', [decisionId]);
  await pool.end();
});

describe('Map Manifest Store — 真实 PostgreSQL', () => {
  it('同一完整 manifest 并发提交只创建一个 draft/version', async () => {
    const [left, right] = await Promise.all([
      submitMapManifest(pool, manifest()),
      submitMapManifest(pool, manifest()),
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

  it('不同 digest 单调增加版本，数据库 trigger 拒绝修改完整 manifest', async () => {
    const second = await submitMapManifest(pool, manifest('软件工厂'));
    expect(second).toMatchObject({ created: true, manifest_version: { version: 2, status: 'draft' } });

    await expect(pool.query(
      `UPDATE map_manifest_versions SET manifest = manifest || '{"consumer_color":"green"}'::jsonb
        WHERE id = $1`,
      [second.manifest_version.id],
    )).rejects.toMatchObject({ code: 'P0001' });
  });

  it('projector 与 active 切换同事务；失败保留旧 active，成功后只留一个 active', async () => {
    const { manifest_version: first } = await submitMapManifest(pool, manifest());
    const firstActive = await activateMapManifest(pool, first.id, {
      projector: async ({ client, manifestVersion }) => {
        const { rows } = await client.query('SELECT $1::text AS projected', [manifestVersion.digest]);
        expect(rows[0].projected).toBe(manifestVersion.digest);
      },
    });
    expect(firstActive.manifest_version.status).toBe('active');

    const { manifest_version: second } = await submitMapManifest(pool, manifest('软件工厂'));
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
});
