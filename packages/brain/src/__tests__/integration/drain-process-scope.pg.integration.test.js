import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createIntakeTestDatabase } from '../fixtures/task-intake-db.js';

const state = vi.hoisted(() => ({ pool: null }));
vi.mock('../../db.js', () => ({ default: { query: (...args) => state.pool.query(...args) } }));
vi.mock('../../executor.js', () => ({ getActiveProcesses: () => [] }));
import { drainTick, getDrainStatus, cancelDrain, isDraining, _resetDrainState } from '../../drain.js';

let fixture;
beforeAll(async () => {
  fixture = await createIntakeTestDatabase(); state.pool = fixture.pool;
  await state.pool.query(`CREATE TABLE ${fixture.schema}.working_memory (LIKE public.working_memory INCLUDING ALL)`);
});
afterAll(async () => { _resetDrainState(); await fixture?.close(); });
beforeEach(async () => {
  _resetDrainState(); state.pool = await fixture.pool.connect();
  await state.pool.query('BEGIN');
});
afterEach(async () => {
  try { await state.pool.query('ROLLBACK'); } finally {
    state.pool.release(); state.pool = fixture.pool; _resetDrainState();
  }
});

async function addTask(kind, payload = {}, title = '排空归属实测') {
  const id = randomUUID();
  await state.pool.query(`INSERT INTO tasks(id,title,task_type,status,executor_kind,claimed_by,started_at,payload)
    VALUES($1,$2,'research','in_progress',$3,'original-owner','2000-01-01',$4)`, [id, `${title} ${id}`, kind, payload]);
  return id;
}
async function rows() { return (await state.pool.query('SELECT * FROM tasks ORDER BY id')).rows; }

describe('真实 PG 发布排空归属与持久暂停', () => {
  it('105条外部任务不阻塞，但其状态/认领/原始数据全部保留', async () => {
    for (let i = 0; i < 105; i++) await addTask(i < 98 ? 'headed-session' : i < 104 ? 'openclaw-agent' : 'script');
    const before = await rows();
    await drainTick();
    const status = await getDrainStatus();
    expect(status.remaining).toBe(0);
    expect(status.safe_to_swap).toBe(true);
    expect(status.independent_task_count).toBe(105);
    expect(await rows()).toEqual(before);
    expect(isDraining()).toBe(true);
    const stored = (await state.pool.query("SELECT value_json FROM working_memory WHERE key='tick_draining'")).rows[0];
    expect(stored?.value_json.draining).toBe(true);
    expect(stored?.value_json.drain_id).toBe(status.drain_id);
    await cancelDrain();
    expect((await state.pool.query("SELECT * FROM working_memory WHERE key='tick_draining'")).rows).toEqual([]);
  });

  it('陈旧本机、未知归属以及归类bridge的共享调用仍阻塞', async () => {
    const local = await addTask('brain-local');
    const unknown = await addTask(null);
    const runId = randomUUID();
    const shared = await addTask('bridge', { current_run_id: runId, invocation: {
      protocol: 'invocation-request-v1', runner: 'shared-activity-runner', dispatch: { run_id: runId },
    } });
    const before = await rows();
    await drainTick();
    const status = await getDrainStatus();
    expect(status.remaining).toBe(3);
    expect(status.safe_to_swap).toBe(false);
    expect(status.blockers.map(x => x.task_id).sort()).toEqual([local, unknown, shared].sort());
    expect(await rows()).toEqual(before);
  });
});
