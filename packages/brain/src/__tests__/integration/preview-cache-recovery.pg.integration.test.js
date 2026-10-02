import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createIntakeTestDatabase } from '../fixtures/task-intake-db.js';
import { createPreviewCacheController } from '../../preview-cache-controller.js';
import { createJanitor } from '../../janitor.js';
import { PREVIEW_CACHE_POLICY as POLICY } from '../../preview-cache-authority.js';

let fixture, pool;
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const candidate = () => ({ machine: 'mmv', request: { policy: POLICY, resource_id: randomUUID(), generation: 1,
  expires_at: new Date(Date.now() + 60000).toISOString() } });
const rejected = promise => promise.then(value => ({ value }), error => ({ error }));
const controller = options => createPreviewCacheController({ pool, client: {
  receipt: async () => { throw Error('no confirmed receipt'); },
  execute: async () => { throw Error('recovery must not execute'); },
}, ...options });
const api = reconcile => createJanitor([{ JOB_ID: POLICY, JOB_NAME: 'fixture', run: async () => { throw Error('no rerun'); }, reconcile }]);
async function running(job = POLICY) {
  const id = randomUUID();
  await pool.query("INSERT INTO janitor_runs(id,job_id,job_name,status) VALUES($1,$2,'fixture','running')", [id, job]);
  return id;
}
async function state(id) {
  return (await pool.query('SELECT status,output,finished_at FROM janitor_runs WHERE id=$1', [id])).rows[0];
}
async function intents(id) {
  return (await pool.query('SELECT * FROM janitor_cache_intents WHERE run_id=$1', [id])).rows;
}
function trackedPool() {
  let client;
  return { pool: { query: (...args) => pool.query(...args), connect: async () => (client = await pool.connect()) }, get: () => client };
}
async function blocked(pid) {
  for (let i = 0; i < 100; i++) {
    const row = (await pool.query('SELECT cardinality(pg_blocking_pids($1)) AS n', [pid])).rows[0];
    if (row.n > 0) return true;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return false;
}
beforeAll(async () => {
  fixture = await createIntakeTestDatabase(); pool = fixture.pool;
  await pool.query(await readFile(new URL('../../../migrations/272_janitor.sql', import.meta.url), 'utf8'));
  await pool.query(await readFile(new URL('../../../migrations/502_preview_owned_cache_janitor.sql', import.meta.url), 'utf8'));
});
beforeEach(async () => { await pool.query('DELETE FROM janitor_cache_intents'); await pool.query('DELETE FROM janitor_runs'); });
afterAll(async () => fixture?.close());

it('中断后零intent真实落skipped，重复恢复idle且不触发删除', async () => {
  const id = await running(); const service = api(controller().reconcile);
  expect(await service.reconcileJob(pool, POLICY)).toMatchObject({ status: 'skipped', freed_bytes: 0 });
  expect(await state(id)).toMatchObject({ status: 'skipped', output: 'JANITOR_RECONCILED_SKIPPED' });
  expect((await state(id)).finished_at).not.toBeNull();
  expect(await service.reconcileJob(pool, POLICY)).toEqual({ status: 'idle' });
  expect(await intents(id)).toHaveLength(0);
});

it('终态或不同job的run不能再认领intent', async () => {
  const id = await running();
  await pool.query("UPDATE janitor_runs SET status='skipped' WHERE id=$1", [id]);
  await expect(controller().claim(candidate(), id)).rejects.toThrow('INVALID_CACHE_RUN');
  const wrong = await running('another-job');
  await expect(controller().claim(candidate(), wrong)).rejects.toThrow('INVALID_CACHE_RUN');
  expect(await intents(id)).toHaveLength(0); expect(await intents(wrong)).toHaveLength(0);
});

it('claim先持run锁，恢复等待提交后保留有intent的unknown，不能写skipped', async () => {
  const id = await running(); const entered = gate(); const release = gate(); const tracking = trackedPool();
  const c = controller({ createTask: async (...args) => {
    entered.resolve(); await release.promise;
    return (await import('../../actions.js')).createTask(...args);
  } });
  const claim = rejected(c.claim(candidate(), id)); await entered.promise;
  const recovery = rejected(api(c.reconcile).reconcileJob(tracking.pool, POLICY));
  try {
    while (!tracking.get()) await new Promise(r => setTimeout(r, 1));
    expect(await blocked(tracking.get().processID), '恢复必须阻塞于独立claim事务持有的run行锁').toBe(true);
  } finally { release.resolve(); await claim; await recovery; }
  expect((await recovery).error).toMatchObject({ code: 'JANITOR_UNCONFIRMED' });
  expect((await state(id)).status).toBe('running'); expect(await intents(id)).toHaveLength(1);
});

it('恢复先锁run并确认零intent，延迟claim必须等待skipped提交后拒绝', async () => {
  const id = await running(); const entered = gate(); const release = gate(); const tracking = trackedPool();
  const c = controller();
  const recovery = rejected(api(async context => {
    const result = await c.reconcile(context); entered.resolve(); await release.promise; return result;
  }).reconcileJob(pool, POLICY)); await entered.promise;
  const claim = rejected(controller({ pool: tracking.pool }).claim(candidate(), id));
  try {
    while (!tracking.get()) await new Promise(r => setTimeout(r, 1));
    expect(await blocked(tracking.get().processID), 'claim必须阻塞于恢复事务持有的run行锁').toBe(true);
  } finally { release.resolve(); await recovery; await claim; }
  expect((await claim).error?.message).toBe('INVALID_CACHE_RUN');
  expect((await state(id)).status).toBe('skipped'); expect(await intents(id)).toHaveLength(0);
});

it('claim事务期间signal中止则回滚任务与intent，不留下后提交', async () => {
  const id = await running(); const abort = new AbortController();
  const c = controller({ createTask: async (...args) => {
    const made = await (await import('../../actions.js')).createTask(...args); abort.abort(); return made;
  } });
  await expect(c.claim(candidate(), id, abort.signal)).rejects.toThrow();
  expect(await intents(id)).toHaveLength(0);
  expect(await api(c.reconcile).reconcileJob(pool, POLICY)).toMatchObject({ status: 'skipped' });
});

it('终态写入异常回滚并释放锁，原running仍可安全恢复', async () => {
  const id = await running(); const service = api(controller().reconcile);
  await pool.query(`CREATE FUNCTION reject_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'fixture-reject'; END $$;
    CREATE TRIGGER reject_recovery BEFORE UPDATE ON janitor_runs FOR EACH ROW EXECUTE FUNCTION reject_recovery()`);
  try { await expect(service.reconcileJob(pool, POLICY)).rejects.toThrow(); }
  finally { await pool.query('DROP TRIGGER reject_recovery ON janitor_runs; DROP FUNCTION reject_recovery()'); }
  expect((await state(id)).status).toBe('running'); expect(await intents(id)).toHaveLength(0);
  expect(await service.reconcileJob(pool, POLICY)).toMatchObject({ status: 'skipped' });
});

it('恢复事务连接真实断开不写终态；随后原run可重新对账', async () => {
  const id = await running(); const entered = gate(); const release = gate(); const tracking = trackedPool();
  const c = controller(); let aborted;
  const recovery = rejected(api(async context => {
    aborted = new Promise(r => context.signal.addEventListener('abort', r, { once: true }));
    const result = await c.reconcile(context); entered.resolve(); await release.promise; return result;
  }).reconcileJob(tracking.pool, POLICY)); await entered.promise;
  await pool.query('SELECT pg_terminate_backend($1)', [tracking.get().processID]); await aborted;
  release.resolve(); expect((await recovery).error).toMatchObject({ code: 'JANITOR_UNCONFIRMED' });
  expect((await state(id)).status).toBe('running'); expect(await intents(id)).toHaveLength(0);
  expect(await api(c.reconcile).reconcileJob(pool, POLICY)).toMatchObject({ status: 'skipped' });
});
