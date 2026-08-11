/**
 * 刀2+5: projector.js 结构投影测试（无需 DB）
 * 覆盖：buildStructuralProjection 节点/边生成、digest 确定性、通用性（多 scope）
 */
import { describe, it, expect } from 'vitest';
import { buildStructuralProjection } from '../projector.js';

// ZenithJoy 示例 manifest（刀5 通用性验收 — 镜像 scripts/map/zenithjoy-manifest-example.json）
const ZENITHJOY_MANIFEST = {
  scope_key: 'zenithjoy',
  schema_version: 1,
  value_streams: [
    { key: 'content', name: '内容创作', perceiver: '内容创作者', order: 1 },
    { key: 'distribution', name: '内容分发', perceiver: '受众 / 平台', order: 2 },
  ],
  capabilities: [
    { key: 'C1', name: '素材采集', value_stream_key: 'content', order: 1 },
    { key: 'C2', name: 'AI 创作', value_stream_key: 'content', order: 2 },
    { key: 'C3', name: '内容审核', value_stream_key: 'content', order: 3 },
    { key: 'D1', name: '多平台发布', value_stream_key: 'distribution', order: 1 },
    { key: 'D2', name: '数据洞察', value_stream_key: 'distribution', order: 2 },
  ],
  boundaries: [
    { key: 'C3_TO_D1', from: 'C3', to: 'D1', statement: '审核通过是 C3 终点；跨平台推送从已审核内容起步是 D1 起点' },
  ],
  crosscut_pool: [
    { key: 'account_chain', name: '账号体系', serves: ['content', 'distribution'] },
    { key: 'ai_engine', name: 'AI 引擎', serves: ['content', 'distribution'], owner: 'C2' },
    { key: 'data_foundation', name: '数据基础层', serves: ['content', 'distribution'], owner: 'D2' },
  ],
  shared_prerequisites: { applicable: false, items: [], reason: '内容创作与内容分发的感知者不同' },
};

const MANIFEST = {
  scope_key: 'cecelia',
  schema_version: 1,
  value_streams: [
    { key: 'factory', name: '工厂', perceiver: '待造软件', order: 1 },
    { key: 'butler', name: '管家', perceiver: '主理人本人', order: 2 },
  ],
  capabilities: [
    { key: 'F0', name: '提案打磨', value_stream_key: 'factory', order: 1 },
    { key: 'F1', name: '开发闭环', value_stream_key: 'factory', order: 2 },
    { key: 'F2', name: '部署闭环', value_stream_key: 'factory', order: 3 },
    { key: 'F3', name: '夜间体检', value_stream_key: 'factory', order: 4 },
    { key: 'F4', name: '故障自愈', value_stream_key: 'factory', order: 5 },
    { key: 'MJ5', name: '承诺地图', value_stream_key: 'factory', order: 6 },
    { key: 'G1', name: '指挥舱', value_stream_key: 'butler', order: 1, aliases: ['F5'] },
    { key: 'G2', name: '收件箱', value_stream_key: 'butler', order: 2, aliases: ['F6'] },
    { key: 'G3', name: '晨报感知', value_stream_key: 'butler', order: 3 },
    { key: 'G4', name: '记忆知识', value_stream_key: 'butler', order: 4, aliases: ['F7'] },
    { key: 'G5', name: '战略 OKR', value_stream_key: 'butler', order: 5 },
  ],
  boundaries: [
    { key: 'F0_TO_G1', from: 'F0', to: 'G1', statement: '提案到拍板' },
  ],
  crosscut_pool: [
    { key: 'heartbeat_bus', name: '心跳传送带', serves: ['factory', 'butler'] },
    { key: 'skill_distribution', name: 'Skill 分发链', owner: 'F1', serves: ['factory', 'butler'] },
  ],
  shared_prerequisites: { applicable: false, items: [], reason: 'test' },
};

