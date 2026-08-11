import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { activateMapManifest, submitMapManifest } from '../../lib/map-manifest-store.js';
import { buildMapProjection } from '../../lib/map-projector.js';
import { projectMapManifest } from '../../lib/map-projection-store.js';
import { DB_DEFAULTS } from '../../db-config.js';

const testConnectionString = process.env.TEST_DATABASE_URL;
const databaseName = testConnectionString
  ? decodeURIComponent(new URL(testConnectionString).pathname.slice(1))
  : DB_DEFAULTS.database;
if (!/(_test|_scratch)$/.test(databaseName)) {
  throw new Error(`Map projection integration test 拒绝连接非测试库: ${databaseName}`);
}

const fixture = JSON.parse(readFileSync(
  new URL('../../../config/map-manifests/cecelia.v1.json', import.meta.url),
  'utf8',
));
const pool = new pg.Pool(testConnectionString
  ? { connectionString: testConnectionString, max: 4 }
  : { ...DB_DEFAULTS, max: 4 });
const decisionId = randomUUID();
const scopePrefix = `map-projection-itest-${process.pid}-${randomUUID().slice(0, 8)}`;

function manifest(scopeKey, streamName = '工厂') {
  const input = structuredClone(fixture);
  input.scope_key = scopeKey;
  input.source_decision_id = decisionId;
  input.value_streams[0].name = streamName;
  return input;
}

async function deleteFixtures() {
  await pool.query('DELETE FROM map_projection_runs WHERE scope_key LIKE $1', [`${scopePrefix}%`]);
  await pool.query('DELETE FROM map_manifest_versions WHERE scope_key LIKE $1', [`${scopePrefix}%`]);
}

beforeAll(async () => {
  await deleteFixtures();
  await pool.query('DELETE FROM decisions WHERE id=$1', [decisionId]);
  await pool.query(
    `INSERT INTO decisions
      (id, category, topic, decision, reason, status, author, made_by, priority)
     VALUES ($1, 'feature', 'map-projection-integration', 'integration fixture',
       'verify atomic projection', 'active', 'codex', 'user', 'P2')`,
    [decisionId],
  );
});

afterAll(async () => {
  await deleteFixtures();
  await pool.query('DELETE FROM decisions WHERE id=$1', [decisionId]);
  await pool.end();
});

