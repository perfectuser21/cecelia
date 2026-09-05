import { describe, it, expect } from 'vitest';

// 画布 SSOT 纯投影引擎（本 sprint 新增导出）——RED：projectGoldenPathCanvas 尚未实现
import { projectGoldenPathCanvas } from '../../../packages/brain/src/lib/map-projector.js';

describe('画布 SSOT 纯投影 projectGoldenPathCanvas [BEHAVIOR]', () => {
  const ability = { key: 'a', name: '能力A' };

  it('golden_path steps 投影为有序 stage 节点', () => {
    const r = projectGoldenPathCanvas({
      scopeKey: 'F1',
      ability,
      steps: [
        { key: 's2', name: 'S2', order_no: 2 },
        { key: 's1', name: 'S1', order_no: 1 },
      ],
    });
    const stages = r.nodes.filter((n) => n.node_type === 'stage');
    expect(stages).toHaveLength(2);
    // 无序输入必须按 order_no 升序稳定排列
    expect(stages[0].attributes.order_no).toBe(1);
    expect(stages[1].attributes.order_no).toBe(2);
    expect(stages[0].attributes.canvas_layer).toBe('stage');
    expect(stages[0].attributes.maturity).toBe('unknown');
    // 恰 1 个 canvas 节点（L3 ability→画布）
    expect(r.nodes.filter((n) => n.node_type === 'canvas')).toHaveLength(1);
    // 相邻 stage 有序 precedes 边 = steps - 1
    expect(r.edges.filter((e) => e.edge_type === 'precedes')).toHaveLength(1);
    // 稳定 id（64 hex）
    expect(stages[0].node_id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('feature 映射技能体 feature 节点', () => {
    const r = projectGoldenPathCanvas({
      scopeKey: 'F1',
      ability,
      steps: [
        { key: 's1', name: 'S1', order_no: 1, features: [{ key: 'f1', name: 'F1' }] },
      ],
    });
    const features = r.nodes.filter((n) => n.node_type === 'feature');
    expect(features).toHaveLength(1);
    expect(features[0].attributes.canvas_layer).toBe('feature');
  });

  it('空 steps 画布为空不报错', () => {
    const r = projectGoldenPathCanvas({ scopeKey: 'F1', ability, steps: [] });
    expect(r.nodes.filter((n) => n.node_type === 'stage')).toHaveLength(0);
    // 边界：空 ability 画布为空但仍有 canvas 容器，不抛错
    expect(r.nodes.filter((n) => n.node_type === 'canvas')).toHaveLength(1);
    expect(r.edges).toHaveLength(0);
  });
});
