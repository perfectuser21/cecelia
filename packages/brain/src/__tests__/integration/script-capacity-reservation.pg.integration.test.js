import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';
import { DB_DEFAULTS } from '../../db-config.js';
const options = process.env.TEST_DATABASE_URL ? { connectionString: process.env.TEST_DATABASE_URL } : DB_DEFAULTS;
const database = process.env.TEST_DATABASE_URL ? new URL(process.env.TEST_DATABASE_URL).pathname.slice(1) : DB_DEFAULTS.database;
if (!/_(scratch|test)$/.test(database)) throw new Error('scratch/test database required');
const schema = `script_capacity_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const pool = new pg.Pool({ ...options, max: 8, options: `-c search_path=${schema},public` });
const admin = new pg.Client(options);
const machine = 'us-mac-m4';
const snapshot = () => ({ verified: true, machine, expires_at: Date.now() + 60_000,
  capacity: { ok: true, available: 1, physical_base_slots: 6, effective_base_slots: 6 } });
const harness = createAttemptStore(pool);
async function harnessInput(role = 'reporter', flag) {
  const runId = randomUUID();
  await pool.query("INSERT INTO initiative_runs(id,orchestrator_version) VALUES($1,'v2')", [runId]);
  const capacitySnapshot = snapshot();
  if (flag) Object.assign(capacitySnapshot.capacity, { physical_base_slots: 1, effective_base_slots: 1, physical_capacity: 1, [flag]: true });
  return { id: randomUUID(), runId, hop: 1, phase: 'generate', role, provider: 'codex',
    machineId: machine, callbackSecretHash: 'a'.repeat(64), bundle: { inputs: {} }, capacitySnapshot };
}
async function insertReservation() {
  const taskId = randomUUID();
  await pool.query("INSERT INTO tasks(id,status) VALUES($1,'in_progress')", [taskId]);
  return (await pool.query(`INSERT INTO capacity_reservations
    (id,machine_id,owner_kind,owner_key,task_id,config_digest,allocation_mode,policy_version,snapshot_time,snapshot_digest)
    VALUES ($1,$2,'script',$3,$4,$5,'exclusive_unclassified','script-exclusive-v1',NOW(),$5) RETURNING *`,
  [randomUUID(), machine, `script-${taskId}-a1`, taskId, 'a'.repeat(64)])).rows[0];
}
beforeAll(async () => {
  await admin.connect(); await admin.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`CREATE TABLE schema_version(version TEXT PRIMARY KEY,description TEXT,applied_at TIMESTAMPTZ);
    CREATE TABLE tasks(id UUID PRIMARY KEY,status TEXT);
    CREATE TABLE initiative_runs(id UUID PRIMARY KEY,phase TEXT DEFAULT 'planning',map_recovery_contract_id UUID,orchestrator_version TEXT DEFAULT 'v2');
    CREATE TABLE map_recovery_consumptions(contract_id UUID,attempt_id UUID);`);
  for (const name of ['357_harness_provider_attempts','362_kernel_attempt_telemetry_reconcile',
    '363_kernel_fleet_execution_receipts','364_kernel_local_container_naming','425_harness_attempt_cleanup_outbox']) {
    await pool.query(readFileSync(new URL(`../../../migrations/${name}.sql`, import.meta.url),'utf8'));
  }
  await pool.query(`CREATE TABLE capacity_reservations(id UUID PRIMARY KEY,machine_id TEXT,owner_kind TEXT,
    owner_key TEXT,task_id UUID REFERENCES tasks(id) ON DELETE RESTRICT,config_digest TEXT,allocation_mode TEXT,
    policy_version TEXT,snapshot_time TIMESTAMPTZ,snapshot_digest TEXT,status TEXT DEFAULT 'reserved')`);
});
beforeEach(async () => { await pool.query('TRUNCATE capacity_reservations,tasks,harness_attempt_cleanup_outbox,harness_attempts,initiative_runs CASCADE'); });
afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); });
describe('脚本与 Harness 共用机器预约', () => {
  it.each(['planner','proposer','generator','evaluator','judge','reporter'])('未清理脚本阻止 %s 真实创建', async (role) => {
    await insertReservation();
    await expect(harness.createAttempt(await harnessInput(role))).rejects.toThrow('capacity_contended');
    expect((await pool.query('SELECT id FROM harness_attempts')).rows).toHaveLength(0);
  });
  it.each(['autonomous_progress_floor','manual_capacity_override'])('未清理脚本阻止 %s 单例', async (flag) => {
    await insertReservation();
    await expect(harness.createAttempt(await harnessInput('generator', flag))).rejects.toThrow('capacity_contended');
  });
  it.each(['reserved','launching','running','cleanup_pending','blocked'])('%s 不因任务终态释放', async (status) => {
    const row = await insertReservation();
    await pool.query('UPDATE capacity_reservations SET status=$1 WHERE id=$2',[status,row.id]);
    await pool.query("UPDATE tasks SET status='failed' WHERE id=$1",[row.task_id]);
    await expect(harness.createAttempt(await harnessInput())).rejects.toThrow('capacity_contended');
    await expect(pool.query('DELETE FROM tasks WHERE id=$1',[row.task_id])).rejects.toThrow();
  });
});
