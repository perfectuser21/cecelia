import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createPhoneClaimFixture } from '../fixtures/phone-claim-schema.js';
import { runWorkerPoolDispatch, __resetWorkerPoolDispatchForTest } from '../../worker-pool-dispatch.js';
const holder = vi.hoisted(() => ({ pool: null }));
vi.mock('../../db.js', () => ({ default: { get options() { return holder.pool.options; }, query: (...a) => holder.pool.query(...a), connect: () => holder.pool.connect() } }));
vi.mock('../../task-updater.js', () => ({ broadcastTaskState: vi.fn() }));
let f;
afterEach(async () => { if (f) await f.close(); f = null; });
beforeEach(() => __resetWorkerPoolDispatchForTest());
function fixtureExec(busy = []) {
  const launched = new Set(busy), commands = [];
  return { commands, execFn: cmd => {
    commands.push(cmd);
    if (cmd.includes('send-keys')) launched.add(cmd.match(/-t (slot\d)/)[1]);
    if (cmd.includes('list-panes')) return launched.has(cmd.match(/-t (slot\d)/)[1]) ? 'claude' : 'zsh';
    return '';
  }, ssh: { host: null, opts: '' }, sleep: async () => {}, now: () => Date.now() };
}
it('actual worker mixed queue filters phone before LIMIT, claims only two ordinary neighbors, preserves producer/lease/grant', async () => {
  f = await createPhoneClaimFixture(p => holder.pool = p);
  const a = await f.ordinary({ parallel_worker: true, phone_authority: true, executor_kind: 'phone-ssh-controller' }), b = await f.ordinary({ pipeline: 'canvas', canonical: 'exploratory' });
  const before = await f.snapshot(), seam = fixtureExec();
  const result = await runWorkerPoolDispatch(f.pool, seam);
  expect(result.dispatched).toBe(2); expect(await f.snapshot()).toEqual(before);
  const events = (await f.pool.query("SELECT task_id FROM dispatch_events WHERE event_type='dispatched'")).rows.map(x => x.task_id);
  expect(events.sort()).toEqual([a, b].sort());
  expect((await f.pool.query('SELECT claimed_by FROM tasks WHERE id=ANY($1::uuid[])', [[a, b]])).rows.every(x => x.claimed_by === 'interactive-dev-skill')).toBe(true);
  expect(seam.commands.filter(x => x.includes('send-keys'))).toHaveLength(2);
});
it('old phone busy-slot association stays conservative: no zombie kill and busy1 leaves only one ordinary slot budget', async () => {
  f = await createPhoneClaimFixture(p => holder.pool = p, { busyLegacy: true });
  const a = await f.ordinary({ parallel_worker: true }); await f.ordinary({ parallel_worker: true });
  const before = await f.snapshot(), seam = fixtureExec(['slot7']);
  const result = await runWorkerPoolDispatch(f.pool, seam);
  expect(result).toMatchObject({ dispatched: 1, busy: 1, zombies: [] }); expect(await f.snapshot()).toEqual(before);
  expect(seam.commands.some(x => x.includes('kill-session'))).toBe(false);
  expect((await f.pool.query("SELECT task_id FROM dispatch_events WHERE event_type='dispatched' AND task_id<>$1", [f.old])).rows).toEqual([{ task_id: a }]);
});
it('worker actual stale candidate SQL negative refuses phone final claim; legal two-session ordinary claim race skips without launch', async () => {
  f = await createPhoneClaimFixture(p => holder.pool = p);
  const ordinary = await f.ordinary({ parallel_worker: true }), before = await f.snapshot();
  const seam = fixtureExec(), query = f.pool.query.bind(f.pool); let claimSql;
  const proxy = { query: async (sql, args) => {
    if (String(sql).includes('SELECT id, title, payload FROM tasks')) return query('SELECT id,title,payload FROM tasks WHERE id=ANY($1::uuid[]) ORDER BY id', [[f.owner, ordinary]]);
    if (String(sql).includes("SET claimed_by = 'interactive-dev-skill'")) {
      claimSql = sql;
      if (args[0] === ordinary) { const c = await f.pool.connect(); try { await c.query('BEGIN'); await c.query("UPDATE tasks SET status='paused' WHERE id=$1", [ordinary]); await c.query('COMMIT'); } finally { c.release(); } }
    }
    return query(sql, args);
  } };
  expect((await runWorkerPoolDispatch(proxy, seam)).dispatched).toBe(0);
  expect(claimSql).toBeTruthy(); expect(seam.commands.some(x => x.includes('send-keys'))).toBe(false);
  expect(await f.snapshot()).toEqual(before);
  for (const id of [f.old, f.historical, f.owner]) expect((await query(claimSql, [id])).rowCount).toBe(0);
});
it('worker ownprefix release SQL cannot clear historical phone claim, while failed ordinary launch releases its own claim', async () => {
  f = await createPhoneClaimFixture(p => holder.pool = p, { busyLegacy: true });
  const id = await f.ordinary({ parallel_worker: true }), before = await f.snapshot(), seam = fixtureExec(['slot7']);
  const run = seam.execFn; seam.execFn = cmd => { if (cmd.includes('send-keys')) throw Error('fixture_launch_failure'); return run(cmd); };
  let releaseSql; const query = f.pool.query.bind(f.pool), proxy = { query: (sql, args) => { if (/SET claimed_by = NULL/.test(sql)) releaseSql = sql; return query(sql, args); } };
  expect((await runWorkerPoolDispatch(proxy, seam)).dispatched).toBe(0);
  expect((await query('SELECT claimed_by FROM tasks WHERE id=$1', [id])).rows[0].claimed_by).toBeNull();
  expect(releaseSql).toBeTruthy(); expect((await query(releaseSql, [f.old])).rowCount).toBe(0); expect(await f.snapshot()).toEqual(before);
});
