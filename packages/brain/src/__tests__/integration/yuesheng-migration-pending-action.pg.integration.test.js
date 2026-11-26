import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Router, default as express } from 'express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { registerYueshengMigrationPendingAction } from '../../routes/yuesheng-migration-pending-action.js';

const holder = vi.hoisted(() => ({ pool: null }));
vi.mock('../../db.js', () => ({ default: {
  connect: (...args) => holder.pool.connect(...args),
  query: (...args) => holder.pool.query(...args),
} }));

const taskId = '8f5f6442-540f-48b6-9577-c21cd848aa02';
const device = 'B114E2190975';
const source = 'yuesheng_adb_migration';
const sourceCommit = '388bae46abee9aededfaf71115813572c97d57da';
const token = 'isolated-yuesheng-route-fixture';
const endpoint = id => '/api/brain/tasks/' + id + '/yuesheng-adb-migration/pending-action';
const approvalEndpoint = id => '/api/brain/tasks/' + id + '/yuesheng-adb-migration/approval';
const send = (leaseVersion, commit = sourceCommit) => request(app).post(endpoint(taskId))
  .set('X-Internal-Token', token).send({ lease_version: leaseVersion, source_commit: commit });
const schema = 'yuesheng_pending_' + randomUUID().replaceAll('-', '');
const { Pool } = pg;
let pool, admin, app, previousToken;

beforeAll(async () => {
  previousToken = process.env.CECELIA_INTERNAL_TOKEN;
  process.env.CECELIA_INTERNAL_TOKEN = token;
  admin = new Pool(DB_DEFAULTS);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool = new Pool({ ...DB_DEFAULTS, options: '-c search_path=' + schema, max: 10 });
  holder.pool = pool;
  await pool.query(`CREATE TABLE schema_version(version text PRIMARY KEY, description text, applied_at timestamp);
    CREATE TABLE tasks(id uuid PRIMARY KEY, status text, claimed_by text, claimed_at timestamptz, payload jsonb, result jsonb);
    CREATE TABLE device_locks(device_name text PRIMARY KEY, locked_by text, locked_at timestamptz, expires_at timestamptz)`);
  for (const filename of ['007_pending_actions.sql', '054_inbox_proposal_system.sql']) {
    await pool.query(readFileSync(new URL('../../../migrations/' + filename, import.meta.url), 'utf8'));
  }
  app = express().use(express.json());
  const router = Router();
  registerYueshengMigrationPendingAction(router, pool);
  app.use('/api/brain', router);
});

afterAll(async () => {
  if (previousToken === undefined) delete process.env.CECELIA_INTERNAL_TOKEN;
  else process.env.CECELIA_INTERNAL_TOKEN = previousToken;
  if (pool) await pool.end();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});

beforeEach(async () => {
  await pool.query('TRUNCATE pending_actions, tasks, device_locks');
  await pool.query(`INSERT INTO tasks VALUES ($1, 'in_progress','fixture-owner',clock_timestamp()-interval '1 minute',
    '{"work_kind":"coding_review","scope":["enable_mmv_yuesheng_5045"]}', '{"preserved":true}')`, [taskId]);
  await pool.query(`INSERT INTO device_locks VALUES ($1,$2,clock_timestamp(),clock_timestamp()+interval '15 minutes')`, [device, taskId]);
});

