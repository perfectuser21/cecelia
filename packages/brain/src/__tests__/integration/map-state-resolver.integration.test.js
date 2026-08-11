import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { DB_DEFAULTS } from '../../db-config.js';
import { digestMapManifest } from '../../lib/map-manifest-schema.js';
import { loadMapImpactRadius } from '../../lib/map-impact-radius.js';
import { projectMapManifest } from '../../lib/map-projection-store.js';
import {
  readHealth,
  readMap,
  readNode,
  readRadius,
  readUnclaimed,
} from '../../lib/map-read-service.js';
import { loadMapNodeStates } from '../../lib/map-state-resolver.js';

const testConnectionString = process.env.TEST_DATABASE_URL;
const databaseName = testConnectionString
  ? decodeURIComponent(new URL(testConnectionString).pathname.slice(1))
  : DB_DEFAULTS.database;
if (!/(_test|_scratch)$/.test(databaseName)) {
  throw new Error(`Map state integration test 拒绝连接非测试库: ${databaseName}`);
}

const fixtureManifest = JSON.parse(readFileSync(
  new URL('../../../config/map-manifests/cecelia.v1.json', import.meta.url),
  'utf8',
));
const pool = new pg.Pool(testConnectionString
  ? { connectionString: testConnectionString, max: 2 }
  : { ...DB_DEFAULTS, max: 2 });
const scopeKey = `map-state-itest-${process.pid}-${randomUUID().slice(0, 8)}`;
const repo = `${scopeKey}-repo`;
const capabilityKey = `IT_${randomUUID().replaceAll('-', '')}`;
const testPath = `tests/${randomUUID()}.test.js`;
const sourcePath = `src/${randomUUID()}.js`;
const revision = 'a'.repeat(40);
const now = new Date();
let client;
let assertionId;
let featureId;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function insertReceipt({ verdict, completedAt, exitCode }) {
  await client.query(
    `INSERT INTO journey_assertion_receipts (
      journey_step_link_id, run_id, assertion_revision, assertion_ref_snapshot,
      assertion_digest, source_repo, source_sha, command_argv, verdict, exit_code,
      scenario_count, scenario_evidence, machine_id, output_digest, output_tail,
      started_at, completed_at
    ) VALUES (
      $1,$2,1,$3,$4,$5,$6,$7::jsonb,$8,$9,1,$10::jsonb,
      'map-state-integration',$11,'integration receipt',$12,$13
    )`,
    [
      assertionId,
      `${scopeKey}-${verdict}-${randomUUID()}`,
      testPath,
      digest(testPath),
      repo,
      revision,
      JSON.stringify(['npx', 'vitest', 'run', testPath]),
      verdict,
      exitCode,
      JSON.stringify({ kind: 'vitest', scenario: testPath }),
      digest(`${verdict}-${completedAt.toISOString()}`),
      new Date(completedAt.getTime() - 1000),
      completedAt,
    ],
  );
}

