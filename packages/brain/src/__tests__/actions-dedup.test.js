/** 真 createTask + 真 PG 去重；只截断下游 routed writer，禁止创建执行任务。 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createDebt07Fixture } from './helpers/debt-07-pg.js';
vi.mock('../db.js', () => ({ default: { query() { throw new Error('禁止访问默认池'); } } }));
const writer = vi.hoisted(() => vi.fn());
vi.mock('../work-routing-store.js', () => ({ createRoutedTask: writer }));
vi.mock('../task-updater.js', () => ({ broadcastTaskState: vi.fn(() => { throw new Error('禁止广播'); }) }));
vi.mock('../lib/task-terminal.js', () => ({ afterTerminalTransition: vi.fn(), isTerminalStatus: vi.fn() }));
vi.mock('../workflow-authoring/task-guard.js', () => ({ assertAuthoringCompletion: vi.fn() }));
let fixture, db, createTask, goalId, projectId;
const continuation = new Error('第07路已到达下游 writer 边界');
beforeAll(async () => {
  fixture = await createDebt07Fixture();
  db = fixture.pool;
  ({ createTask } = await import('../actions.js'));
  goalId = (await db.query("INSERT INTO goals (title) VALUES ('第07路') RETURNING id")).rows[0].id;
  projectId = (await db.query("INSERT INTO projects (name) VALUES ('第07路') RETURNING id")).rows[0].id;
});
afterAll(async () => { if (fixture) await fixture.close(); });
beforeEach(async () => {
  if (!db) return;
  await db.query('DELETE FROM tasks');
  writer.mockReset().mockRejectedValue(continuation);
});
async function seed({ status = 'queued', age = 0, title = '待测任务', goal = null, project = null } = {}) {
  return (await db.query(`INSERT INTO tasks (title, status, goal_id, project_id, completed_at, updated_at)
    VALUES ($1, $2, $3, $4, NOW() - $5 * INTERVAL '1 hour', NOW() - $5 * INTERVAL '1 hour') RETURNING *`,
  [title, status, goal, project, age])).rows[0];
}
function call(overrides = {}) {
  return createTask({ title: '待测任务', task_type: 'research', trigger_source: 'test', db, ...overrides });
}
async function deduplicates(overrides, row) {
  const result = await call(overrides);
  expect(result.success).toBe(true);
  expect(result.deduplicated).toBe(true);
  expect(result.task.id).toBe(row.id);
  expect(writer).not.toHaveBeenCalled();
  expect((await db.query('SELECT id FROM tasks')).rows).toHaveLength(1);
}
async function continues(overrides) {
  await expect(call(overrides)).rejects.toBe(continuation);
  expect(writer).toHaveBeenCalledOnce();
}
describe('createTask 真实 PG 去重', () => {
  it.each(['queued', 'in_progress'])('%s 相同 title/goal/project 阻止重复', async status => {
    const row = await seed({ status, goal: goalId, project: projectId });
    await deduplicates({ goal_id: goalId, project_id: projectId }, row);
  });
  it('NULL goal/project 使用空值相等语义去重', async () => { await deduplicates({}, await seed()); });
  it('24h 内 completed 阻止重复', async () => { await deduplicates({}, await seed({ status: 'completed', age: 2 })); });
  it('25h 前 completed 允许后续创建', async () => { await seed({ status: 'completed', age: 25 }); await continues({}); });
  it.each(['canceled', 'cancelled'])('%s 不阻止后续创建并保留原拼写', async status => {
    const row = await seed({ status });
    await continues({});
    expect((await db.query('SELECT status FROM tasks WHERE id=$1', [row.id])).rows[0].status).toBe(status);
  });
  it('25h 前 canceled 允许后续创建', async () => { await seed({ status: 'canceled', age: 25 }); await continues({}); });
  it('不同 title 允许后续创建', async () => { await seed(); await continues({ title: '其他任务' }); });
  it('不同 goal 允许后续创建', async () => { await seed(); await continues({ goal_id: goalId }); });
  it('不同 project 允许后续创建', async () => { await seed(); await continues({ project_id: projectId }); });
  it.each(['rumination', 'cortex', 'auto_fix'])('%s 来源 72h 内 failed 阻止重复', async trigger_source => {
    await deduplicates({ trigger_source }, await seed({ status: 'failed', age: 48 }));
  });
  it('普通来源 failed 不阻止后续创建', async () => { await seed({ status: 'failed', age: 2 }); await continues({}); });
  it('系统来源 73h 前 failed 不阻止后续创建', async () => {
    await seed({ status: 'failed', age: 73 }); await continues({ trigger_source: 'cortex' });
  });
});
