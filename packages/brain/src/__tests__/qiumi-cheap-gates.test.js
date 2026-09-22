import { describe, it, expect, vi } from 'vitest';
import { loadRegistryPool, cheapGates } from '../routing/cheap-gates.js';
import { qiumiEnv } from '../routing/env.js';

const env = qiumiEnv({});
const pool = {
  agents: [{ name: 'infra', notionId: 'a2' }],
  phones: [{ serial: 'ANGYVB4227006983', host: 'xian-m4' }],
  workflows: [{ name: '朋友圈跟圈', notionId: 'w1' }, { name: '周报生成', notionId: 'w2' }],
};
const mk = (src) => ({ id: 't1', task_type: 'qiumi_task', payload: { qiumi_source: { title: '', remark: '', body: '', channel: null, relations: { agents: [], workflows: [], skills: [] }, ...src } } });

describe('loadRegistryPool', () => {
  it('从 ops_agents/device_locks/ops_workflows 读三源，手机序列号来自 device_locks（生产真身，非 meta.serial）', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ name: 'infra', notion_id: 'b' }] })
      .mockResolvedValueOnce({ rows: [{ serial: 'X1', host: 'xian-m4' }] })
      .mockResolvedValueOnce({ rows: [{ name: '朋友圈跟圈', notion_id: 'w' }] });
    const p = await loadRegistryPool(query);
    expect(p.agents).toEqual([{ name: 'infra', notionId: 'b' }]);
    expect(p.phones).toEqual([{ serial: 'X1', host: 'xian-m4' }]);
    expect(p.workflows).toEqual([{ name: '朋友圈跟圈', notionId: 'w' }]);
    expect(query.mock.calls[0][0]).toMatch(/FROM ops_agents/);
    expect(query.mock.calls[1][0]).toMatch(/FROM device_locks/);
    expect(query.mock.calls[1][0]).toMatch(/device_type\s*=\s*'phone'/);
    expect(query.mock.calls[2][0]).toMatch(/FROM ops_workflows/);
  });
});

describe('cheapGates', () => {
  it('relation 命中设备工作流（名字含设备关键词）→ isDevice + workflowRef，matchedBy=relation:workflow（硬约束）', () => {
    const g = cheapGates(mk({ relations: { agents: [], workflows: ['w1'], skills: [] } }), pool, env);
    expect(g).toMatchObject({ isDevice: true, workflowRef: '朋友圈跟圈', matchedBy: ['relation:workflow'] });
  });
  it('relation 命中非部门 agent → department 为 null，agentRef 记下（不把 agent 名当部门）', () => {
    const poolWithNonDeptAgent = { ...pool, agents: [...pool.agents, { name: 'phone-ANGYVB4227006983', notionId: 'a1' }] };
    const g = cheapGates(mk({ relations: { agents: ['a1'], workflows: [], skills: [] } }), poolWithNonDeptAgent, env);
    expect(g).toMatchObject({ department: null, agentRef: 'phone-ANGYVB4227006983', matchedBy: ['relation:agent'] });
  });
  it('执行通道非空 → isDevice，workflowRef=通道名', () => {
    const g = cheapGates(mk({ channel: '朋友圈跟圈' }), pool, env);
    expect(g).toMatchObject({ isDevice: true, workflowRef: '朋友圈跟圈', matchedBy: ['channel'] });
  });
  it('relation 命中非设备工作流 + channel 非空 → isDevice=true，workflowRef 保留 relation 的（不被 channel 覆盖）', () => {
    const g = cheapGates(mk({ channel: '发布', relations: { agents: [], workflows: ['w2'], skills: [] } }), pool, env);
    expect(g).toMatchObject({ isDevice: true, workflowRef: '周报生成', matchedBy: ['relation:workflow', 'channel'] });
  });
  it('正文含 device_locks 序列号 → isDevice + serial（matchedBy=text:serial）', () => {
    const g = cheapGates(mk({ body: '用 ANGYVB4227006983 这台去发' }), pool, env);
    expect(g).toMatchObject({ isDevice: true, serial: 'ANGYVB4227006983', matchedBy: ['text:serial'] });
  });
  it('正文含设备关键词但无序列号 → isDevice=true, serial=null（留给 Jev 选账号，仍 fail-closed）', () => {
    const g = cheapGates(mk({ body: '给客户朋友圈点赞' }), pool, env);
    expect(g).toMatchObject({ isDevice: true, serial: null, matchedBy: ['text:keyword'] });
  });
  it('纯文字任务 → isDevice=false；写"用 Claude Code"→ hardEngine=claude', () => {
    const g = cheapGates(mk({ body: '用 Claude Code 把首页按钮改蓝' }), pool, env);
    expect(g).toMatchObject({ isDevice: false, serial: null, hardEngine: 'claude', matchedBy: ['text:engine'] });
  });
  it('"不用 claude" 不应误判为 claude 硬约束（负向前瞻）', () => {
    const g = cheapGates(mk({ body: '这个不用 claude 做' }), pool, env);
    expect(g.hardEngine).toBeNull();
  });
  it('正文含 "用 codex 做" → hardEngine=codex', () => {
    const g = cheapGates(mk({ body: '用 codex 做这件事' }), pool, env);
    expect(g.hardEngine).toBe('codex');
  });
  it('正文提到部门引导词+agent 名（让 infra）→ department=infra', () => {
    const g = cheapGates(mk({ body: '让 infra 查一下磁盘' }), pool, env);
    expect(g.department).toBe('infra');
  });
  it('部门名紧贴文字、无引导词（把 main 分支合了）→ department 为 null（防误命中）', () => {
    const g = cheapGates(mk({ body: '把 main 分支合了' }), pool, env);
    expect(g.department).toBeNull();
  });
  it('部门名紧贴文字、无引导词（开发dev环境）→ department 为 null（防误命中）', () => {
    const g = cheapGates(mk({ body: '开发dev环境' }), pool, env);
    expect(g.department).toBeNull();
  });
  it('人工态四个词出现在正文不影响判定（只看设备/引擎信号）', () => {
    const g = cheapGates(mk({ body: '收集 下一个行动 阻塞 淘汰' }), pool, env);
    expect(g.isDevice).toBe(false);
  });
  it('正文命中非设备工作流名（周报生成）→ workflowRef 但 isDevice=false', () => {
    const g = cheapGates(mk({ body: '本周的周报生成看一下进度' }), pool, env);
    expect(g).toMatchObject({ workflowRef: '周报生成', isDevice: false, matchedBy: ['text:workflow'] });
  });
  it('正文命中设备工作流名（朋友圈跟圈）→ isDevice=true', () => {
    const g = cheapGates(mk({ body: '记得把朋友圈跟圈这个活干了' }), pool, env);
    expect(g).toMatchObject({ workflowRef: '朋友圈跟圈', isDevice: true, matchedBy: ['text:workflow'] });
  });
  it('workflow 文本匹配要求长度≥3 且取最长命中（不是池里第一个）', () => {
    const poolWithShortWorkflow = { ...pool, workflows: [...pool.workflows, { name: '发布', notionId: 'w3' }] };
    const g = cheapGates(mk({ body: '把周报生成发出去' }), poolWithShortWorkflow, env);
    expect(g.workflowRef).toBe('周报生成');
  });
});