describe('Map Projection Store — 真实 PostgreSQL', () => {
  it('默认 Manifest 激活一次原子生成 20 节点与 31 边', async () => {
    const scopeKey = `${scopePrefix}-activate`;
    const { manifest_version: draft } = await submitMapManifest(pool, manifest(scopeKey));

    const activated = await activateMapManifest(pool, draft.id);
    expect(activated).toMatchObject({ activated: true, manifest_version: { status: 'active' } });

    const { rows } = await pool.query(
      `SELECT r.id, r.status, r.projection_digest,
              count(DISTINCT n.node_id)::int AS node_count,
              count(DISTINCT e.edge_id)::int AS edge_count
         FROM map_projection_runs r
         LEFT JOIN map_projection_nodes n ON n.run_id=r.id
         LEFT JOIN map_projection_edges e ON e.run_id=r.id
        WHERE r.scope_key=$1
        GROUP BY r.id, r.status, r.projection_digest`,
      [scopeKey],
    );
    expect(rows).toEqual([expect.objectContaining({
      status: 'active', node_count: 20, edge_count: 31,
    })]);
    expect(rows[0].projection_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('相同 manifest/facts 重建得到同 digest 与同 stable IDs', async () => {
    const scopeKey = `${scopePrefix}-rebuild`;
    const input = manifest(scopeKey);
    const { manifest_version: draft } = await submitMapManifest(pool, input);
    await activateMapManifest(pool, draft.id);

    const before = await pool.query(
      `SELECT r.projection_digest, array_agg(n.node_id ORDER BY n.node_id) AS node_ids
         FROM map_projection_runs r JOIN map_projection_nodes n ON n.run_id=r.id
        WHERE r.scope_key=$1 AND r.status='active'
        GROUP BY r.id, r.projection_digest`,
      [scopeKey],
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await projectMapManifest({ client, manifestVersion: draft });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const after = await pool.query(
      `SELECT r.projection_digest, array_agg(n.node_id ORDER BY n.node_id) AS node_ids
         FROM map_projection_runs r JOIN map_projection_nodes n ON n.run_id=r.id
        WHERE r.scope_key=$1 AND r.status='active'
        GROUP BY r.id, r.projection_digest`,
      [scopeKey],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    const statuses = await pool.query(
      `SELECT status, count(*)::int AS count FROM map_projection_runs
        WHERE scope_key=$1 GROUP BY status ORDER BY status`,
      [scopeKey],
    );
    expect(statuses.rows).toEqual([
      { status: 'active', count: 1 },
      { status: 'superseded', count: 1 },
    ]);
  });

  it('旧 manifest 缓存不能在新版本激活后抢回 active projection', async () => {
    const scopeKey = `${scopePrefix}-stale-rebuild`;
    const { manifest_version: first } = await submitMapManifest(pool, manifest(scopeKey));
    await activateMapManifest(pool, first.id);
    const { manifest_version: second } = await submitMapManifest(
      pool,
      manifest(scopeKey, '第二版工厂'),
    );
    await activateMapManifest(pool, second.id);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(projectMapManifest({ client, manifestVersion: first })).rejects.toMatchObject({
        code: 'MAP_PROJECTION_MANIFEST_STALE',
      });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const activeManifest = await pool.query(
      `SELECT id FROM map_manifest_versions WHERE scope_key=$1 AND status='active'`,
      [scopeKey],
    );
    const activeProjection = await pool.query(
      `SELECT manifest_version_id FROM map_projection_runs WHERE scope_key=$1 AND status='active'`,
      [scopeKey],
    );
    expect(activeManifest.rows).toEqual([{ id: second.id }]);
    expect(activeProjection.rows).toEqual([{ manifest_version_id: second.id }]);
  });

  it('数据库拒绝 run 伪造 manifest scope 或 digest provenance', async () => {
    const scopeKey = `${scopePrefix}-provenance`;
    const { manifest_version: version } = await submitMapManifest(pool, manifest(scopeKey));

    await expect(pool.query(
      `INSERT INTO map_projection_runs
        (scope_key, manifest_version_id, manifest_digest, fact_revisions,
         projector_version, projection_digest, status)
       VALUES ($1, $2, $3, '{}'::jsonb, 'map-projector-v1', $4, 'building')`,
      [`${scopeKey}-forged`, version.id, 'f'.repeat(64), 'e'.repeat(64)],
    )).rejects.toMatchObject({ code: '23503' });
  });

  it('真实激活把 Cross-cut serves 连接到 Capability 节点', async () => {
    const scopeKey = `${scopePrefix}-capability-serves`;
    const input = manifest(scopeKey);
    input.crosscut_pool[0].serves = ['F1'];
    const { manifest_version: draft } = await submitMapManifest(pool, input);
    await activateMapManifest(pool, draft.id);

    const { rows } = await pool.query(
      `SELECT target.node_type
         FROM map_projection_runs run
         JOIN map_projection_edges edge ON edge.run_id=run.id AND edge.edge_type='serves'
         JOIN map_projection_nodes target
           ON target.run_id=edge.run_id AND target.node_id=edge.to_node_id
        WHERE run.scope_key=$1 AND run.status='active'
          AND edge.edge_key=$2`,
      [scopeKey, `${input.crosscut_pool[0].key}:F1`],
    );
    expect(rows).toEqual([{ node_type: 'capability' }]);
  });

  it('边写入失败时 Manifest 与旧完整 projection 均保持 active', async () => {
    const scopeKey = `${scopePrefix}-rollback`;
    const { manifest_version: first } = await submitMapManifest(pool, manifest(scopeKey));
    await activateMapManifest(pool, first.id);
    const { manifest_version: second } = await submitMapManifest(
      pool,
      manifest(scopeKey, '改名后的工厂'),
    );

    await expect(activateMapManifest(pool, second.id, {
      projector: (args) => projectMapManifest({
        ...args,
        buildProjection: (buildArgs) => {
          const projection = buildMapProjection(buildArgs);
          projection.edges[0] = { ...projection.edges[0], to_node_id: 'f'.repeat(64) };
          return projection;
        },
      }),
    })).rejects.toMatchObject({ code: '23503' });

    const manifests = await pool.query(
      `SELECT version, status FROM map_manifest_versions
        WHERE scope_key=$1 ORDER BY version`,
      [scopeKey],
    );
    expect(manifests.rows).toEqual([
      { version: 1, status: 'active' },
      { version: 2, status: 'draft' },
    ]);
    const projection = await pool.query(
      `SELECT r.status, count(DISTINCT n.node_id)::int AS node_count,
              count(DISTINCT e.edge_id)::int AS edge_count
         FROM map_projection_runs r
         JOIN map_projection_nodes n ON n.run_id=r.id
         JOIN map_projection_edges e ON e.run_id=r.id
        WHERE r.scope_key=$1 GROUP BY r.id, r.status`,
      [scopeKey],
    );
    expect(projection.rows).toEqual([{ status: 'active', node_count: 20, edge_count: 31 }]);
  });
});
