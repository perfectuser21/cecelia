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
describe('真实 strategy_session HTTP callback → PostgreSQL KR', () => {
  for (const goalKind of ['objective', 'unknown', 'null']) {
    it(`${goalKind} goal_id：真实任务终态、KR关联、默认值和重放幂等`, async () => {
      let goalId = goalKind === 'unknown' ? randomUUID() : null;
      if (goalKind === 'objective') goalId = (await pool.query("INSERT INTO objectives(title,status) VALUES($1,'active') RETURNING id", [`callback-objective-${randomUUID()}`])).rows[0].id;
      const task = await sourceTask('strategy_session', { goalId });
      const title = `callback-kr-${randomUUID()}`;
      const response = await callback(task, { output: `会议记录\n${output(title)}\n结束` });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body.new_status).toBe('completed');
      const stored = await readTask(task.id);
      expect(stored.status).toBe('completed');
      expect(stored.completed_at).toBeInstanceOf(Date);
      expect(stored.claimed_by).toBeNull();
      expect(stored.payload.meeting_summary).toBe('季度资源决议');
      expect(await readKrs(title)).toEqual([
        { title, objective_id: goalKind === 'objective' ? goalId : null, status: 'pending', owner_role: 'cto', metadata: { priority: 'P0', domain: 'engineering' } },
        { title: `${title}-default`, objective_id: goalKind === 'objective' ? goalId : null, status: 'pending', owner_role: null, metadata: { priority: 'P1', domain: null } },
      ]);
      const repeat = await callback(task, output(title));
      expect(repeat.status).toBe(200); expect(repeat.body.duplicate).toBe(true);
      expect(await readKrs(title)).toHaveLength(2);
      const queue = await pool.query('SELECT processed_at FROM callback_queue WHERE task_id=$1', [task.id]);
      expect(queue.rowCount).toBe(2); expect(queue.rows.every(r => r.processed_at)).toBe(true);
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
      expect(stored.payload.strategy_raw_output).toBe(invalid);
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
