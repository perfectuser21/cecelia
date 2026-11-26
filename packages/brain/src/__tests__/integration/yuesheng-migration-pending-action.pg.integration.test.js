import { randomUUID } from 'node:crypto';
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
    CREATE TABLE tasks(id uuid PRIMARY KEY, status text, claimed_by text, claimed_at timestamptz, payload jsonb);
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
    '{"work_kind":"coding_review","scope":["enable_mmv_yuesheng_5045"]}')`, [taskId]);
  await pool.query(`INSERT INTO device_locks VALUES ($1,$2,clock_timestamp(),clock_timestamp()+interval '15 minutes')`, [device, taskId]);
});

const readLease = async () => (await pool.query('SELECT xmin::text AS version, expires_at FROM device_locks')).rows[0];
const readActions = async () => (await pool.query('SELECT * FROM pending_actions')).rows;

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
