import { describe, it, expect } from 'vitest';
import {
  normalizePath, buildAdjacency, reachable, matchAnchor, classifyFeatureAnchors, isTestPath,
} from '../graph-query.js';

const EDGES = [
  { src_path: 'a.js', dst_path: 'b.js', edge_type: 'import' },
  { src_path: 'b.js', dst_path: 'c.js', edge_type: 'import' },
  { src_path: './t/__tests__/x.test.js', dst_path: 'b.js', edge_type: 'import' },
  { src_path: 'c.js', dst_path: 'a.js', edge_type: 'spawn' }, // 环 a→b→c→a
];

describe('normalizePath', () => {
  it('去开头 ./ 与重复斜杠', () => {
    expect(normalizePath('./x//y.js')).toBe('x/y.js');
    expect(normalizePath('a/b.js')).toBe('a/b.js');
  });
});

describe('buildAdjacency + reachable', () => {
  const adj = buildAdjacency(EDGES);

  it('fwd 邻接含 edge_type', () => {
    expect(adj.fwd.get('a.js')).toEqual([{ dst: 'b.js', edge_type: 'import' }]);
  });

  it('rev 方向:谁依赖 b.js', () => {
    const srcs = adj.rev.get('b.js').map((e) => e.src).sort();
    expect(srcs).toEqual(['a.js', 't/__tests__/x.test.js']);
  });

  it('rev BFS 从 c.js:含起点,穿环安全终止', () => {
    const r = reachable(adj, ['c.js'], { dir: 'rev', maxDepth: 10 });
    expect(r.has('c.js')).toBe(true);
    expect(r.has('b.js')).toBe(true);
    expect(r.has('a.js')).toBe(true);
    expect(r.has('t/__tests__/x.test.js')).toBe(true);
  });

  it('maxDepth=1 只到一跳', () => {
    const r = reachable(adj, ['c.js'], { dir: 'rev', maxDepth: 1 });
    expect(r.has('b.js')).toBe(true);
    expect(r.has('a.js')).toBe(false);
  });

  it('fwd BFS 从 a.js 到 c.js', () => {
    const r = reachable(adj, ['a.js'], { dir: 'fwd', maxDepth: 10 });
    expect(r.has('c.js')).toBe(true);
  });
});

describe('matchAnchor', () => {
  const nodes = new Set(['packages/brain/src/x.js', 'services/agent/pub/y.js', 'src/x.js']);

  it('精确命中优先', () => {
    expect(matchAnchor('src/x.js', nodes)).toBe('src/x.js');
  });

  it('锚点短路径后缀匹配到最长节点', () => {
    expect(matchAnchor('brain/src/x.js', nodes)).toBe('packages/brain/src/x.js');
  });

  it('节点短于锚点也可反向后缀匹配', () => {
    expect(matchAnchor('repo-root/services/agent/pub/y.js', nodes)).toBe('services/agent/pub/y.js');
  });

  it('不匹配返回 null(zenithjoy 锚点场景)', () => {
    expect(matchAnchor('publishers/douyin/pub.js', nodes)).toBeNull();
  });
});

describe('classifyFeatureAnchors 三态', () => {
  const nodes = new Set(['packages/brain/src/x.js']);
  const rows = [
    { id: '1', name: 'covered 的', unit_test_path: 'packages/brain/src/x.js', workflow_ref: null, guard_ref: null },
    { id: '2', name: 'uncovered 的', unit_test_path: null, workflow_ref: 'publishers/douyin/p.js', guard_ref: null },
    { id: '3', name: 'unanchored 的', unit_test_path: null, workflow_ref: null, guard_ref: null },
  ];

  it('三态正确且 anchors 结构齐', () => {
    const c = classifyFeatureAnchors(rows, nodes);
    expect(c[0].status).toBe('covered');
    expect(c[0].anchors[0]).toEqual({ field: 'unit_test_path', path: 'packages/brain/src/x.js', matched_node: 'packages/brain/src/x.js' });
    expect(c[1].status).toBe('uncovered');
    expect(c[1].anchors[0].matched_node).toBeNull();
    expect(c[2].status).toBe('unanchored');
    expect(c[2].anchors).toEqual([]);
  });
});

describe('isTestPath', () => {
  it('四种测试路径形态', () => {
    expect(isTestPath('a/__tests__/x.test.js')).toBe(true);
    expect(isTestPath('a/x.test.ts')).toBe(true);
    expect(isTestPath('a/x.spec.js')).toBe(true);
    expect(isTestPath('services/agent/tests/t.py')).toBe(true);
    expect(isTestPath('src/executor.js')).toBe(false);
  });
});
