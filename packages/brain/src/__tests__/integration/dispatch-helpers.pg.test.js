import { afterEach, it, expect, vi } from 'vitest';
import { createPhoneClaimFixture } from '../fixtures/phone-claim-schema.js';
const h = vi.hoisted(() => ({ pool: null, budget: null, eviction: vi.fn(), trigger: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { get options() { return h.pool.options; }, query: (...a) => h.pool.query(...a), connect: () => h.pool.connect() } }));
vi.mock('../../task-updater.js', () => ({ broadcastTaskState: vi.fn() }));
vi.mock('../../task-weight.js', () => ({ sortTasksByWeight: rows => rows }));
vi.mock('../../alertness-actions.js', () => ({ getMitigationState: () => ({}) }));
vi.mock('../../drain.js', () => ({ isDraining: () => false, getDrainStartedAt: () => null }));
vi.mock('../../quota-cooling.js', () => ({ isGlobalQuotaCooling: () => false, getQuotaCoolingState: () => ({}) }));
vi.mock('../../executor.js', () => ({ triggerCeceliaRun: h.trigger, checkCeceliaRunAvailable: async () => ({ available: true }), killProcessTwoStage: vi.fn(), getBillingPause: () => ({ active: false }) }));
vi.mock('../../slot-allocator.js', () => ({ calculateSlotBudget: async () => h.budget, shouldBypassBackpressure: () => false, harnessSlotCheck: vi.fn() }));
vi.mock('../../eviction.js', () => ({ findEvictionCandidate: h.eviction, requeueEvictedTask: vi.fn() }));
vi.mock('../../account-usage.js', () => ({ proactiveTokenCheck: vi.fn() }));
vi.mock('../../quota-guard.js', () => ({ checkQuotaGuard: async () => ({ allow: true }) }));
vi.mock('../../pre-flight-check.js', () => ({ preFlightCheck: async () => ({ passed: true }), alertOnPreFlightFail: vi.fn() }));
vi.mock('../../dispatch-stats.js', () => ({ recordDispatchResult: vi.fn() }));
vi.mock('../../circuit-breaker.js', () => ({ isAllowed: () => true, recordFailure: vi.fn(), recordSuccess: vi.fn() }));
let f;
afterEach(async () => { if (f) await f.close(); f = null; vi.clearAllMocks(); });
async function fixture() { f = await createPhoneClaimFixture(p => h.pool = p, { workerHistorical: false }); return f; }
function fullBudget(allowed) { return { dispatchAllowed: allowed, resourceAdmissionBlocked: false, user: { mode: 'absent' }, taskPool: { budget: allowed ? 2 : 0, available: allowed ? 2 : 0 }, codex: { available: true, running: 0, max: 5 } }; }

it('actual helper native mixed queue excludes actual phone identities while ordinary NULL executor and fake phone payload keep priority and excludeIds behavior', async () => {
  await fixture(); const a = await f.ordinary({ executor_kind: 'phone-ssh-controller', phone_authority: true }, 'P1'), b = await f.ordinary({}, 'P2');
  const before = await f.snapshot(), { selectNextDispatchableTask } = await import('../../dispatch-helpers.js');
  expect((await selectNextDispatchableTask(null)).id).toBe(a);
  expect((await selectNextDispatchableTask(null, [a])).id).toBe(b);
  expect(await selectNextDispatchableTask(null, [a, b])).toBeNull(); expect(await f.snapshot()).toEqual(before);
});
it('full budget peeks do not evict for phone P0 or falsely use phone xian bypass; ordinary rows stay unchanged', async () => {
  await fixture(); const id = await f.ordinary({}, 'P2'), before = await f.snapshot(); h.budget = fullBudget(false); h.eviction.mockResolvedValue(null);
  const query = f.pool.query.bind(f.pool), peeks = [];
  h.pool = { options: f.pool.options, connect: () => f.pool.connect(), query: async (sql, args) => { const result = await query(sql, args); if (/SELECT priority FROM tasks|SELECT task_type, location FROM tasks/.test(sql)) peeks.push(result.rows); return result; } };
  const { dispatchNextTask } = await import('../../dispatcher.js'); const result = await dispatchNextTask(null);
  expect(result.dispatched).toBe(false); expect(peeks).toHaveLength(2);
  expect(peeks[0]).toEqual([{ priority: 'P2' }]); expect(peeks[1]).toEqual([{ task_type: 'research', location: 'us' }]);
  expect(h.eviction).not.toHaveBeenCalled(); expect(h.trigger).not.toHaveBeenCalled(); expect(await f.snapshot()).toEqual(before);
  expect((await query('SELECT claimed_by FROM tasks WHERE id=$1', [id])).rows[0].claimed_by).toBeNull();
});
it('dispatcher actual CAS honors ordinary queued-to-paused race and its exact native SQL refuses all phone IDs (SQL negative, not a rebinding race)', async () => {
  await fixture(); const id = await f.ordinary({}, 'P1'), before = await f.snapshot(); h.budget = fullBudget(true);
  const query = f.pool.query.bind(f.pool); let claimSql, claimArgs;
  h.pool = { options: f.pool.options, connect: () => f.pool.connect(), query: async (sql, args) => {
    if (/SELECT t.id, t.title/.test(sql)) return query('SELECT * FROM tasks WHERE id=$1', [id]); // Native stale-candidate fault seam; no fabricated identity.
    if (/UPDATE tasks SET claimed_by = \$1, claimed_at/.test(sql)) {
      claimSql = sql; claimArgs = args;
      const c = await f.pool.connect(); try { await c.query('BEGIN'); await c.query("UPDATE tasks SET status='paused' WHERE id=$1", [id]); await c.query('COMMIT'); } finally { c.release(); }
    }
    return query(sql, args);
  } };
  const { dispatchNextTask } = await import('../../dispatcher.js'); const result = await dispatchNextTask(null);
  expect(claimSql).toBeTruthy(); expect(result).toMatchObject({ dispatched: false, reason: 'already_claimed' });
  expect(h.trigger).not.toHaveBeenCalled(); expect((await query('SELECT claimed_by,status FROM tasks WHERE id=$1', [id])).rows[0]).toEqual({ claimed_by: null, status: 'paused' });
  for (const phoneId of [f.old, f.historical, f.owner]) expect((await query(claimSql, [claimArgs[0], phoneId])).rows).toEqual([]);
  expect(await f.snapshot()).toEqual(before);
});