const readLease = async () => (await pool.query('SELECT xmin::text AS version, expires_at FROM device_locks')).rows[0];
const readActions = async () => (await pool.query('SELECT * FROM pending_actions')).rows;
const digestPlan = plan => createHash('sha256').update(JSON.stringify(plan, (_, value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)).digest('hex');

async function openPlan() {
  const { rows: [lease] } = await pool.query('SELECT *, xmin::text AS lease_version FROM device_locks');
  const { rows: [task] } = await pool.query('SELECT claimed_by, claimed_at FROM tasks WHERE id = $1', [taskId]);
  const opened = await send(lease.lease_version);
  const plan = {
    protocol: 'yuesheng-adb-migration-plan/v1', task_id: taskId, pending_action_id: opened.body.action.id,
    source_commit: sourceCommit, release_id: 'b53d261a-5ef7-477a-82de-096533e77795',
    observation_id: '58827237-0382-4499-b976-81e040b2cc7f',
    physical_serial: device, transport_serial: '127.0.0.1:15555',
    old_endpoint: 'tcp:127.0.0.1:5044', new_endpoint: 'tcp:127.0.0.1:5045', new_instance_id: 'mmv-yuesheng-direct',
    claim: { claimed_by: task.claimed_by, claimed_at: task.claimed_at.toISOString() },
    lease: { ...lease, locked_at: lease.locked_at.toISOString(), expires_at: lease.expires_at.toISOString(), expired: false },
  };
  return { plan, plan_sha256: digestPlan(plan) };
}

const approve = body => request(app).post(approvalEndpoint(taskId)).set('X-Internal-Token', token).send(body);

it('uses authenticated HTTP and persists one precise owner decision for concurrent retries without modifying the task', async () => {
  const lease = await readLease();
  const unauthorized = await request(app).post(endpoint(taskId)).send({ lease_version: lease.version, source_commit: sourceCommit });
  expect(unauthorized.status).toBe(401);
  expect(await readActions()).toHaveLength(0);

  const attempts = await Promise.all(Array.from({ length: 5 }, () => send(lease.version)));
  expect(attempts.map(({ status }) => status).sort()).toEqual([200, 200, 200, 200, 201]);
  const [row] = await readActions();
  expect(attempts.every(response => response.body.action.id === row.id)).toBe(true);
  expect(row).toMatchObject({
    status: 'pending_approval',
    action_type: 'owner_decision',
    source,
    params: { protocol: 'yuesheng-adb-migration-request/v1', task_id: taskId, device_name: device, lease_version: lease.version, source_commit: sourceCommit },
    execution_result: null,
  });
  expect(row.expires_at.getTime()).toBe(lease.expires_at.getTime());
  expect((await pool.query('SELECT status,claimed_by FROM tasks')).rows).toEqual([{ status: 'in_progress', claimed_by: 'fixture-owner' }]);
});

it('refuses caller-supplied approval, foreign task, drifted version, and a changed source on the same lease', async () => {
  const lease = await readLease();
  const requestBody = { lease_version: lease.version, source_commit: sourceCommit };
  expect((await request(app).post(endpoint(randomUUID())).set('X-Internal-Token', token).send(requestBody)).status).toBe(404);
  expect((await request(app).post(endpoint(taskId)).set('X-Internal-Token', token)
    .send({ ...requestBody, status: 'approved' })).status).toBe(400);
  expect((await send(String(Number(lease.version) + 1))).status).toBe(409);
  expect((await send(lease.version)).status).toBe(201);
  expect((await send(lease.version, 'a'.repeat(40))).status).toBe(409);
  expect(await readActions()).toHaveLength(1);
});

it('rejects an expired or foreign lease, and binds a fresh acquisition to a distinct approval', async () => {
  const firstLease = await readLease();
  const first = await send(firstLease.version);
  await pool.query("UPDATE device_locks SET expires_at=clock_timestamp()-interval '1 second'");
  expect((await send((await readLease()).version)).status).toBe(409);
  await pool.query("UPDATE device_locks SET locked_by='other',expires_at=clock_timestamp()+interval '15 minutes'");
  expect((await send((await readLease()).version)).status).toBe(409);
  await pool.query("UPDATE device_locks SET locked_by=$1,locked_at=clock_timestamp()", [taskId]);
  const second = await send((await readLease()).version);
  expect(second.status).toBe(201);
  expect(second.body.action.id).not.toBe(first.body.action.id);
  expect(await readActions()).toHaveLength(2);
});

it('keeps the new source out of legacy approval, rejection and selection, and expires it without moving the task', async () => {
  const { approvePendingAction, rejectPendingAction, selectProposalOption, expireStaleProposals } = await import('../../decision-executor.js');
  const opened = await send((await readLease()).version);
  const { id } = opened.body.action;
  for (const result of [await approvePendingAction(id), await rejectPendingAction(id), await selectProposalOption(id, 'A')]) {
    expect(result).toMatchObject({ success: false, status: 409 });
  }
  expect((await readActions())[0]).toMatchObject({ status: 'pending_approval', execution_result: null });
  await pool.query("UPDATE pending_actions SET expires_at=clock_timestamp()-interval '1 second'");
  expect(await expireStaleProposals()).toBe(1);
  expect((await readActions())[0]).toMatchObject({ status: 'expired', execution_result: null });
  expect((await pool.query('SELECT status,claimed_by FROM tasks')).rows).toEqual([{ status: 'in_progress', claimed_by: 'fixture-owner' }]);
});

it('authenticates the operator and writes one identical approval to both ledgers under concurrent retries', async () => {
  const requested = await openPlan();
  expect((await request(app).post(approvalEndpoint(taskId)).send(requested)).status).toBe(401);
  delete process.env.CECELIA_INTERNAL_TOKEN;
  try {
    expect((await approve(requested)).status).toBe(503);
  } finally {
    process.env.CECELIA_INTERNAL_TOKEN = token;
  }
  expect((await approve({ ...requested, reviewer: 'pretended-user' })).status).toBe(400);
  const attempts = await Promise.all(Array.from({ length: 5 }, () => approve(requested)));
  expect(attempts.every(response => response.status === 200)).toBe(true);
  const [action] = await readActions();
  const { rows: [task] } = await pool.query('SELECT status, result FROM tasks');
  expect(action).toMatchObject({ status: 'approved', reviewed_by: 'authenticated-operator', execution_result: {
    protocol: 'yuesheng-adb-migration-approval/v1', plan_sha256: requested.plan_sha256,
    approved_by: 'authenticated-operator', actions: ['disconnect_old', 'connect_new'],
    approval_ref: 'pending-action:' + action.id,
  } });
  expect(task).toMatchObject({ status: 'in_progress', result: { preserved: true, yuesheng_adb_migration_approval: action.execution_result } });
  for (const response of attempts) expect(response.body.approval).toEqual(action.execution_result);
  const plan = { ...requested.plan, observation_id: randomUUID() };
  expect((await approve({ plan, plan_sha256: digestPlan(plan) })).status).toBe(409);
  expect((await readActions())[0].execution_result).toEqual(action.execution_result);
});

it('rejects changes in digest, precise endpoints, scope, pending request, claim, and lease without issuing an approval', async () => {
  const requested = await openPlan();
  expect((await approve({ ...requested, plan_sha256: 'a'.repeat(64) })).status).toBe(400);
  for (const [change, status] of [
    [{ old_endpoint: 'tcp:127.0.0.1:5041' }, 400], [{ physical_serial: '127.0.0.1:15555' }, 400],
    [{ claim: { ...requested.plan.claim, claimed_by: 'other' } }, 409], [{ source_commit: 'b'.repeat(40) }, 409],
    [{ lease: { ...requested.plan.lease, lease_version: '1' } }, 409],
  ]) {
    const plan = { ...requested.plan, ...change };
    expect((await approve({ plan, plan_sha256: digestPlan(plan) })).status).toBe(status);
  }
  await pool.query("UPDATE pending_actions SET source='owner_decision_guard'");
  expect((await approve(requested)).status).toBe(409);
  expect((await readActions())[0]).toMatchObject({ status: 'pending_approval', execution_result: null });
});

it('rolls back both ledger changes if the task write fails', async () => {
  const requested = await openPlan();
  await pool.query(`CREATE FUNCTION reject_yuesheng_task_result() RETURNS trigger LANGUAGE plpgsql AS $$
     BEGIN RAISE EXCEPTION 'isolated fixture task update failure'; END; $$;
     CREATE TRIGGER reject_yuesheng_task_result BEFORE UPDATE ON tasks
     FOR EACH ROW EXECUTE FUNCTION reject_yuesheng_task_result()`);
  try {
    expect((await approve(requested)).status).toBe(500);
    expect((await readActions())[0]).toMatchObject({ status: 'pending_approval', execution_result: null });
    expect((await pool.query('SELECT result FROM tasks')).rows[0].result).toEqual({ preserved: true });
  } finally {
    await pool.query('DROP TRIGGER reject_yuesheng_task_result ON tasks; DROP FUNCTION reject_yuesheng_task_result()');
  }
});
