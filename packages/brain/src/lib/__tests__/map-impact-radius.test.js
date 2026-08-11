import { describe, expect, it } from 'vitest';

import { computeMapImpactRadius } from '../map-impact-radius.js';

const nodes = [
  { node_id: 'artifact-a', node_type: 'artifact', node_key: 'repo-a:graph:src/api.js', attributes: { repo: 'repo-a', stable_ref: 'src/api.js' } },
  { node_id: 'artifact-b', node_type: 'artifact', node_key: 'repo-b:graph:src/api.js', attributes: { repo: 'repo-b', stable_ref: 'src/api.js' } },
  { node_id: 'feature-a', node_type: 'feature', node_key: 'feature-a', attributes: {} },
  { node_id: 'assertion-a', node_type: 'assertion', node_key: 'assertion-a', attributes: { assertion_ref: 'tests/core.test.js' } },
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
      { node_key: 'assertion-a', assertion_ref: 'tests/core.test.js' },
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
