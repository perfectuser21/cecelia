import { describe, expect, it, vi } from 'vitest';

import { computeMapImpactRadius, loadMapImpactRadius } from '../map-impact-radius.js';

const ASSERTION_LINK_ID = '11111111-1111-4111-8111-111111111111';
const nodes = [
  { node_id: 'artifact-a', node_type: 'artifact', node_key: 'repo-a:graph:src/api.js', attributes: { repo: 'repo-a', stable_ref: 'src/api.js' } },
  { node_id: 'artifact-b', node_type: 'artifact', node_key: 'repo-b:graph:src/api.js', attributes: { repo: 'repo-b', stable_ref: 'src/api.js' } },
  { node_id: 'feature-a', node_type: 'feature', node_key: 'feature-a', attributes: {} },
  { node_id: 'assertion-a', node_type: 'assertion', node_key: ASSERTION_LINK_ID, attributes: { assertion_ref: 'tests/core.test.js', assertion_revision: 2 } },
  { node_id: 'cap-a', node_type: 'capability', node_key: 'CAP_A', attributes: {} },
  { node_id: 'stream-a', node_type: 'value_stream', node_key: 'stream-a', attributes: {} },
  { node_id: 'crosscut-a', node_type: 'crosscut', node_key: 'crosscut-a', attributes: {} },
];
const edges = [
  { edge_type: 'implements', from_node_id: 'artifact-a', to_node_id: 'feature-a' },
  { edge_type: 'proves', from_node_id: 'assertion-a', to_node_id: 'feature-a' },
  { edge_type: 'implements', from_node_id: 'feature-a', to_node_id: 'cap-a' },
  { edge_type: 'contains', from_node_id: 'stream-a', to_node_id: 'cap-a' },
  { edge_type: 'serves', from_node_id: 'crosscut-a', to_node_id: 'stream-a' },
];
const graphEdges = [
  { repo: 'repo-a', src_path: 'src/api.js', dst_path: 'src/core.js', edge_type: 'import' },
  { repo: 'repo-a', src_path: 'tests/core.test.js', dst_path: 'src/api.js', edge_type: 'import' },
  { repo: 'repo-b', src_path: 'src/foreign.js', dst_path: 'src/core.js', edge_type: 'import' },
];

describe('computeMapImpactRadius', () => {
  it('在选定 repo 做 reverse graph traversal，并回溯业务节点与必跑断言', () => {
    const result = computeMapImpactRadius({
      repo: 'repo-a', changedFiles: ['src/core.js'], graphEdges, nodes, edges,
    });

    expect(result.reached_files).toEqual(['src/api.js', 'src/core.js', 'tests/core.test.js']);
    expect(result.reached_files).not.toContain('src/foreign.js');
    expect(result.affected_business_nodes.map(({ node_key }) => node_key)).toEqual([
      'CAP_A', 'crosscut-a', 'feature-a', 'stream-a',
    ]);
    expect(result.must_run_assertions).toEqual([
      {
        node_key: ASSERTION_LINK_ID,
        assertion_ref: 'tests/core.test.js',
        assertion_revision: 2,
        journey_step_link_id: ASSERTION_LINK_ID,
      },
    ]);
    expect(result.affected_tests).toEqual(['tests/core.test.js']);
  });

  it('同路径的其他 repo artifact 不得进入 radius', () => {
    const result = computeMapImpactRadius({
      repo: 'repo-a', changedFiles: ['src/core.js'], graphEdges, nodes, edges,
    });
    expect(result.affected_artifacts.map(({ node_id }) => node_id)).toEqual(['artifact-a']);
  });

  it('Cross-cut 作为起点沿 serves 展开到 stream/capability，影响范围非空', () => {
    const result = computeMapImpactRadius({
      repo: 'repo-a', changedFiles: [], startNodeKeys: ['crosscut-a'],
      graphEdges, nodes, edges,
    });
    expect(result.affected_business_nodes.map(({ node_key }) => node_key)).toEqual([
      'CAP_A', 'crosscut-a', 'stream-a',
    ]);
  });

  it('Capability 作为显式起点反向展开实现它的 feature 与必跑断言', () => {
    const result = computeMapImpactRadius({
      repo: 'repo-a', changedFiles: [], startNodeKeys: ['CAP_A'],
      graphEdges, nodes, edges,
    });
    expect(result.affected_business_nodes.map(({ node_key }) => node_key)).toEqual([
      'CAP_A', 'crosscut-a', 'feature-a', 'stream-a',
    ]);
    expect(result.must_run_assertions).toEqual([
      expect.objectContaining({
        assertion_ref: 'tests/core.test.js',
        journey_step_link_id: ASSERTION_LINK_ID,
      }),
    ]);
  });

  it('输入顺序和事实行顺序不影响确定排序', () => {
    const first = computeMapImpactRadius({
      repo: 'repo-a', changedFiles: ['src/core.js', 'src/api.js'], graphEdges, nodes, edges,
    });
    const second = computeMapImpactRadius({
      repo: 'repo-a', changedFiles: ['src/api.js', 'src/core.js'],
      graphEdges: [...graphEdges].reverse(), nodes: [...nodes].reverse(), edges: [...edges].reverse(),
    });
    expect(second).toEqual(first);
  });
});

