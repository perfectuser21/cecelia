import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startCallbackFixture, stopCallbackFixture, sourceTask, callback, readTask, createTaskHttp } from '../../__tests__/helpers/callback-closure-pg.js';

// 旧五条自动传播边的生产者已退役。保留真实历史回执、取消链隔离、有头账本与新无头拒绝合同；
// 不用冻结的旧 OKR 夹具复活自动派生，也不把源码字符串当 feature 写入保障。
let pool;
beforeAll(async () => { pool = await startCallbackFixture(); });
afterAll(stopCallbackFixture);
describe('历史 Harness callback 兼容与现役入口拒绝', () => {
  for (const taskType of ['harness_planner', 'harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_fix', 'harness_initiative']) {
    it(`新无头 ${taskType} 经真实HTTP建单拒绝，PG无落行`, async () => {
      const title = `callback-retired-${randomUUID()}`;
      const response = await createTaskHttp({ title, task_type: taskType, priority: 'P2', trigger_source: 'manual',
        payload: { harness_runtime: 'kernel-v1', orchestrator: 'skill-relay', repo: 'cecelia' } });
      expect(response.status, JSON.stringify(response.body)).toBe(422);
      expect(response.body.reason_code).toBe('no_executor_for_task_type');
      expect(response.body.route).toBe(taskType === 'harness_initiative' ? 'retired-harness-kernel' : 'retired-harness');
      expect((await pool.query('SELECT id FROM tasks WHERE title=$1', [title])).rows).toEqual([]);
    });
  }
  for (const taskType of ['harness_contract_propose', 'harness_contract_review', 'harness_generate', 'harness_fix', 'harness_evaluate']) {
    it(`存量 ${taskType} 回执真实落终态，已取消链不能再派生任务`, async () => {
      const planner = await sourceTask('harness_planner');
      await pool.query("UPDATE tasks SET status='cancelled' WHERE id=$1", [planner.id]);
      const plannerBefore = await readTask(planner.id);
      const featureId = randomUUID();
      const task = await sourceTask(taskType, { payload: { planner_task_id: planner.id, feature_id: featureId, harness_mode: true } });
      const before = (await pool.query('SELECT count(*)::int AS n FROM tasks')).rows[0].n;
      const response = await callback(task, { verdict: 'APPROVED', summary: '历史兼容回执' });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body.reason).toBe('planner_cancelled');
      const stored = await readTask(task.id);
      expect(stored.status).toBe('completed'); expect(stored.completed_at).toBeInstanceOf(Date);
      expect(stored.payload.feature_id).toBe(featureId);
      if (['harness_contract_review', 'harness_evaluate'].includes(taskType)) expect(stored.result.verdict).toBe('APPROVED');
      expect(await readTask(planner.id)).toEqual(plannerBefore);
      expect((await pool.query('SELECT count(*)::int AS n FROM tasks')).rows[0].n).toBe(before);
      expect((await pool.query('SELECT processed_at FROM callback_queue WHERE task_id=$1', [task.id])).rows.every(r => r.processed_at)).toBe(true);
    });
  }
  it('有头 harness_initiative 账本回执保留 headed_manual，落真实终态且不复活无头子链', async () => {
    const task = await sourceTask('harness_initiative', { payload: { headed_manual: true } });
    const before = (await pool.query('SELECT count(*)::int AS n FROM tasks')).rows[0].n;
    const response = await callback(task, { summary: '有头完成，无自动派生请求' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.new_status).toBe('completed');
    const stored = await readTask(task.id);
    expect(stored.status).toBe('completed'); expect(stored.payload.headed_manual).toBe(true);
    expect((await pool.query('SELECT count(*)::int AS n FROM tasks')).rows[0].n).toBe(before);
  });
});