beforeAll(async () => {
  client = await pool.connect();
  await client.query('BEGIN');
  const decisionId = randomUUID();
  await client.query(
    `INSERT INTO decisions
      (id, category, topic, decision, reason, status, author, made_by, priority)
     VALUES ($1, 'feature', $2, 'state fixture', 'query-time state proof',
       'active', 'codex', 'user', 'P2')`,
    [decisionId, scopeKey],
  );
  await client.query(
    `INSERT INTO map_scope_repositories
      (scope_key, repo, adapter_key, adapter_config)
     VALUES ($1, $2, 'legacy-ledger-v1',
       '{"ledger_partition":"infrastructure"}'::jsonb)`,
    [scopeKey, repo],
  );
  const journey = await client.query(
    `INSERT INTO journeys (name, biz_area, capability_code)
     VALUES ($1, 'infrastructure', $2) RETURNING id`,
    [scopeKey, capabilityKey],
  );
  const step = await client.query(
    `INSERT INTO journey_steps (journey_id, name, step_number)
     VALUES ($1, 'state step', 1) RETURNING id`,
    [journey.rows[0].id],
  );
  const feature = await client.query(
    `INSERT INTO journey_features (journey_id, step_id, name, unit_test_path)
     VALUES ($1, $2, 'state feature', $3) RETURNING id`,
    [journey.rows[0].id, step.rows[0].id, testPath],
  );
  featureId = feature.rows[0].id;
  const assertion = await client.query(
    `INSERT INTO journey_step_links
      (journey_id, step_id, feature_id, cell_kind, cell_key, cell_status, assertion_ref)
     VALUES ($1, $2, $3, 'capability', $4, 'green', $5) RETURNING id`,
    [journey.rows[0].id, step.rows[0].id, featureId, capabilityKey, testPath],
  );
  assertionId = assertion.rows[0].id;
  await client.query(
    `INSERT INTO test_registry
      (repo, file_path, source_revision, scanner_version, scanned_at)
     VALUES ($1, $2, $3, 'test-registry-v2', $4)`,
    [repo, testPath, revision, now],
  );
  await client.query(
    `INSERT INTO fact_snapshot_headers
      (kind, repo, source_revision, scanner_version, scanned_at, row_count)
     VALUES ('test', $1, $2, 'test-registry-v2', $3, 1)`,
    [repo, revision, now],
  );
  await client.query(
    `INSERT INTO graph_edges
      (repo, src_path, dst_path, edge_type, source_revision, scanner_version, scanned_at)
     VALUES ($1, $2, $3, 'import', $4, 'graph-v3', $5)`,
    [repo, testPath, sourcePath, revision, now],
  );
  await client.query(
    `INSERT INTO fact_snapshot_headers
      (kind, repo, source_revision, scanner_version, scanned_at, row_count)
     VALUES ('graph', $1, $2, 'graph-v3', $3, 1)`,
    [repo, revision, now],
  );
  await client.query(
    `INSERT INTO fact_snapshot_headers
      (kind, repo, source_revision, scanner_version, scanned_at, row_count)
     VALUES
      ('api', $1, $2, 'api-registry-v2', $3, 0),
      ('db_schema', $1, $2, 'db-schema-v2', $3, 0)`,
    [repo, revision, now],
  );

  const manifest = structuredClone(fixtureManifest);
  manifest.scope_key = scopeKey;
  manifest.source_decision_id = decisionId;
  const oldCapabilityKey = manifest.capabilities[0].key;
  manifest.capabilities[0].key = capabilityKey;
  manifest.boundaries = manifest.boundaries.map((boundary) => ({
    ...boundary,
    from: boundary.from === oldCapabilityKey ? capabilityKey : boundary.from,
    to: boundary.to === oldCapabilityKey ? capabilityKey : boundary.to,
  }));
  const manifestDigest = digestMapManifest(manifest);
  const version = await client.query(
    `INSERT INTO map_manifest_versions
      (scope_key, version, source_decision_id, manifest, digest, status, activated_at)
     VALUES ($1, 1, $2, $3::jsonb, $4, 'active', NOW())
     RETURNING id, scope_key, version, source_decision_id, manifest, digest,
               status, created_at, activated_at`,
    [scopeKey, decisionId, JSON.stringify(manifest), manifestDigest],
  );
  await projectMapManifest({ client, manifestVersion: version.rows[0] });
  await insertReceipt({ verdict: 'PASS', completedAt: new Date(now.getTime() + 1000), exitCode: 0 });
});

afterAll(async () => {
  if (client) {
    await client.query('ROLLBACK');
    client.release();
  }
  await pool.end();
});

function findState(result, nodeKey) {
  return result.states.find((item) => item.node_key === nodeKey);
}

