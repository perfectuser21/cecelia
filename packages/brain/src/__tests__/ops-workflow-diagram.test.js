import { describe, it, expect } from 'vitest';
import { buildStageFlow, buildWorkflowMermaid, buildWorkflowPageBlocks } from '../ops-collector.js';

// 简化版真实结构：入口 → 准备X → 阶段X → 裁决X →（继续/中止）
const WF = {
  id: 'AwrSocialLeadgenV4', name: 'Social Leadgen V4', active: true,
  nodes: [
    { name: '运行入口 /v4/run', type: 'n8n-nodes-base.webhook' },
    { name: '准备 手机预检', type: 'n8n-nodes-base.code' },
    { name: '阶段 手机预检', type: 'n8n-nodes-base.executeWorkflow' },
    { name: '裁决 手机预检', type: 'n8n-nodes-base.switch' },
    { name: '准备 视频发现', type: 'n8n-nodes-base.code' },
    { name: '阶段 视频发现', type: 'n8n-nodes-base.executeWorkflow' },
    { name: '裁决 视频发现', type: 'n8n-nodes-base.switch' },
    { name: '准备 中止归档', type: 'n8n-nodes-base.code' },
    { name: '中止归档', type: 'n8n-nodes-base.executeWorkflow' },
  ],
  connections: {
    '运行入口 /v4/run': { main: [[{ node: '准备 手机预检' }]] },
    '准备 手机预检': { main: [[{ node: '阶段 手机预检' }]] },
    '阶段 手机预检': { main: [[{ node: '裁决 手机预检' }]] },
    '裁决 手机预检': { main: [[{ node: '准备 视频发现' }], [{ node: '准备 中止归档' }]] },
    '准备 视频发现': { main: [[{ node: '阶段 视频发现' }]] },
    '阶段 视频发现': { main: [[{ node: '裁决 视频发现' }]] },
    '裁决 视频发现': { main: [[{ node: '准备 中止归档' }]] },
  },
};

describe('buildStageFlow（按真实连线求业务阶段顺序）', () => {
  it('顺着连线走出阶段序列，不靠节点数组顺序', () => {
    expect(buildStageFlow(WF)).toEqual(['手机预检', '视频发现']);
  });
  it('无 connections → 回退节点顺序', () => {
    const noConn = { nodes: WF.nodes, connections: {} };
    expect(buildStageFlow(noConn)).toEqual(['手机预检', '视频发现']);
  });
  it('空画布 → 空数组', () => {
    expect(buildStageFlow({ nodes: [], connections: {} })).toEqual([]);
  });
});

describe('buildWorkflowMermaid', () => {
  it('生成 flowchart，含阶段节点与顺序连线', () => {
    const m = buildWorkflowMermaid(WF);
    expect(m).toContain('flowchart TD');
    expect(m).toContain('手机预检');
    expect(m).toContain('视频发现');
    expect(m).toMatch(/S1\[.*手机预检.*\] --> S2\[.*视频发现.*\]/);
  });
  it('标出中止分支（裁决可跳出）', () => {
    expect(buildWorkflowMermaid(WF)).toContain('中止');
  });
  it('无阶段流程 → 返回 null（不画空图）', () => {
    expect(buildWorkflowMermaid({ nodes: [{ name: 'x', type: 'n8n-nodes-base.code' }], connections: {} })).toBeNull();
  });
});

describe('buildWorkflowPageBlocks（Notion 页正文）', () => {
  it('含 mermaid code block + 阶段清单 + 节点构成', () => {
    const blocks = buildWorkflowPageBlocks(WF, { node_count: 9, stage_count: 2, uses_agents: ['work-commander'] });
    const types = blocks.map((b) => b.type);
    expect(types).toContain('code');
    const code = blocks.find((b) => b.type === 'code');
    expect(code.code.language).toBe('mermaid');
    expect(code.code.rich_text[0].text.content).toContain('flowchart TD');
    const all = JSON.stringify(blocks);
    expect(all).toContain('手机预检');
    expect(all).toContain('work-commander');
    expect(all).toContain('9');  // 节点数出现在构成说明里
  });
  it('无阶段流程：不放 mermaid，只放说明', () => {
    const blocks = buildWorkflowPageBlocks(
      { nodes: [{ name: 'x', type: 'n8n-nodes-base.httpRequest' }], connections: {} },
      { node_count: 1, stage_count: 0, uses_agents: [] });
    expect(blocks.some((b) => b.type === 'code')).toBe(false);
    expect(blocks.length).toBeGreaterThan(0);
  });
});
