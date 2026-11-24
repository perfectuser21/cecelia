import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startCallbackFixture, stopCallbackFixture, sourceTask, callback, readTask } from './helpers/callback-closure-pg.js';

let pool;
beforeAll(async () => { pool = await startCallbackFixture(); });
afterAll(stopCallbackFixture);
const output = (title) => JSON.stringify({ meeting_summary: '季度资源决议', krs: [
  { title, owner_role: 'CTO', priority: 'P0', domain: 'engineering' },
  { title: `${title}-default`, priority: 'invalid' },
] });
async function readKrs(title) {
  return (await pool.query('SELECT title, objective_id, status, owner_role, metadata FROM key_results WHERE title=$1 OR title=$2 ORDER BY title', [title, `${title}-default`])).rows;
}
describe('真实 strategy_session HTTP 回调保留执行结果，禁止自动创建 KR', () => {
  it('回调锁住任务时，进度记录与任务终态在同一事务提交且不等待自身外键锁', async () => {
    const task = await sourceTask('strategy_session');
    const result = { output: '本次会议仅保存结论，不创建任何 KR。' };
    const response = await callback(task, result);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect((await readTask(task.id)).status).toBe('completed');
    const ledger = (await pool.query('SELECT status, findings FROM progress_ledger WHERE task_id=$1 AND run_id=$2', [task.id, task.runId])).rows;
    expect(ledger).toEqual([{ status: 'completed', findings: result }]);
  });
  it('可选进度记录被数据库拒绝时，回调仍提交原始执行结果且不留下失败事务', async () => {
    const task = await sourceTask('strategy_session'), suffix = randomUUID().replaceAll('-', '');
    const name = `reject_callback_progress_${suffix}`;
    await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.task_id = '${task.id}'::uuid THEN RAISE EXCEPTION 'owned progress fixture rejects insert'; END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON progress_ledger FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    try {
      const result = '进度台账故障也必须保留这份原始回执。';
      const response = await callback(task, result);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(await readTask(task.id)).toMatchObject({ status: 'completed', payload: { last_run_result: { result_summary: result } } });
      expect((await pool.query('SELECT id FROM progress_ledger WHERE task_id=$1', [task.id])).rows).toEqual([]);
      const repeated = await callback(task, result);
      expect(repeated.status).toBe(200);
      expect(repeated.body.duplicate).toBe(true);
    } finally {
      await pool.query(`DROP TRIGGER ${name} ON progress_ledger`);
      await pool.query(`DROP FUNCTION ${name}()`);
    }
  });
  for (const goalKind of ['objective', 'unknown', 'null']) {
    it(`${goalKind} goal_id：真实任务终态、原始回执和重放幂等`, async () => {
      let goalId = goalKind === 'unknown' ? randomUUID() : null;
      if (goalKind === 'objective') goalId = (await pool.query("INSERT INTO objectives(title,status) VALUES($1,'active') RETURNING id", [`callback-objective-${randomUUID()}`])).rows[0].id;
      const task = await sourceTask('strategy_session', { goalId });
      const title = `callback-kr-${randomUUID()}`;
      const result = { output: `会议记录\n${output(title)}\n结束` };
      const response = await callback(task, result);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body.new_status).toBe('completed');
      const stored = await readTask(task.id);
      expect(stored.status).toBe('completed');
      expect(stored.completed_at).toBeInstanceOf(Date);
      expect(stored.claimed_by).toBeNull();
      expect(stored.payload.last_run_result).toMatchObject({ run_id: task.runId, status: 'AI Done' });
      expect(stored.payload).not.toHaveProperty('meeting_summary');
      expect(await readKrs(title)).toEqual([]);
      const repeat = await callback(task, result);
      expect(repeat.status).toBe(200);
      expect(repeat.body.duplicate).toBe(true);
      expect(await readTask(task.id)).toEqual(stored);
      expect(await readKrs(title)).toEqual([]);
      const queue = await pool.query('SELECT result_json, processed_at FROM callback_queue WHERE task_id=$1', [task.id]);
      expect(queue.rowCount).toBe(2);
      for (const receipt of queue.rows) {
        expect(receipt.result_json).toEqual(result);
        expect(receipt.processed_at).toBeInstanceOf(Date);
      }
    });
  }
  for (const invalid of ['invalid JSON {"krs":[}', '{"krs":[]}', '会议未产生决议']) {
    it(`非法/空输出不写KR并保留诊断：${invalid}`, async () => {
      const task = await sourceTask('strategy_session');
      const before = (await pool.query('SELECT count(*)::int AS n FROM key_results')).rows[0].n;
      const response = await callback(task, invalid);
      expect(response.status).toBe(200);
      const stored = await readTask(task.id);
      expect(stored.status).toBe('completed');
      expect(stored.payload.last_run_result.result_summary).toBe(invalid);
      expect(stored.payload).not.toHaveProperty('strategy_raw_output');
      expect((await pool.query('SELECT count(*)::int AS n FROM key_results')).rows[0].n).toBe(before);
    });
  }
  it('不存在task_id不能把KR写给邻居任务', async () => {
    const neighbor = await sourceTask('strategy_session');
    const snapshot = await readTask(neighbor.id), title = `callback-absent-${randomUUID()}`;
    const missing = { id: randomUUID(), runId: randomUUID() };
    const response = await callback(missing, output(title));
    expect(response.status, JSON.stringify(response.body)).toBe(503);
    expect(response.body.error).toBe('callback_queue unavailable, retry later');
    expect((await pool.query('SELECT id FROM callback_queue WHERE task_id=$1', [missing.id])).rows).toEqual([]);
    expect(await readTask(neighbor.id)).toEqual(snapshot);
    expect(await readKrs(title)).toEqual([]);
  });
  it('旧run_id不能完成现役任务或写KR', async () => {
    const task = await sourceTask('strategy_session'), title = `callback-stale-${randomUUID()}`;
    const before = await readTask(task.id);
    const response = await callback(task, output(title), { run_id: randomUUID() });
    expect(response.status).toBe(200); expect(response.body.reason).toBe('callback_compare_and_set_rejected');
    expect(await readTask(task.id)).toEqual(before); expect(await readKrs(title)).toEqual([]);
  });
});