describe('buildStructuralProjection', () => {
  it('生成 2 个 value_stream 节点', () => {
    const { nodes } = buildStructuralProjection(MANIFEST);
    const vs = nodes.filter((n) => n.node_type === 'value_stream');
    expect(vs).toHaveLength(2);
    expect(vs.map((n) => n.node_key).sort()).toEqual(['butler', 'factory']);
  });

  it('生成 11 个 capability 节点', () => {
    const { nodes } = buildStructuralProjection(MANIFEST);
    const caps = nodes.filter((n) => n.node_type === 'capability');
    expect(caps).toHaveLength(11);
  });

  it('生成 2 个 crosscut 节点', () => {
    const { nodes } = buildStructuralProjection(MANIFEST);
    const cc = nodes.filter((n) => n.node_type === 'crosscut');
    expect(cc).toHaveLength(2);
  });

  it('G1 存储别名 F5', () => {
    const { nodes } = buildStructuralProjection(MANIFEST);
    const g1 = nodes.find((n) => n.node_key === 'G1');
    expect(g1?.aliases).toContain('F5');
  });

  it('contains 边数 = capability 数', () => {
    const { edges } = buildStructuralProjection(MANIFEST);
    const contains = edges.filter((e) => e.edge_type === 'contains');
    expect(contains).toHaveLength(11);
  });

  it('hands_off_to 边数 = boundary 数', () => {
    const { edges } = buildStructuralProjection(MANIFEST);
    const handoff = edges.filter((e) => e.edge_type === 'hands_off_to');
    expect(handoff).toHaveLength(1);
  });

  it('owner_state=assigned 当 crosscut 有 owner', () => {
    const { nodes } = buildStructuralProjection(MANIFEST);
    const sd = nodes.find((n) => n.node_key === 'skill_distribution');
    expect(sd?.attributes?.owner_state).toBe('assigned');
  });

  it('相同 manifest 产生相同节点集合（确定性）', () => {
    const r1 = buildStructuralProjection(MANIFEST);
    const r2 = buildStructuralProjection(MANIFEST);
    const keys1 = r1.nodes.map((n) => n.node_key).sort().join(',');
    const keys2 = r2.nodes.map((n) => n.node_key).sort().join(',');
    expect(keys1).toBe(keys2);
  });
});

// ─── 刀5 通用性验证：ZenithJoy scope ──────────────────────────────────────────
describe('buildStructuralProjection — ZenithJoy scope（通用性验证）', () => {
  it('ZenithJoy manifest 生成 2 个 value_stream 节点', () => {
    const { nodes } = buildStructuralProjection(ZENITHJOY_MANIFEST);
    const vs = nodes.filter((n) => n.node_type === 'value_stream');
    expect(vs).toHaveLength(2);
    expect(vs.map((n) => n.node_key).sort()).toEqual(['content', 'distribution']);
  });

  it('ZenithJoy manifest 生成 5 个 capability 节点', () => {
    const { nodes } = buildStructuralProjection(ZENITHJOY_MANIFEST);
    expect(nodes.filter((n) => n.node_type === 'capability')).toHaveLength(5);
  });

  it('ZenithJoy manifest 生成 1 条 boundary（hands_off_to）', () => {
    const { edges } = buildStructuralProjection(ZENITHJOY_MANIFEST);
    const handoff = edges.filter((e) => e.edge_type === 'hands_off_to');
    expect(handoff).toHaveLength(1);
    expect(handoff[0].from_key).toBe('C3');
    expect(handoff[0].to_key).toBe('D1');
  });

  it('ZenithJoy manifest 生成 3 个 crosscut 节点', () => {
    const { nodes } = buildStructuralProjection(ZENITHJOY_MANIFEST);
    expect(nodes.filter((n) => n.node_type === 'crosscut')).toHaveLength(3);
  });

  it('crosscut owner_state 正确：有 owner → assigned，无 → unassigned', () => {
    const { nodes } = buildStructuralProjection(ZENITHJOY_MANIFEST);
    const accountChain = nodes.find((n) => n.node_key === 'account_chain');
    const aiEngine = nodes.find((n) => n.node_key === 'ai_engine');
    expect(accountChain?.attributes?.owner_state).toBe('unassigned');
    expect(aiEngine?.attributes?.owner_state).toBe('assigned');
  });

  it('ZenithJoy 与 Cecelia 节点键集合不重叠（零领域硬编码验证）', () => {
    const { nodes: zjNodes } = buildStructuralProjection(ZENITHJOY_MANIFEST);
    const zjKeySet = new Set(zjNodes.map((n) => n.node_key));
    const ceceliaSpecificKeys = ['factory', 'butler', 'F0', 'F1', 'F2', 'F3', 'F4', 'MJ5', 'G1', 'G2', 'G3', 'G4', 'G5'];
    for (const k of ceceliaSpecificKeys) {
      expect(zjKeySet.has(k), `ZenithJoy 不应包含 Cecelia 专有键 '${k}'`).toBe(false);
    }
  });
});