describe('loadMapImpactRadius revision authority', () => {
  const revisionA = 'a'.repeat(40);
  const revisionB = 'b'.repeat(40);
  const runId = '22222222-2222-4222-8222-222222222222';
  const now = new Date('2026-08-15T00:00:00.000Z');
  const projectedNodes = [
    { node_id: 'artifact-a', node_type: 'artifact', node_key: 'artifact-a', name: 'A', attributes: { repo: 'repo-a', stable_ref: 'src/a.js' } },
    { node_id: 'artifact-b', node_type: 'artifact', node_key: 'artifact-b', name: 'B', attributes: { repo: 'repo-a', stable_ref: 'src/b.js' } },
  ];

  function clientWithSnapshot(snapshotRows) {
    return { query: vi.fn(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM map_scope_repositories')) {
        return { rows: [{ scope_key: 'scope-a', repo: 'repo-a', adapter_key: 'test-v1', adapter_config: {} }] };
      }
      if (text.includes('FROM map_projection_runs')) {
        return { rows: [{
          id: runId,
          scope_key: 'scope-a',
          fact_revisions: { 'repo-a': revisionA },
          projection_digest: 'c'.repeat(64),
          activated_at: now,
        }] };
      }
      if (text.includes('FROM map_projection_nodes')) return { rows: projectedNodes };
      if (text.includes('FROM map_projection_edges')) return { rows: [] };
      if (text.includes('FROM graph_snapshot_versions')) return { rows: snapshotRows };
      if (text.includes('FROM graph_edges')) {
        return { rows: [{ repo: 'repo-a', src_path: 'src/b.js', dst_path: 'src/core.js', edge_type: 'import' }] };
      }
      if (text.includes('FROM fact_snapshot_headers')) {
        return { rows: [{
          kind: 'graph', repo: 'repo-a', source_revision: revisionB,
          scanner_version: 'live-b', scanned_at: now, row_count: 1,
        }] };
      }
      throw new Error(`unexpected SQL: ${text}`);
    }) };
  }

  it('uses immutable graph snapshot at the projection fact revision, not live graph B', async () => {
    const client = clientWithSnapshot([{
      snapshot_revision: revisionA,
      scanner_version: 'graph-v1',
      scanned_at: now,
      row_count: 1,
      repo: 'repo-a',
      src_path: 'src/a.js',
      dst_path: 'src/core.js',
      edge_type: 'import',
    }]);

    const result = await loadMapImpactRadius(client, {
      scopeKey: 'scope-a',
      repo: 'repo-a',
      changedFiles: ['src/core.js'],
      now,
      projectionRunId: runId,
    });

    expect(result.reached_files).toEqual(['src/a.js', 'src/core.js']);
    expect(result.reached_files).not.toContain('src/b.js');
    expect(result.freshness).toMatchObject({ status: 'fresh', source_revision: revisionA });
  });

  it('fails closed when the projection fact revision has no exact graph snapshot', async () => {
    const client = clientWithSnapshot([]);

    await expect(loadMapImpactRadius(client, {
      scopeKey: 'scope-a',
      repo: 'repo-a',
      changedFiles: ['src/core.js'],
      now,
      projectionRunId: runId,
    })).rejects.toMatchObject({ code: 'MAP_RADIUS_GRAPH_SNAPSHOT_NOT_FOUND' });
  });

  it('fails closed when immutable snapshot row_count does not match its edge rows', async () => {
    const client = clientWithSnapshot([{
      snapshot_revision: revisionA,
      scanner_version: 'graph-v1',
      scanned_at: now,
      row_count: 2,
      repo: 'repo-a',
      src_path: 'src/a.js',
      dst_path: 'src/core.js',
      edge_type: 'import',
    }]);

    await expect(loadMapImpactRadius(client, {
      scopeKey: 'scope-a',
      repo: 'repo-a',
      changedFiles: ['src/core.js'],
      now,
      projectionRunId: runId,
    })).rejects.toMatchObject({ code: 'MAP_RADIUS_GRAPH_SNAPSHOT_INCOMPLETE' });
  });
});
