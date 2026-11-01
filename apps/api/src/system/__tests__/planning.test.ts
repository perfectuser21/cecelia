import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { GeneratedPlan, PlanTask, CommittedTask, TriggeredTask } from '../planning.js';
import { createSystemApiFixture, goalId, taskIds, type SystemApiFixture } from './helpers/system-api-fixture.js';

interface PlanningBody {
  success: boolean;
  plan: GeneratedPlan;
  plan_id: string;
  active_plan: string;
  progress: { total: number; completed: number; in_progress: number; pending: number };
  next_task: PlanTask;
  committed_tasks: CommittedTask[];
  triggered_tasks: TriggeredTask[];
  next_review: string;
  timestamp: string;
}
let api: SystemApiFixture<PlanningBody>;
beforeAll(async () => { api = await createSystemApiFixture<PlanningBody>(); });
afterAll(async () => { await api?.close(); });
beforeEach(async () => { await api.reset(); await api.seedPlanning(); });

async function generate(scope = 'daily') {
  const response = await api.json('/plan/generate', { scope });
  expect(response.status).toBe(201);
  const data = await response.json();
  expect(data.success).toBe(true);
  return data.plan;
}
async function memory(key: string) {
  const { rows } = await api.pool.query('SELECT layer,category,value FROM memory_entries WHERE key=$1', [key]);
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe('Planning Engine API — 真实计划逻辑、SQL 与 HTTP', () => {
  it('daily 选中 P0/P1，排除 P2 与已完成任务', async () => {
    const plan = await generate();
    expect(plan.plan_id).toMatch(/^plan_daily_\d{8}$/);
    expect(plan.scope).toBe('daily');
    expect(plan.tasks.map((task: { id: string }) => task.id)).toEqual(taskIds.slice(0, 3));
    expect(plan.summary).toEqual({ total: 3, by_priority: { P0: 2, P1: 1 } });
    expect(plan.reasoning).toContain('质量目标 (P0, 25% 完成)');
  });

  it('weekly 包含 P2，仍排除 completed P0', async () => {
    const plan = await generate('weekly');
    expect(plan.plan_id).toMatch(/^plan_weekly_\d{8}$/);
    expect(plan.scope).toBe('weekly');
    expect(plan.tasks.map((task: { id: string }) => task.id)).toEqual(taskIds.slice(0, 4));
    expect(plan.summary).toEqual({ total: 4, by_priority: { P0: 2, P1: 1, P2: 1 } });
  });

  it('非法 scope 返回 400 且不保存计划', async () => {
    const response = await api.json('/plan/generate', { scope: 'invalid' });
    expect(response.status).toBe(400);
    expect((await response.json()).success).toBe(false);
    expect((await api.pool.query("SELECT key FROM memory_entries WHERE key LIKE 'plan_%'")).rows).toEqual([]);
  });

  it('未提供 scope 时生成 daily', async () => {
    const response = await api.json('/plan/generate');
    expect(response.status).toBe(201);
    expect((await response.json()).plan.scope).toBe('daily');
  });

  it('status 根据真实 tasks 当前状态计算进度', async () => {
    const plan = await generate();
    await api.pool.query("UPDATE tasks SET status='completed' WHERE id=$1", [taskIds[0]]);
    const data = await (await api.request('/plan/status')).json();
    expect(data.success).toBe(true);
    expect(data.active_plan).toBe(plan.plan_id);
    expect(data.progress).toEqual({ total: 3, completed: 1, in_progress: 1, pending: 1 });
  });

  it('status 返回下一条尚未完成的真实任务', async () => {
    await generate();
    await api.pool.query("UPDATE tasks SET status='completed' WHERE id=$1", [taskIds[0]]);
    const data = await (await api.request('/plan/status')).json();
    expect(data.success).toBe(true);
    expect(data.next_task).toMatchObject({ id: taskIds[1], title: '测试回归', priority: 'P0', status: 'in_progress' });
  });

  it('按 planId 返回已持久化的同一计划', async () => {
    const plan = await generate();
    const response = await api.request(`/plan/${plan.plan_id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, plan });
  });

  it('不存在的计划返回 404', async () => {
    expect((await api.request('/plan/plan_nonexistent_99999999')).status).toBe(404);
  });

  it('计划真身保存在 working/state memory', async () => {
    const plan = await generate();
    expect(await memory(plan.plan_id)).toEqual({ layer: 'working', category: 'state', value: plan });
  });

  it('current_plan 引用保存在 working/context memory', async () => {
    const plan = await generate();
    expect(await memory('current_plan')).toEqual({ layer: 'working', category: 'context', value: { plan_id: plan.plan_id, scope: 'daily', created_at: plan.created_at } });
  });

  it('乱序插入的任务必须按 P0→P1→P2 排序，同优先级按时间', async () => {
    const plan = await generate('weekly');
    expect(plan.tasks.map((task: { priority: string }) => task.priority)).toEqual(['P0', 'P0', 'P1', 'P2']);
    expect(plan.tasks.map((task: { title: string }) => task.title)).toEqual(['实现入口', '测试回归', '更新文档', '清理文件']);
  });

  it('每条任务的 why 解释目标、优先级及命中的当前焦点', async () => {
    const plan = await generate();
    expect(plan.tasks.map((task: { why: string }) => task.why)).toEqual([
      '支撑目标「质量目标」，最高优先级任务',
      '支撑目标「质量目标」，最高优先级任务，与当前焦点「测试」相关',
      '支撑目标「质量目标」，重要任务',
    ]);
  });

  it('expected_evidence 根据开发、测试、文档任务分别派生', async () => {
    const plan = await generate();
    expect(plan.tasks.map((task: { expected_evidence: string }) => task.expected_evidence)).toEqual(['代码提交 + PR 合并', '测试通过 + 覆盖率报告', '文档更新 + 版本号变更']);
  });

  it('source_refs 保留目标身份，无目标任务不编造引用', async () => {
    const plan = await generate('weekly');
    expect(plan.tasks.map((task: { source_refs: unknown }) => task.source_refs)).toEqual([
      [{ type: 'goal', id: goalId, title: '质量目标' }],
      [{ type: 'goal', id: goalId, title: '质量目标' }],
      [{ type: 'goal', id: goalId, title: '质量目标' }],
      [],
    ]);
  });

  it('commit 保存缺失任务及计划证据，已有任务复用身份', async () => {
    const plan = await generate();
    await api.pool.query('DELETE FROM tasks WHERE id=$1', [taskIds[0]]);
    const response = await api.json(`/plan/${plan.plan_id}/commit`, { limit: 3 });
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.plan_id).toBe(plan.plan_id);
    expect(data.committed_tasks).toHaveLength(2);
    expect(data.committed_tasks[1]).toEqual({ plan_task_id: taskIds[1], task_id: taskIds[1], title: '测试回归' });
    const insertedId = data.committed_tasks[0].task_id;
    expect(insertedId).not.toBe(taskIds[0]);
    const { rows } = await api.pool.query('SELECT title,priority,status,metadata FROM tasks WHERE id=$1', [insertedId]);
    expect(rows).toEqual([{ title: '实现入口', priority: 'P0', status: 'pending', metadata: { source_plan_id: plan.plan_id, why: '支撑目标「质量目标」，最高优先级任务', expected_evidence: '代码提交 + PR 合并', source_refs: [{ type: 'goal', id: goalId, title: '质量目标' }] } }]);
    const events = (await api.pool.query("SELECT value FROM memory_entries WHERE value->>'type'='plan_commit'")).rows;
    expect(events).toHaveLength(1);
    expect(events[0].value.committed_count).toBe(2);
  });

  it('commit 不存在的计划返回 404，不创建任务或事件', async () => {
    expect((await api.json('/plan/plan_nonexistent_99999999/commit')).status).toBe(404);
    expect((await api.pool.query('SELECT COUNT(*) AS count FROM tasks')).rows[0].count).toBe('5');
    expect((await api.pool.query("SELECT key FROM memory_entries WHERE key LIKE 'commit_%'")).rows).toEqual([]);
  });

  it('commit limit=1 只提交最高优先级第一条', async () => {
    const plan = await generate();
    const response = await api.json(`/plan/${plan.plan_id}/commit`, { limit: 1 });
    expect(response.status).toBe(201);
    expect((await response.json()).committed_tasks).toEqual([{ plan_task_id: taskIds[0], task_id: taskIds[0], title: '实现入口' }]);
  });

  it('nightly 真实生成计划、提交两条 P0 并经隔离 executor 触发', async () => {
    const response = await api.json('/plan/nightly');
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data).toMatchObject({ success: true, committed_count: 2, triggered_count: 2, summary: '生成 3 个任务，落库 2 个，触发执行 2 个' });
    expect(data.plan_id).toMatch(/^plan_daily_\d{8}$/);
    expect(Date.parse(data.next_review)).toBeGreaterThan(Date.parse(data.timestamp));
    expect(api.executions.map(execution => execution.task_id)).toEqual(taskIds.slice(0, 2));
    expect(data.triggered_tasks.map((task: { status: string }) => task.status)).toEqual(['triggered', 'triggered']);
    for (const [index, execution] of api.executions.entries()) {
      const prd = await readFile(execution.prd_path, 'utf8');
      expect(prd).toContain(index === 0 ? '# PRD - 实现入口' : '# PRD - 测试回归');
      expect(prd).toContain(`- Plan ID: ${data.plan_id}`);
    }
  });

  it('nightly 与 task_triggered 事件真实持久化在 episodic memory', async () => {
    const data = await (await api.json('/plan/nightly')).json();
    const entry = await memory(`nightly_plan_${data.plan_id}`);
    expect(entry).toMatchObject({ layer: 'episodic', category: 'event', value: { type: 'nightly_plan', plan_id: data.plan_id, committed_count: 2, triggered_count: 2 } });
    const triggers = (await api.pool.query("SELECT value->>'task_id' AS task_id FROM memory_entries WHERE value->>'type'='task_triggered' ORDER BY value->>'task_id'")).rows;
    expect(triggers).toEqual([{ task_id: taskIds[0] }, { task_id: taskIds[1] }]);
  });
});
