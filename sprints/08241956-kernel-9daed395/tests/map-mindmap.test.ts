import { describe, expect, it } from 'vitest';

// 冻结测试（TDD Red）：mind-elixir 三层脑图的纯函数 view-model。
// buildMindmapTree 从 live map 的 nodes/edges 推导 价值流→能力→特性 三层结构，
// 折叠中间的 backbone 层，只暴露 value_stream / capability / feature 三类可视节点。
// 尚未实现 -> 本 import 解析失败 / 函数缺失 -> 全部用例 RED。
import { buildMindmapTree } from '../../../apps/api/features/planning/pages/mapMindmap';

interface N { key: string; type: string; name: string }
interface E { from: string; to: string; type: string }

// fixture 与权威测试 apps/dashboard/src/pages/map/MapPage.test.tsx 的 nodes/edges 同构
const nodes: N[] = [
  { key: 'factory', type: 'value_stream', name: '工厂' },
  { key: 'butler', type: 'value_stream', name: '管家' },
  { key: 'F0', type: 'capability', name: '事实投影' },
  { key: 'G1', type: 'capability', name: '统一查询' },
  { key: 'backbone-1', type: 'backbone', name: '投影骨干' },
  { key: 'feature-1', type: 'feature', name: '确定性投影' },
  { key: 'assertion-1', type: 'assertion', name: '投影摘要稳定' },
  { key: 'artifact-1', type: 'artifact', name: '投影测试' },
  { key: 'heartbeat_bus', type: 'crosscut', name: '心跳总线' },
];

const edges: E[] = [
  { from: 'factory', to: 'F0', type: 'contains' },
  { from: 'F0', to: 'backbone-1', type: 'contains' },
  { from: 'backbone-1', to: 'feature-1', type: 'contains' },
  { from: 'feature-1', to: 'assertion-1', type: 'proves' },
  { from: 'assertion-1', to: 'artifact-1', type: 'anchored_by' },
  { from: 'F0', to: 'G1', type: 'hands_off_to' },
  { from: 'heartbeat_bus', to: 'factory', type: 'serves' },
  { from: 'heartbeat_bus', to: 'butler', type: 'serves' },
];

describe('buildMindmapTree — mind-elixir 三层脑图 view-model [BEHAVIOR]', () => {
  it('从 contains 边推导 2 个价值流根', () => {
    const tree = buildMindmapTree(nodes, edges);
    expect(Array.isArray(tree)).toBe(true);
    expect(tree.map((n) => n.key).sort()).toEqual(['butler', 'factory']);
    expect(tree.every((n) => n.type === 'value_stream')).toBe(true);
  });

  it('能力挂在其价值流下（仅经 contains 边，不含 hands_off_to）', () => {
    const tree = buildMindmapTree(nodes, edges);
    const factory = tree.find((n) => n.key === 'factory');
    const butler = tree.find((n) => n.key === 'butler');
    expect(factory?.children.map((c) => c.key)).toEqual(['F0']);
    expect(factory?.children.every((c) => c.type === 'capability')).toBe(true);
    // G1 只经 hands_off_to 从 F0 到达，不是 contains 子节点 -> 不得挂在 factory 下
    expect(factory?.children.some((c) => c.key === 'G1')).toBe(false);
    // butler 无 contains 边 -> 空能力（空态不崩溃）
    expect(butler?.children).toEqual([]);
  });

  it('特性经折叠 backbone 挂在能力下（三层嵌套 value_stream→capability→feature）', () => {
    const tree = buildMindmapTree(nodes, edges);
    const f0 = tree.find((n) => n.key === 'factory')?.children.find((c) => c.key === 'F0');
    // feature-1 是 F0 经 backbone-1 传递 contains 的特性，backbone 层被折叠
    expect(f0?.children.map((c) => c.key)).toEqual(['feature-1']);
    expect(f0?.children.every((c) => c.type === 'feature')).toBe(true);
    // assertion/artifact/backbone 不属于三层可视节点
    const allKeys = JSON.stringify(tree);
    expect(allKeys.includes('backbone-1')).toBe(false);
    expect(allKeys.includes('assertion-1')).toBe(false);
  });
});
