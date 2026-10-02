import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import express from 'express';
import { DB_DEFAULTS } from '../../db-config.js';
import { createServer } from 'node:http';
import { createPhoneClaimFixture } from '../fixtures/phone-claim-schema.js';
const h = vi.hoisted(() => ({ pool: null, anchor: vi.fn(), device: vi.fn(), release: vi.fn(), trigger: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { get options() { return h.pool.options; }, query: (...a) => h.pool.query(...a), connect: () => h.pool.connect() } }));
vi.mock('../../task-updater.js', () => ({ broadcastTaskState: vi.fn() }));
vi.mock('../../executor.js', () => ({ triggerCeceliaRun: (...a) => h.trigger(...a), checkCeceliaRunAvailable: vi.fn() }));
vi.mock('../../anchor-check.js', () => ({ checkAnchor: (...a) => h.anchor(...a) }));
vi.mock('../../lib/manual-dispatch-device-gate.js', () => ({ checkDeviceLockForManualDispatch: (...a) => h.device(...a), releaseDeviceLockNonFatal: (...a) => h.release(...a) }));
// Mock other imports that execution.js needs
vi.mock('../../tick.js', () => ({
  runTickSafe: vi.fn(),
  getTickStatus: vi.fn().mockResolvedValue({ enabled: false }),
}));
vi.mock('../../templates.js', () => ({
  generatePrdFromTask: vi.fn(),
  generatePrdFromGoalKR: vi.fn(),
  generateTrdFromGoal: vi.fn(),
  generateTrdFromGoalKR: vi.fn(),
  validatePrd: vi.fn(),
  validateTrd: vi.fn(),
  prdToJson: vi.fn(),
  trdToJson: vi.fn(),
  PRD_TYPE_MAP: {},
}));
vi.mock('../../decision.js', () => ({
  compareGoalProgress: vi.fn(),
  generateDecision: vi.fn(),
  executeDecision: vi.fn(),
  rollbackDecision: vi.fn(),
}));
vi.mock('../../planner.js', () => ({
  planNextTask: vi.fn(),
  getPlanStatus: vi.fn(),
  handlePlanInput: vi.fn(),
  getGlobalState: vi.fn(),
  selectTopAreas: vi.fn(),
  selectActiveInitiativeForArea: vi.fn(),
  ACTIVE_AREA_COUNT: 3,
}));
vi.mock('../../thalamus.js', () => ({
  processEvent: vi.fn(),
  EVENT_TYPES: {},
}));
vi.mock('../../decision-executor.js', () => ({
  executeDecision: vi.fn(),
}));
vi.mock('../../embedding-service.js', () => ({
  generateTaskEmbeddingAsync: vi.fn(),
}));
vi.mock('../../events/taskEvents.js', () => ({
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
}));
vi.mock('../../event-bus.js', () => ({
  emit: vi.fn(),
}));
vi.mock('../../circuit-breaker.js', () => ({
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('../../notifier.js', () => ({
  notifyTaskCompleted: vi.fn(),
}));
vi.mock('../../platform-utils.js', () => ({
  getAvailableMemoryMB: vi.fn().mockReturnValue(8000),
  getBrainRssMB: vi.fn(() => 500),
  evaluateMemoryHealth: vi.fn(() => ({
    brain_memory_ok: true, system_memory_ok: true, action: 'proceed',
    reason: 'mock', brain_rss_mb: 500, system_available_mb: 8000,
    system_threshold_mb: 600, brain_rss_danger_mb: 1500, brain_rss_warn_mb: 1000,
  })),
  sampleBrainCpuUsage: vi.fn(() => 5),
  evaluateCpuHealth: vi.fn(() => ({ action: 'proceed', reason: 'mock' })),
}));
vi.mock('../../alerting.js', () => ({
  raise: vi.fn(),
}));
vi.mock('../../quarantine.js', () => ({
  handleTaskFailure: vi.fn(),
  classifyFailure: vi.fn(),
}));
vi.mock('../../desire-feedback.js', () => ({
  updateDesireFromTask: vi.fn(),
}));
vi.mock('../../code-review-trigger.js', () => ({
  checkAndCreateCodeReviewTrigger: vi.fn(),
}));
vi.mock('./shared.js', () => ({
  getActiveExecutionPaths: vi.fn().mockReturnValue([]),
  INVENTORY_CONFIG: {},
  resolveRelatedFailureMemories: vi.fn().mockResolvedValue([]),
}));


let f, server, address;
beforeEach(() => { vi.clearAllMocks(); h.anchor.mockReturnValue({ blocked: false }); h.device.mockResolvedValue({ pass: true, acquired: true }); h.release.mockResolvedValue(); h.trigger.mockResolvedValue({ success: true, runId: 'fixture-run', executor: 'fixture' }); });
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } server = null; if (f) await f.close(); f = null; });
async function setup() {
 f = await createPhoneClaimFixture(pool => h.pool = pool);
 const { default: router } = await import('../../routes/execution.js');
 const app = express(); app.use(express.json()); app.use('/api/brain', router);
 server = createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); address = `http://127.0.0.1:${server.address().port}/api/brain/dispatch-now`;
 expect(f.location).toEqual({ db: DB_DEFAULTS.database, schema: f.schema });
}
async function post(taskId) { const response = await fetch(address, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(taskId === undefined ? {} : { task_id: taskId }) }); return { status: response.status, body: await response.json() }; }
function noEffects() { expect(h.anchor).not.toHaveBeenCalled(); expect(h.device).not.toHaveBeenCalled(); expect(h.trigger).not.toHaveBeenCalled(); expect(h.release).not.toHaveBeenCalled(); }
it.each(['owner', 'old', 'historical'])('HTTP refuses actual %s phone before anchor/device and preserves native ledger', async key => {
 await setup(); const before = await f.snapshot(); h.anchor.mockReturnValue({ blocked: true, detail: 'fixture missing' });
 expect(await post(f[key])).toMatchObject({ status: 409, body: { error: 'phone_task_owned' } }); noEffects(); expect(await f.snapshot()).toEqual(before);
});
it('unknown actual owner relation fails closed before external gates or task writes', async () => {
 await setup(); const id = await f.ordinary(), before = (await f.pool.query('SELECT * FROM tasks WHERE id=$1', [id])).rows;
 await f.pool.query('ALTER TABLE phone_task_owners RENAME TO fixture_owner_unavailable');
 try { expect((await post(id)).status).toBe(500); noEffects(); expect((await f.pool.query('SELECT * FROM tasks WHERE id=$1', [id])).rows).toEqual(before); }
 finally { await f.pool.query('ALTER TABLE fixture_owner_unavailable RENAME TO phone_task_owners'); }
});
it.each(['queued', 'pending', 'paused', 'failed', 'in_progress'])('ordinary NULL executor/fake payload original %s state remains executable', async status => {
 await setup(); const id = await f.ordinary({ phone_authority: true, executor_kind: 'phone-ssh-controller' }); await f.pool.query('UPDATE tasks SET status=$2 WHERE id=$1', [id, status]);
 expect(await post(id)).toEqual({ status: 200, body: { success: true, taskId: id, runId: 'fixture-run', executor: 'fixture' } });
 expect((await f.pool.query('SELECT status,executor_kind,payload FROM tasks WHERE id=$1',[id])).rows[0]).toEqual({ status: 'in_progress', executor_kind: null, payload: { phone_authority: true, executor_kind: 'phone-ssh-controller' } });
 expect(h.trigger).toHaveBeenCalledTimes(1); expect(h.release).not.toHaveBeenCalled();
});
it('original HTTP missing/absent/completed/cancelled contracts remain before authority gate', async () => {
 await setup(); expect((await post()).status).toBe(400); expect((await post('00000000-0000-0000-0000-000000000000')).status).toBe(404);
 for (const status of ['completed','cancelled']) { const id = await f.ordinary(); await f.pool.query('UPDATE tasks SET status=$2 WHERE id=$1',[id,status]); expect(await post(id)).toMatchObject({ status: 409, body: { error: `Task already ${status}`, status } }); } noEffects();
});
it('ordinary unsuccessful executor really requeues and exact two UPDATEs refuse every phone identity', async () => {
 await setup(); const id = await f.ordinary(), before = await f.snapshot(), query = f.pool.query.bind(f.pool), updates = [];
 h.pool = { options: f.pool.options, connect: () => f.pool.connect(), query: async (sql,args) => { if (/UPDATE tasks SET status =/.test(sql)) updates.push({ sql,args }); return query(sql,args); } };
 h.trigger.mockResolvedValue({ success: false, error: 'fixture unavailable' });
 expect(await post(id)).toEqual({ status: 500, body: { success: false, error: 'fixture unavailable', taskId: id } });
 expect((await query('SELECT status FROM tasks WHERE id=$1',[id])).rows[0].status).toBe('queued'); expect(h.trigger).toHaveBeenCalledTimes(1); expect(h.release).toHaveBeenCalledTimes(1); expect(updates).toHaveLength(2);
 for (const { sql,args } of updates) for (const phoneId of [f.owner,f.old,f.historical]) expect((await query(sql,[args[0],phoneId])).rowCount).toBe(0);
 expect(await f.snapshot()).toEqual(before);
});
it.each(['authority','start','requeue'])('real ordinary second-session deletion before %s cannot report dispatch or recovery success', async point => {
 await setup(); const id = await f.ordinary(), query = f.pool.query.bind(f.pool); let removed = false;
 h.pool = { options: f.pool.options, connect: () => f.pool.connect(), query: async (sql,args) => {
  const match = point === 'authority' ? /ordinary_eligible/.test(sql) : /UPDATE tasks SET status =/.test(sql) && args?.[0] === (point === 'start' ? 'in_progress' : 'queued');
  if (match && !removed) { removed = true; const client = await f.pool.connect(); try { await client.query('BEGIN'); await client.query('DELETE FROM tasks WHERE id=$1',[id]); await client.query('COMMIT'); } finally { client.release(); } }
  return query(sql,args);
 } };
 if (point === 'requeue') h.trigger.mockResolvedValue({ success: false, error: 'fixture unavailable' });
 const result = await post(id); expect(removed).toBe(true); expect(result).toMatchObject({ status: point === 'requeue' ? 500 : 409, body: { error: point === 'requeue' ? 'manual_dispatch_requeue_conflict' : 'manual_dispatch_conflict' } });
 expect((await query('SELECT id FROM tasks WHERE id=$1',[id])).rowCount).toBe(0);
 expect(h.trigger).toHaveBeenCalledTimes(point === 'requeue' ? 1 : 0); expect(h.release).toHaveBeenCalledTimes(point === 'authority' ? 0 : 1); if (point === 'authority') expect(h.anchor).not.toHaveBeenCalled();
});

it('ordinary real nonphone executor remains executable', async () => {
 await setup(); const id = (await f.pool.query("INSERT INTO tasks(title,status,task_type,executor_kind,payload) VALUES('manual bridge neighbor','queued','dev','bridge','{}') RETURNING id")).rows[0].id;
 expect((await post(id)).status).toBe(200); expect(h.trigger).toHaveBeenCalledTimes(1);
});
it('unknown authority result boolean fails closed with no external gates', async () => {
 await setup(); const id = await f.ordinary(), query = f.pool.query.bind(f.pool);
 h.pool = { options: f.pool.options, connect: () => f.pool.connect(), query: (sql,args) => /ordinary_eligible/.test(sql) ? Promise.resolve({ rows: [{ id, ordinary_eligible: null }] }) : query(sql,args) };
 expect((await post(id)).status).toBe(500); noEffects(); expect((await query('SELECT status FROM tasks WHERE id=$1',[id])).rows[0].status).toBe('queued');
});
