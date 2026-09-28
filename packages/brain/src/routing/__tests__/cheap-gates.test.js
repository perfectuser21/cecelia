import { describe, it, expect, vi } from 'vitest';
import { loadRegistryPool, cheapGates } from '../cheap-gates.js';
import { qiumiEnv } from '../env.js';
import { buildQiumiSource } from '../../lib/qiumi-source.js';

const env = qiumiEnv({});
const pool = {
  agents: [{ name: 'infra', notionId: 'a2' }],
  phones: [{ serial: 'ANGYVB4227006983', host: 'xian-m4' }],
  workflows: [{ name: '朋友圈跟圈', notionId: 'w1' }, { name: '周报生成', notionId: 'w2' }],
};
const mk = (src) => ({
  id: 't1',
  task_type: 'qiumi_task',
  payload: { qiumi_source: buildQiumiSource({ title: '', remark: '', body: '', channel: null, ...src }) },
});

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

  it('ops_workflows 只取 source=n8n（scheduler 行是 Brain 内部 job，job 名不能被当 workflowRef 命中）', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await loadRegistryPool(query);
    const wfSql = query.mock.calls.find(([sql]) => /FROM ops_workflows/.test(sql))[0];
    expect(wfSql).toMatch(/source\s*=\s*'n8n'/);
    expect(wfSql).toMatch(/active = TRUE/);
  });
});

describe('cheapGates', () => {
  it('relation 命中设备工作流（名字含设备关键词）→ isDevice + workflowRef，matchedBy=relation:workflow（硬约束）', () => {
    const g = cheapGates(mk({ agentWorkflowIds: ['w1'] }), pool, env);
    expect(g).toMatchObject({ isDevice: true, workflowRef: '朋友圈跟圈', matchedBy: ['relation:workflow'] });
  });
  it('relation 命中非部门 agent → department 为 null，agentRef 记下（不把 agent 名当部门）', () => {
    const poolWithNonDeptAgent = { ...pool, agents: [...pool.agents, { name: 'phone-ANGYVB4227006983', notionId: 'a1' }] };
    const g = cheapGates(mk({ agentWorkflowIds: ['a1'] }), poolWithNonDeptAgent, env);
    expect(g).toMatchObject({ department: null, agentRef: 'phone-ANGYVB4227006983', matchedBy: ['relation:agent'] });
  });
  it('执行通道非空 → isDevice，workflowRef=通道名', () => {
    const g = cheapGates(mk({ channel: '朋友圈跟圈' }), pool, env);
    expect(g).toMatchObject({ isDevice: true, workflowRef: '朋友圈跟圈', matchedBy: ['channel'] });
  });
  it('relation 命中非设备工作流 + channel 非空 → isDevice=true，workflowRef 保留 relation 的（不被 channel 覆盖）', () => {
    const g = cheapGates(mk({ channel: '发布', agentWorkflowIds: ['w2'] }), pool, env);
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

  it('多选 workflow → 取用户在 Notion 的选择顺序首个命中，不是池的字母序', () => {
    // 池按 name 排序时「周报生成」排在「朋友圈跟圈」之后；用户先选 w2 就该 w2 赢。
    // 这条是本次 tie-break 行为变更的唯一区分用例——改回遍历池的老写法它必红。
    const g = cheapGates(mk({ agentWorkflowIds: ['w2', 'w1'] }), pool, env);
    expect(g.workflowRef).toBe('周报生成');
  });

  it('同一 id 同时命中 workflow 池与 agent 池 → 两个都设，matchedBy 顺序 workflow 在前', () => {
    // ops_agents.notion_id 与 ops_workflows.notion_id 都是 TEXT 且无 UNIQUE
    // （migrations/433:12、436:16），投影重建/人工补录可能让同一 page id 在两表都有行。
    // 不假装它不会发生。
    const both = { ...pool, agents: [{ name: 'infra', notionId: 'w2' }] };
    const g = cheapGates(mk({ agentWorkflowIds: ['w2'] }), both, env);
    expect(g).toMatchObject({ workflowRef: '周报生成', department: 'infra', matchedBy: ['relation:workflow', 'relation:agent'] });
  });

  it('指定的 id 不在池里（workflow 已停用 active=FALSE）→ 回落，matchedBy 不出现 relation:*（判定点 0aa5d290）', () => {
    const g = cheapGates(mk({ agentWorkflowIds: ['w-disabled'] }), pool, env);
    expect(g.workflowRef).toBeNull();
    expect(g.matchedBy.some((m) => m.startsWith('relation:'))).toBe(false);
  });

  describe('回归：正文文字永不产生模型（任务 0d4215f2，模型只认【执行参数】块）', () => {
    const envM = qiumiEnv({ QIUMI_MODEL_ALLOWLIST: JSON.stringify(['xai/grok-4.7', 'openai/gpt-5.6-sol', 'xai/grok-4.20-multi-agent']) });
    it('模板里的「调用Agent：…」不再被当成「用 agent」命中 grok-4.20-multi-agent', () => {
      const out = cheapGates(mk({ body: '任务目标\n调用Agent： 调用抖音平台数据采集 Agent \n执行要求' }), pool, envM);
      expect(out.hardModel).toBeNull();
      expect(out.matchedBy).not.toContain('text:model');
    });
    it('即便正文写「用 grok-4.7 跑」也不再产生 hardModel', () => {
      const out = cheapGates(mk({ body: '这个活用 grok-4.7 跑' }), pool, envM);
      expect(out.hardModel).toBeNull();
      expect(out.matchedBy).not.toContain('text:model');
    });
  });

});
