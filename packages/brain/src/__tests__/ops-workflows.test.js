import { describe, it, expect } from 'vitest';
import { parseN8nWorkflows, resolveWorkflowAgents, countStages } from '../ops-collector.js';

// 三条流程：主流程经通道单点间接调 agent（传递闭包才能算出真实归属）
const FIXTURE = [
  {
    id: 'AwrSocialLeadgenV4', name: 'Social Leadgen V4（8阶段触达）', active: true,
    nodes: [
      { name: '运行入口 /v4/run', type: 'n8n-nodes-base.webhook', parameters: {} },
      { name: '阶段 手机预检', type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: { value: 'OpcCmdStageCallV4' } } },
      { name: '阶段 视频发现', type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: { value: 'OpcCmdStageCallV4' } } },
      { name: '裁决 手机预检', type: 'n8n-nodes-base.switch', parameters: {} },
    ],
  },
  {
    // 真实格式（实证 OpcCmdStageCallV4）：agent 走 HTTP 头 x-openclaw-agent-id，不是 JSON 字段
    id: 'OpcCmdStageCallV4', name: 'OPC Commander Stage Call V4（通道单点）', active: true,
    nodes: [
      { name: '调用 Work Commander', type: 'n8n-nodes-base.httpRequest',
        parameters: { sendHeaders: true, headerParameters: { parameters: [
          { name: 'x-openclaw-agent-id', value: 'work-commander' },
          { name: 'x-openclaw-session', value: 'abc' },
        ] } } },
    ],
  },
  {
    id: 'Idle', name: '只读地图', active: false,
    nodes: [{ name: 'sticky', type: 'n8n-nodes-base.stickyNote', parameters: {} }],
  },
];

describe('parseN8nWorkflows', () => {
  it('提取 id/名字/active/节点数/阶段数', () => {
    const rows = parseN8nWorkflows(FIXTURE);
    const v4 = rows.find((r) => r.wf_id === 'AwrSocialLeadgenV4');
    expect(v4.name).toBe('Social Leadgen V4（8阶段触达）');
    expect(v4.active).toBe(true);
    expect(v4.node_count).toBe(4);
    expect(v4.stage_count).toBe(2);          // 两个「阶段 *」节点
    expect(rows.find((r) => r.wf_id === 'Idle').active).toBe(false);
  });

  it('阶段名按顺序留在 meta（供 Notion 展示流程长什么样）', () => {
    const v4 = parseN8nWorkflows(FIXTURE).find((r) => r.wf_id === 'AwrSocialLeadgenV4');
    expect(v4.meta.stages).toEqual(['手机预检', '视频发现']);
  });

  it('非数组/空输入不抛，返回空', () => {
    expect(parseN8nWorkflows(null)).toEqual([]);
    expect(parseN8nWorkflows([])).toEqual([]);
  });
});

describe('countStages', () => {
  it('只数「阶段 X」节点，不数裁决/入口', () => {
    expect(countStages(FIXTURE[0].nodes)).toBe(2);
    expect(countStages(FIXTURE[1].nodes)).toBe(0);
  });
});

describe('resolveWorkflowAgents（传递闭包）', () => {
  it('主流程经通道单点间接调 → 解析出 work-commander', () => {
    expect(resolveWorkflowAgents('AwrSocialLeadgenV4', FIXTURE)).toEqual(['work-commander']);
  });
  it('通道自身直接引用 → 也解析得到', () => {
    expect(resolveWorkflowAgents('OpcCmdStageCallV4', FIXTURE)).toEqual(['work-commander']);
  });
  it('无 agent 引用 → 空数组（禁编造）', () => {
    expect(resolveWorkflowAgents('Idle', FIXTURE)).toEqual([]);
  });
  it('循环调用不死循环', () => {
    const loop = [
      { id: 'A', name: 'A', active: true, nodes: [{ name: 'x', type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: { value: 'B' } } }] },
      { id: 'B', name: 'B', active: true, nodes: [{ name: 'y', type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: { value: 'A' } } }] },
    ];
    expect(() => resolveWorkflowAgents('A', loop)).not.toThrow();
    expect(resolveWorkflowAgents('A', loop)).toEqual([]);
  });
  it('未知 id → 空数组', () => {
    expect(resolveWorkflowAgents('不存在', FIXTURE)).toEqual([]);
  });
});
