import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import pool from '../../db.js';
import { resolveImpactRadius } from '../../map/radius.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePg = testDatabaseUrl ? describe : describe.skip;
const baseRevision = 'a'.repeat(40);
const headRevision = 'b'.repeat(40);
const manifestDigest = '1'.repeat(64);
const projectionDigest = '2'.repeat(64);
const capabilityJourneyId = 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29';
const changedFile = 'packages/brain/src/routes/map.js';
const assertionRef = 'packages/brain/src/impact-contract/__tests__/diff-gate.test.js';
const assertionDigest = createHash('sha256').update(assertionRef).digest('hex');

describePg('Map radius × Impact Contract [PostgreSQL]', () => {
  let client;
  let linkId;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    const featureId = randomUUID();
    const stepId = randomUUID();
    linkId = randomUUID();
    await client.query(
      `INSERT INTO journey_steps (id, journey_id, name, step_number, status)
       VALUES ($1, $2, $3, $4, 'planned')`,
      [stepId, capabilityJourneyId, `map-radius-${process.pid}`, 900_000 + (process.pid % 90_000)],
    );
    await client.query(
      `INSERT INTO journey_features (
         id, journey_id, step_id, name, status, unit_test_path
       ) VALUES ($1, $2, $3, 'Impact radius fixture', 'building', $4)`,
      [featureId, capabilityJourneyId, stepId, assertionRef],
    );
    await client.query(
      `INSERT INTO journey_step_links (
         id, journey_id, step_id, cell_kind, cell_key, cell_status,
         feature_id, assertion_ref, status
       ) VALUES ($1, $2, $3, 'capability', 'F1', 'green', $4, $5, 'planned')`,
      [linkId, capabilityJourneyId, stepId, featureId, assertionRef],
    );
    await client.query(
      `INSERT INTO graph_edges (
         repo, src_path, dst_path, edge_type, source_revision, scanner_version, scanned_at
       ) VALUES ('cecelia', $1, $2, 'import', $3, 'integration-test', NOW())`,
      [assertionRef, changedFile, baseRevision],
    );
    await client.query(
      `INSERT INTO fact_snapshot_headers
         (kind, repo, source_revision, scanner_version, scanned_at, row_count)
       VALUES ('graph', 'cecelia', $1, 'integration-test', NOW(), 1)
       ON CONFLICT (kind, repo) DO UPDATE SET
         source_revision = EXCLUDED.source_revision,
         scanner_version = EXCLUDED.scanner_version,
         scanned_at = EXCLUDED.scanned_at,
         row_count = EXCLUDED.row_count`,
      [baseRevision],
    );
    await client.query(
      `INSERT INTO graph_snapshot_versions
         (repo, source_revision, scanner_version, scanned_at, row_count)
       VALUES ('cecelia', $1, 'integration-test', NOW(), 1)
       ON CONFLICT (repo, source_revision) DO NOTHING`,
      [baseRevision],
    );
    await client.query(
      `INSERT INTO graph_edge_snapshots
         (repo, source_revision, src_path, dst_path, edge_type, detail)
       VALUES ('cecelia', $1, $2, $3, 'import', '{}'::jsonb)
       ON CONFLICT DO NOTHING`,
      [baseRevision, assertionRef, changedFile],
    );
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    await pool.end();
  });

  function dependencies(revision = baseRevision) {
    return {
      db: client,
      projectionForRevision: async () => ({
        id: randomUUID(),
        manifest_digest: manifestDigest,
        projection_digest: projectionDigest,
        fact_revisions: { cecelia: revision },
        status: 'active',
      }),
      manifestForProjection: async () => ({ version: 1, digest: manifestDigest }),
      factHealth: async () => ({ overall: 'fresh' }),
      capabilityNodes: async () => ([{ node_key: 'F1', name: '工厂 · F1 开发闭环' }]),
    };
  }

  it('把真实 graph anchor 投影成 revision-locked capability 与 assertion', async () => {
    const result = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia',
      base_revision: baseRevision,
      head_revision: headRevision,
      changed_files: [changedFile],
    }, dependencies());

    expect(result).toMatchObject({
      scope_key: 'cecelia',
      manifest_digest: manifestDigest,
      projection_digest: projectionDigest,
      fact_revisions: { 'perfectuser21/cecelia': baseRevision },
      freshness: { status: 'fresh', reason_code: null },
      affected_nodes: [{ capability_id: 'F1', owner: 'F1' }],
    });
    const targetAssertion = result.required_assertions.find(
      ({ assertion_id: assertionId }) => assertionId === assertionRef,
    );
    expect(targetAssertion).toMatchObject({
      assertion_id: assertionRef,
      command: `npx vitest run ${assertionRef}`,
      covers_capability_ids: ['F1'],
      owner: 'F1',
    });
    expect(targetAssertion.source_bindings).toContainEqual({
      journey_step_link_id: linkId,
      assertion_revision: 1,
      assertion_digest: assertionDigest,
    });
  });

  it('未归位文件与旧 projection revision 都不能被解释为空影响', async () => {
    const unclaimed = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia',
      base_revision: baseRevision,
      head_revision: headRevision,
      changed_files: ['unclaimed/new-module.js'],
    }, dependencies());
    expect(unclaimed.freshness).toMatchObject({
      status: 'unknown', reason_code: 'impact_anchor_missing',
    });
    expect(unclaimed.unclaimed_files).toEqual(['unclaimed/new-module.js']);

    const stale = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia',
      base_revision: baseRevision,
      head_revision: headRevision,
      changed_files: [],
    }, dependencies('c'.repeat(40)));
    expect(stale.freshness).toMatchObject({
      status: 'stale', reason_code: 'projection_revision_mismatch',
    });

    const mismatchedManifest = dependencies();
    mismatchedManifest.projectionForRevision = async () => ({
      manifest_digest: '3'.repeat(64),
      projection_digest: projectionDigest,
      fact_revisions: { cecelia: baseRevision },
      status: 'active',
    });
    const splitBrain = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia',
      base_revision: baseRevision,
      head_revision: headRevision,
      changed_files: [],
    }, mismatchedManifest);
    expect(splitBrain.freshness).toMatchObject({
      status: 'stale', reason_code: 'manifest_projection_mismatch',
    });
  });

  it('Manifest 路径所有权让 base 图中不存在的新文件仍可机械归位', async () => {
    const deps = dependencies();
    deps.capabilityNodes = async () => ([{
      node_key: 'F1', name: '工厂 · F1 开发闭环',
      attributes: { path_prefixes: ['packages/brain/'], exact_paths: ['.brain-versions'] },
    }]);
    const result = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia',
      base_revision: baseRevision,
      head_revision: headRevision,
      changed_files: ['packages/brain/src/new-module.js', '.brain-versions'],
      capability_ids: ['F1'],
    }, deps);

    expect(result.freshness).toMatchObject({ status: 'fresh', reason_code: null });
    expect(result.unclaimed_files).toEqual([]);
    expect(result.affected_nodes).toEqual([
      expect.objectContaining({ capability_id: 'F1' }),
    ]);
  });

  it('changes/ 版本碎片（仓规：PR 不碰版本五件套）不得判 unclaimed 杀 run', async () => {
    // 2026-09-19 实证（run 0f36a253 hop 78-80）：generator-fix 按 changes/README.md 写入
    // changes/cp-route-api-5c016e3e.md，被 unclaimed 判定当无锚文件 → impact_anchor_missing
    // 确定性 run_terminal，修复提交没推出。碎片目录与毕业池同类：设计内全局目录，由
    // auto-version + check-brain-version-bump 把守，不属任何 capability。
    const deps = dependencies();
    deps.capabilityNodes = async () => ([{
      node_key: 'F1', name: '工厂 · F1 开发闭环',
      attributes: { path_prefixes: ['packages/brain/'], exact_paths: [] },
    }]);
    const result = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia',
      base_revision: baseRevision,
      head_revision: headRevision,
      changed_files: ['packages/brain/src/new-module.js', 'changes/cp-route-api-5c016e3e.md'],
      capability_ids: ['F1'],
    }, deps);
    expect(result.freshness).toMatchObject({ status: 'fresh', reason_code: null });
    expect(result.unclaimed_files).toEqual([]);

    // 相似前缀不得蹭豁免（changes-fake/ 仍是无锚文件）
    const fake = await resolveImpactRadius({
      repo: 'perfectuser21/cecelia',
      base_revision: baseRevision,
      head_revision: headRevision,
      changed_files: ['changes-fake/x.md'],
      capability_ids: ['F1'],
    }, deps);
    expect(fake.freshness).toMatchObject({ status: 'unknown', reason_code: 'impact_anchor_missing' });
    expect(fake.unclaimed_files).toEqual(['changes-fake/x.md']);
  });
});
