/**
 * qiumi-source-cheapgates-contract.test.js
 *
 * 契约守卫：parseZhPage → qiumiSourceFromNotion → cheapGates 三段串联。
 *
 * 本 bug 的根因是写入方存 agent_workflow_ids、读取方读 src.relations.*，
 * 两头各自有绿测试、中间没有横跨两端的契约测试。本文件补上这一条：
 * 任何一段改了键名，这里都会断言红（不是崩溃红）。
 *
 * 必须 workflow 与 agent 两条都断言——只断 workflow 挡不住"实现忘了喂 agents 池"，
 * 而 agent 分支正是唤醒 qiumi-router.js:117-124 agentRef:serial 支路的那条。
 */
import { describe, it, expect } from 'vitest';
import { parseZhPage } from '../../notion-gtd-sync.js';
import { qiumiSourceFromNotion } from '../../lib/qiumi-source.js';
import { cheapGates } from '../cheap-gates.js';
import { qiumiEnv } from '../env.js';

const env = qiumiEnv({});

const pool = {
  agents: [{ name: 'infra', notionId: 'ag-1' }],
  phones: [{ serial: 'ANGYVB4227006983', host: 'xian-m4' }],
  workflows: [{ name: '朋友圈跟圈', notionId: 'wf-1' }, { name: '周报生成', notionId: 'wf-2' }],
};

/** Notion 中文 GTD 页（形状照 notion-push-sync-marked-ingest.test.js:20-33）。 */
const zhPage = (relationIds) => ({
  id: '11111111-2222-3333-4444-555555555555',
  created_time: '2026-09-23T00:10:00.000Z',
  properties: {
    '名称': { title: [{ plain_text: '把这件事办了' }] },
    '备注': { rich_text: [{ plain_text: '' }] },
    '状态': { status: { name: '委派' } },
    'OpenClaw任务号': { rich_text: [] },
    '优先级': { select: { name: '高' } },
    '预期完成日期': { date: null },
    '执行通道': { select: null },
    '执行 Agent / Workflow': { relation: relationIds.map((id) => ({ id })) },
    '使用 Skill': { relation: [] },
    'AI 业务任务': { relation: [] },
    '负责人': { people: [] },
    '归档': { checkbox: false },
  },
});

/** 三段串联：真 Notion 页 → parseZhPage → qiumiSourceFromNotion → cheapGates */
const runChain = (relationIds) => {
  const zh = parseZhPage(zhPage(relationIds));
  const qiumi_source = qiumiSourceFromNotion({
    title: zh.title, zh, en: { description: '' }, zhBody: '把这件事办了', enBody: '', dueAt: null,
  });
  return cheapGates({ id: 't1', task_type: 'qiumi_task', payload: { qiumi_source } }, pool, env);
};

describe('契约：Notion 填的「执行 Agent / Workflow」一路走到便宜闸', () => {
  it('填了 workflow → workflowRef 命中，matchedBy 含 relation:workflow', () => {
    const g = runChain(['wf-2']);
    expect(g.workflowRef).toBe('周报生成');
    expect(g.matchedBy).toContain('relation:workflow');
  });

  it('填了 agent → department 命中，matchedBy 含 relation:agent（挡"忘了喂 agents 池"）', () => {
    const g = runChain(['ag-1']);
    expect(g.department).toBe('infra');
    expect(g.matchedBy).toContain('relation:agent');
  });

  it('同时填 workflow 与 agent → 两个都命中，matchedBy 顺序恒为 workflow 在前', () => {
    const g = runChain(['ag-1', 'wf-2']);
    expect(g.workflowRef).toBe('周报生成');
    expect(g.department).toBe('infra');
    expect(g.matchedBy).toEqual(['relation:workflow', 'relation:agent']);
  });

  it('填的 id 不在池里（如 workflow 已停用 active=FALSE）→ 不命中，matchedBy 不得出现 relation:*（判定点 0aa5d290）', () => {
    const g = runChain(['wf-does-not-exist']);
    expect(g.workflowRef).toBeNull();
    expect(g.department).toBeNull();
    expect(g.matchedBy.some((m) => m.startsWith('relation:'))).toBe(false);
  });

  it('什么都没填 → 不命中，回落交给 Jev（不崩）', () => {
    const g = runChain([]);
    expect(g.workflowRef).toBeNull();
    expect(g.matchedBy.some((m) => m.startsWith('relation:'))).toBe(false);
  });
});