describe('Map State Resolver — 真实 PostgreSQL', () => {
  it('同一 active projection 现算 green→gray→red→unknown，完全忽略 cell_status', async () => {
    const green = await loadMapNodeStates(client, { scopeKey, now: new Date(now.getTime() + 2000) });
    expect(findState(green, assertionId)).toMatchObject({ status: 'green', reason_code: 'receipt_pass' });
    expect(findState(green, featureId)).toMatchObject({ status: 'green' });
    expect(findState(green, capabilityKey)).toMatchObject({ status: 'green' });

    await client.query('DELETE FROM test_registry WHERE repo=$1 AND file_path=$2', [repo, testPath]);
    await client.query(
      `UPDATE fact_snapshot_headers SET scanned_at=$3, row_count=0
        WHERE kind='test' AND repo=$1 AND source_revision=$2`,
      [repo, revision, new Date(now.getTime() + 3000)],
    );
    const gray = await loadMapNodeStates(client, { scopeKey, now: new Date(now.getTime() + 4000) });
    expect(findState(gray, assertionId)).toMatchObject({
      status: 'gray', reason_code: 'anchor_target_missing',
    });

    await client.query(
      `INSERT INTO test_registry
        (repo, file_path, source_revision, scanner_version, scanned_at)
       VALUES ($1, $2, $3, 'test-registry-v2', $4)`,
      [repo, testPath, revision, new Date(now.getTime() + 5000)],
    );
    await client.query(
      `UPDATE fact_snapshot_headers SET scanned_at=$3, row_count=1
        WHERE kind='test' AND repo=$1 AND source_revision=$2`,
      [repo, revision, new Date(now.getTime() + 5000)],
    );
    await insertReceipt({
      verdict: 'FAIL', completedAt: new Date(now.getTime() + 6000), exitCode: 1,
    });
    const red = await loadMapNodeStates(client, { scopeKey, now: new Date(now.getTime() + 7000) });
    expect(findState(red, assertionId)).toMatchObject({ status: 'red', reason_code: 'receipt_fail' });

    await client.query(
      `UPDATE fact_snapshot_headers SET scanned_at=$2
        WHERE kind='test' AND repo=$1`,
      [repo, new Date(now.getTime() - 16 * 60_000)],
    );
    const unknown = await loadMapNodeStates(client, {
      scopeKey, now: new Date(now.getTime() + 7000),
    });
    expect(findState(unknown, assertionId)).toMatchObject({
      status: 'unknown', reason_code: 'snapshot_stale',
    });
  });

  it('真实 graph snapshot 按 repo 回溯到业务节点和必跑断言，Cross-cut radius 非空', async () => {
    const radius = await loadMapImpactRadius(client, {
      scopeKey,
      repo,
      changedFiles: [sourcePath],
      now: new Date(now.getTime() + 7000),
    });
    expect(radius.freshness).toMatchObject({ status: 'fresh', source_revision: revision });
    expect(radius.affected_tests).toEqual([testPath]);
    expect(radius.affected_business_nodes.map(({ node_key }) => node_key)).toEqual(
      expect.arrayContaining([capabilityKey, featureId]),
    );
    expect(radius.must_run_assertions).toEqual([
      { node_key: assertionId, assertion_ref: testPath },
    ]);

    const crosscut = await loadMapImpactRadius(client, {
      scopeKey,
      repo,
      startNodeKeys: ['heartbeat_bus'],
      now: new Date(now.getTime() + 7000),
    });
    expect(crosscut.affected_business_nodes.length).toBeGreaterThan(1);
    expect(crosscut.affected_business_nodes.map(({ node_key }) => node_key))
      .toContain('heartbeat_bus');
  });

  it('Unified Map 五个读服务在同一真实 projection 上返回一致 envelope 与精确结构', async () => {
    const readAt = new Date(now.getTime() + 7000);
    await client.query(
      'UPDATE fact_snapshot_headers SET scanned_at=$2 WHERE repo=$1',
      [repo, new Date(readAt.getTime() - 1000)],
    );
    const map = await readMap(client, { scopeKey, now: readAt });

    expect(map).toMatchObject({
      scope_key: scopeKey,
      manifest_version: 1,
      manifest_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      projection_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      fact_revisions: { [repo]: revision },
      generated_at: readAt.toISOString(),
      freshness: { status: 'fresh' },
      summary: {
        value_streams: 2,
        capabilities: 11,
        boundaries: 2,
        crosscuts: 7,
        prerequisites: 0,
      },
      shared_prerequisites: { applicable: false },
    });

    const detail = await readNode(client, {
      scopeKey, nodeKey: capabilityKey, now: readAt,
    });
    expect(detail).toMatchObject({
      scope_key: scopeKey,
      manifest_digest: map.manifest_digest,
      projection_digest: map.projection_digest,
      node: { key: capabilityKey, type: 'capability' },
    });
    expect(detail.boundaries).toHaveLength(1);

    const crosscut = await readNode(client, {
      scopeKey, nodeKey: 'heartbeat_bus', now: readAt,
    });
    expect(crosscut.affected_nodes.length).toBeGreaterThan(0);
    expect(crosscut.affected_nodes.map(({ key }) => key)).toEqual(['butler', 'factory']);
    expect(crosscut.affected_nodes.every(({ type }) => type === 'value_stream')).toBe(true);

    const radius = await readRadius(client, {
      scopeKey,
      repo,
      changedFiles: [sourcePath],
      startNodeKeys: [],
      maxDepth: 10,
      now: readAt,
    });
    expect(radius).toMatchObject({
      scope_key: scopeKey,
      manifest_digest: map.manifest_digest,
      projection_digest: map.projection_digest,
      freshness: { status: 'fresh' },
    });
    expect(radius.must_run_assertions).toEqual([
      { node_key: assertionId, assertion_ref: testPath },
    ]);

    const health = await readHealth(client, { scopeKey, now: readAt });
    expect(health).toMatchObject({
      scope_key: scopeKey,
      manifest_digest: map.manifest_digest,
      projection_digest: map.projection_digest,
      overall: 'healthy',
      freshness: { status: 'fresh' },
    });

    const unclaimed = await readUnclaimed(client, { scopeKey, now: readAt });
    expect(unclaimed).toMatchObject({
      scope_key: scopeKey,
      manifest_digest: map.manifest_digest,
      projection_digest: map.projection_digest,
      freshness: { status: 'fresh' },
    });
    expect(unclaimed.unclaimed).toEqual(expect.arrayContaining([
      expect.objectContaining({ repo, fact_kind: 'graph', stable_ref: sourcePath }),
    ]));
  });
});
