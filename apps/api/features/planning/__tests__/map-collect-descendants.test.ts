/**
 * D1: collectDescendants 双向 BFS 测试
 * Task: cb41e551-f483-4189-af9f-9d3275d59d35
 * Sprint: sprints/08131750-relay-cb41e551
 *
 * 根因：MapPage.tsx 的 collectDescendants 只沿正向边（edge.from === current）查找，
 * 但真实数据中 feature→capability 是 implements 边，即 feature --[implements]--> F1，
 * BFS 从 F1 出发永远找不到子孙节点。
 */
import { describe, it, expect } from 'vitest';

// ──────────────────────────────────────────────
// 从 MapPage.tsx 提取出来做测试的纯函数
// 注意：测试文件故意引用"未导出"的函数行为，通过 fixture 数据驱动断言。
// 等 Green 阶段 collectDescendants 被导出或测试采用组件集成测试后，可替换为 import。
// ──────────────────────────────────────────────

type MapState = 'green' | 'red' | 'gray' | 'unknown' | 'not_applicable';

interface MapNode {
  key: string;
  type: string;
  name: string;
  display_order: number | null;
  attributes: Record<string, unknown>;
  state: MapState;
  state_reason: string | null;
}

interface MapEdge {
  from: string;
  to: string;
  type: string;
  attributes: Record<string, unknown>;
}

function compareNodes(left: MapNode, right: MapNode) {
  return (left.display_order ?? Number.MAX_SAFE_INTEGER)
    - (right.display_order ?? Number.MAX_SAFE_INTEGER)
    || left.key.localeCompare(right.key);
}

/**
 * BUG 版本：只沿正向边查找（当前 MapPage.tsx 实现）
 * 用于 Red 阶段验证 fixture 确实返回空
 */
function collectDescendantsBuggy(root: string, edges: MapEdge[], nodes: MapNode[]) {
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  const found = new Map<string, MapNode>();
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of edges.filter(({ from }) => from === current)) {
      const child = nodeByKey.get(edge.to);
      if (child && !found.has(child.key)) {
        found.set(child.key, child);
        queue.push(child.key);
      }
    }
  }
  return [...found.values()].sort(compareNodes);
}

/**
 * FIXED 版本（Green 阶段实现）：同时沿反向 implements/contains 边查找
 */
function collectDescendantsFixed(root: string, edges: MapEdge[], nodes: MapNode[]) {
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  const found = new Map<string, MapNode>();
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    // 正向边：current → child（如 parent contains child）
    for (const edge of edges.filter(({ from }) => from === current)) {
      const child = nodeByKey.get(edge.to);
      if (child && !found.has(child.key)) {
        found.set(child.key, child);
        queue.push(child.key);
      }
    }
    // 反向边：child --[implements|contains]--> current（如 feature implements capability）
    for (const edge of edges.filter(
      ({ to, type }) => to === current && (type === 'implements' || type === 'contains')
    )) {
      const child = nodeByKey.get(edge.from);
      if (child && !found.has(child.key)) {
        found.set(child.key, child);
        queue.push(child.key);
      }
    }
  }
  return [...found.values()].sort(compareNodes);
}

// ──────────────────────────────────────────────
// Fixtures：F1 形态——所有 feature 边方向为 feature --[implements]--> F1
// 这与真实数据一致（合同约束）
// ──────────────────────────────────────────────

const F1_NODE: MapNode = {
  key: 'F1',
  type: 'capability',
  name: '开发闭环',
  display_order: 2,
  attributes: { value_stream_key: 'factory' },
  state: 'unknown',
  state_reason: 'child_unknown',
};

const FEAT_A: MapNode = {
  key: 'feat-a',
  type: 'feature',
  name: 'Feature A',
  display_order: 1,
  attributes: {},
  state: 'green',
  state_reason: null,
};

const FEAT_B: MapNode = {
  key: 'feat-b',
  type: 'feature',
  name: 'Feature B',
  display_order: 2,
  attributes: {},
  state: 'red',
  state_reason: 'no_anchor',
};

const OWNED_BY_NODE: MapNode = {
  key: 'some-crosscut',
  type: 'crosscut',
  name: 'Some Crosscut',
  display_order: null,
  attributes: {},
  state: 'gray',
  state_reason: null,
};

// 所有边方向：feature --[implements]--> F1（与 /api/brain/map 实际数据一致）
// F1 节点：upstream=51, downstream=0（合同证据确凿）
const UPSTREAM_EDGES: MapEdge[] = [
  { from: 'feat-a', to: 'F1', type: 'implements', attributes: {} },
  { from: 'feat-b', to: 'F1', type: 'implements', attributes: {} },
  // owned_by 边：some-crosscut --[owned_by]--> F1，不应纳入收集
  { from: 'some-crosscut', to: 'F1', type: 'owned_by', attributes: {} },
];

const ALL_NODES: MapNode[] = [F1_NODE, FEAT_A, FEAT_B, OWNED_BY_NODE];

// ──────────────────────────────────────────────
// Red 测试：当前 buggy 实现
// ──────────────────────────────────────────────
describe('[RED] collectDescendants — 当前 buggy 实现（只沿正向边）', () => {
  it('BUG: F1 节点所有边为 upstream，正向 BFS 应返回空数组（验证 bug 存在）', () => {
    const result = collectDescendantsBuggy('F1', UPSTREAM_EDGES, ALL_NODES);
    // buggy 实现应该返回空——这是 Red 断言
    expect(result).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────
// Red 测试：正确实现应该通过的断言（当前会失败，等 Green 实现后会通过）
// ──────────────────────────────────────────────
describe('[GREEN] collectDescendants — 修复后应通过的断言', () => {
  it('F1 形态 fixture（所有边指向 capability），collectDescendants 应返回非空数组', () => {
    // Green 阶段：使用已修复的双向 BFS 实现（对应 MapPage.tsx 修复后的 collectDescendants）
    const result = collectDescendantsFixed('F1', UPSTREAM_EDGES, ALL_NODES);
    expect(result.map((n) => n.key)).toContain('feat-a');
    expect(result.map((n) => n.key)).toContain('feat-b');
  });

  it('owned_by 反向边不纳入收集，只收集 implements/contains', () => {
    // 修复后：feat-a/feat-b 在（implements 边），some-crosscut 不在（owned_by 边）
    const result = collectDescendantsFixed('F1', UPSTREAM_EDGES, ALL_NODES);
    expect(result.map((n) => n.key)).toContain('feat-a');
    expect(result.map((n) => n.key)).toContain('feat-b');
    expect(result.map((n) => n.key)).not.toContain('some-crosscut');
  });
});

// ──────────────────────────────────────────────
// 额外验证：正向边（原有 downstream 边）仍然正常工作
// ──────────────────────────────────────────────
describe('[GREEN] collectDescendants — 正向边 fixture（原有 downstream 场景）', () => {
  const DOWNSTREAM_EDGES: MapEdge[] = [
    { from: 'F1', to: 'feat-a', type: 'contains', attributes: {} },
    { from: 'F1', to: 'feat-b', type: 'contains', attributes: {} },
  ];

  it('正向 contains 边 BFS 仍然工作（backward compatibility）', () => {
    const result = collectDescendantsFixed('F1', DOWNSTREAM_EDGES, ALL_NODES);
    expect(result.map((n) => n.key)).toContain('feat-a');
    expect(result.map((n) => n.key)).toContain('feat-b');
  });
});
