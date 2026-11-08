import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { applyProjectionCommands, recordProjectionCommand } from '../../projection/commands.js';

// Real SQL on a fresh test-owned schema. No dispatcher/model/notification is started.
let admin, schema;
const clients = [];
let previousFetch;
const forbiddenNetwork = [];
const connect = async application_name => {
  const db = new pg.Client({ ...DB_DEFAULTS, application_name, statement_timeout: 5000 });
  await db.connect(); clients.push(db);
  await db.query(`SET search_path TO ${schema},pg_catalog`);
  return db;
};
beforeAll(async () => {
  const ownedSocket = DB_DEFAULTS.database === 'cecelia_scratch'
    && /^\/tmp\/cipr-[a-zA-Z0-9_-]+\/socket$/.test(DB_DEFAULTS.host)
    && DB_DEFAULTS.port !== 5432 && process.env.PROJECTION_TEST_PGDATA;
  const ciService = process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test'
    && ['localhost', '127.0.0.1'].includes(DB_DEFAULTS.host);
  if (process.env.POSTGRES_INTEGRATION !== '1' || !(ownedSocket || ciService)) {
    throw Error('projection cancellation requires explicit owned scratch or CI test PG');
  }
  admin = new pg.Client({ ...DB_DEFAULTS, statement_timeout: 5000 });
  await admin.connect();
  const identity = (await admin.query('SELECT current_database() AS db,current_user AS actor')).rows[0];
  expect(identity).toEqual({ db: DB_DEFAULTS.database, actor: DB_DEFAULTS.user });
  if (ownedSocket) {
    const actual = (await admin.query("SELECT current_setting('data_directory') AS dir,current_setting('listen_addresses') AS listen")).rows[0];
    expect(await realpath(actual.dir)).toBe(await realpath(process.env.PROJECTION_TEST_PGDATA));
    expect(actual.listen).toBe('');
  }
  schema = `projection_cancel_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`SET search_path TO ${schema},pg_catalog`);
  // Command table is the actual migration; task/event fixture contains only columns used here.
  const migration = await readFile(new URL('../../../migrations/395_workbench_projection.sql', import.meta.url), 'utf8');
  const commandDdl = migration.match(/CREATE TABLE IF NOT EXISTS projection_commands \([\s\S]*?\n\);/)?.[0];
  expect(commandDdl).toBeTruthy();
  await admin.query(`CREATE TABLE tasks (
    id uuid PRIMARY KEY,status text NOT NULL,priority text DEFAULT 'P2',
    payload jsonb DEFAULT '{}',description text,updated_at timestamptz DEFAULT now(),
    claimed_by text,started_at timestamptz
  ); CREATE TABLE cecelia_events (
    id bigint GENERATED ALWAYS AS IDENTITY,event_type text,source text,payload jsonb
  ); ${commandDdl}`);
  previousFetch = globalThis.fetch;
  globalThis.fetch = (...args) => { forbiddenNetwork.push(args); throw Error('projection test forbids business network'); };
});
beforeEach(async () => {
  forbiddenNetwork.length = 0;
  await admin.query('TRUNCATE projection_commands,tasks,cecelia_events');
});
afterEach(() => { expect(forbiddenNetwork).toEqual([]); });
afterAll(async () => {
  if (previousFetch) globalThis.fetch = previousFetch;
  for (const db of clients) await db.end();
  try { if (schema) await admin.query(`DROP SCHEMA ${schema} CASCADE`); }
  finally { await admin?.end(); }
});
const prepare = async (status, commandType = 'cancel_requested', payload = {}) => {
  const taskId = randomUUID();
  await admin.query('INSERT INTO tasks(id,status) VALUES($1,$2)', [taskId, status]);
  const command = await recordProjectionCommand(admin, {
    target: 'owned-notion', externalId: randomUUID(), entityId: taskId, commandType, payload,
  });
  return { taskId, command };
};
const task = async id => (await admin.query('SELECT * FROM tasks WHERE id=$1', [id])).rows[0] ?? null;
const command = async id => (await admin.query('SELECT * FROM projection_commands WHERE id=$1', [id])).rows[0];
const appliedEvents = async () => (await admin.query("SELECT payload FROM cecelia_events WHERE event_type='projection_command_applied'")).rows;

it.each(['queued', 'pending', 'blocked', 'paused'])('cancels an eligible %s task and persists exactly one applied event', async status => {
  const entry = await prepare(status);
  expect(await applyProjectionCommands(admin)).toEqual({ applied: 1, rejected: 0, failed: 0 });
  expect((await task(entry.taskId)).status).toBe('cancelled');
  expect(await command(entry.command.id)).toMatchObject({ status: 'applied', reason: null, leased_at: null });
  expect(await appliedEvents()).toEqual([{ payload: { command_id: entry.command.id, command_type: 'cancel_requested', task_id: entry.taskId } }]);
});
it.each(['in_progress', 'completed', 'failed'])('refuses cancellation of an already %s task without an applied event', async status => {
  const entry = await prepare(status);
  expect(await applyProjectionCommands(admin)).toEqual({ applied: 0, rejected: 1, failed: 0 });
  expect((await task(entry.taskId)).status).toBe(status);
  expect(await command(entry.command.id)).toMatchObject({ status: 'rejected', reason: `active_or_terminal:${status}` });
  expect(await appliedEvents()).toEqual([]);
});
it('keeps normal start and annotation commands unchanged', async () => {
  const start = await prepare('queued', 'start_requested');
  expect((await applyProjectionCommands(admin)).applied).toBe(1);
  expect(await task(start.taskId)).toMatchObject({ status: 'queued', priority: 'P1', payload: { start_requested_source: 'projection' } });
  const note = await prepare('in_progress', 'annotate_requested', { annotation: 'owned note' });
  expect((await applyProjectionCommands(admin)).applied).toBe(1);
  expect(await task(note.taskId)).toMatchObject({ status: 'in_progress', description: '\n[Projection 批注] owned note' });
});

it.each(['dispatch', 'delete'])('rejects cancellation when %s wins after the initial read (real lock wait)', async winner => {
  const entry = await prepare('queued');
  const projection = await connect(`owned-projection-${randomUUID()}`);
  const competitor = await connect('owned-dispatch-competitor');
  const pid = (await projection.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  let releaseRead, observed;
  const readComplete = new Promise(resolve => { observed = resolve; });
  const release = new Promise(resolve => { releaseRead = resolve; });
  // Only scheduling is controlled. Every statement, including SELECT/UPDATE, reaches real PG.
  const boundary = { query: async (sql, params) => {
    const result = await projection.query(sql, params);
    if (String(sql).startsWith('SELECT id, status FROM tasks')) {
      observed(result.rows[0]); await release;
    }
    return result;
  } };
  const operation = applyProjectionCommands(boundary);
  try {
    expect(await readComplete).toMatchObject({ id: entry.taskId, status: 'queued' });
    await competitor.query('BEGIN');
    // Representative dispatch CAS, not a claim of running the full dispatcher/executor.
    const claimed = winner === 'dispatch'
      ? await competitor.query("UPDATE tasks SET status='in_progress',claimed_by='owned-dispatch',started_at=NOW() WHERE id=$1 AND status='queued' RETURNING id", [entry.taskId])
      : await competitor.query('DELETE FROM tasks WHERE id=$1 RETURNING id', [entry.taskId]);
    expect(claimed.rowCount).toBe(1);
    releaseRead();
    await vi.waitFor(async () => {
      const waiting = await admin.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'", [pid]);
      expect(waiting.rows).toHaveLength(1);
    }, { timeout: 2000, interval: 5 });
    await competitor.query('COMMIT');
    const result = await operation;
    expect(result).toEqual({ applied: 0, rejected: 1, failed: 0 });
    if (winner === 'dispatch') expect(await task(entry.taskId)).toMatchObject({ status: 'in_progress', claimed_by: 'owned-dispatch' });
    else expect(await task(entry.taskId)).toBeNull();
    expect(await command(entry.command.id)).toMatchObject({ status: 'rejected', reason: 'task_changed_before_cancel', leased_at: null });
    expect((await command(entry.command.id)).processed_at).toBeInstanceOf(Date);
    expect(await appliedEvents()).toEqual([]);
  } finally {
    releaseRead();
    await competitor.query('ROLLBACK');
    await operation.catch(() => {});
  }
});
