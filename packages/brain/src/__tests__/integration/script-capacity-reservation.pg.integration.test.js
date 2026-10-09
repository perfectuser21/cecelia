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
  await pool.query(readFileSync(new URL('../../../migrations/501_capacity_reservations.sql', import.meta.url),'utf8'));
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

async function reservationStore(connectionPool = pool) {
  const { createScriptReservationStore } = await import('../../orchestrator/script-reservation-store.js');
  return createScriptReservationStore(connectionPool);
}
async function scriptInput() {
  const taskId = randomUUID();
  await pool.query("INSERT INTO tasks(id,status) VALUES($1,'queued')", [taskId]);
  return { taskId, machineId: machine, ownerKey: `script-${taskId}-a1`, configDigest: 'b'.repeat(64), capacitySnapshot: snapshot() };
}
function cleanupReceipt(row, extras = {}) {
  return { authenticated: true, receipt: { status: 'cleaned', absent: true, tombstoned: true,
    reservation_id: row.id, machine_id: row.machine_id, owner_key: row.owner_key,
    launch_generation: row.launch_generation, intent_id: row.intent_id,
    worker_id: row.worker_id, worker_boot_id: row.worker_boot_id, container_id: row.container_id,
    challenge: row.cleanup_challenge, ...extras } };
}
describe('脚本预约权威状态机', () => {
  it('脚本与 Harness 并发只产生一方预约', async () => {
    const store = await reservationStore();
    const [s, h] = await Promise.all([scriptInput(), harnessInput()]);
    const outcomes = await Promise.allSettled([store.reserve(s), harness.createAttempt(h)]);
    const count = (await pool.query(`SELECT (SELECT count(*) FROM capacity_reservations)
      + (SELECT count(*) FROM harness_attempts) AS n`)).rows[0].n;
    expect(Number(count)).toBe(1);
    expect(outcomes.some((x) => x.status === 'fulfilled')).toBe(true);
  });
  it('相同 owner 并发幂等；config 改变拒绝，即使快照已过期', async () => {
    const store = await reservationStore(); const value = await scriptInput();
    const outcomes = await Promise.all([store.reserve(value),store.reserve(value)]);
    expect(outcomes[0].reservation.id).toBe(outcomes[1].reservation.id);
    await expect(store.reserve({ ...value, capacitySnapshot: null })).resolves.toMatchObject({ outcome:'reserved' });
    await expect(store.reserve({ ...value, configDigest: 'c'.repeat(64) })).rejects.toThrow('configuration_conflict');
  });
  it('已有 Harness 或 pending cleanup 时脚本等待；缺失、过期和零快照拒绝', async () => {
    const store = await reservationStore(); const value = await scriptInput();
    await harness.createAttempt(await harnessInput());
    await expect(store.reserve(value)).resolves.toMatchObject({ outcome:'wait' });
    await pool.query("UPDATE harness_attempts SET status='failed' RETURNING id");
    for (const capacitySnapshot of [null,{ ...snapshot(),expires_at:0 },
      { ...snapshot(), capacity:{ ...snapshot().capacity,effective_base_slots:0 } }]) {
      await expect(store.reserve({ ...value,capacitySnapshot })).resolves.toMatchObject({ outcome:'wait' });
    }
  });
  it('cleanup lease 过期和任务取消仍占用，错误 generation/challenge/auth 无法释放', async () => {
    const store = await reservationStore(); const value = await scriptInput();
    let { reservation: row } = await store.reserve(value);
    row = await store.markLaunching(row.id, { worker_id:'worker',worker_boot_id:'boot' });
    row = await store.markRunning(row.id, { worker_id:'worker',worker_boot_id:'boot',container_id:'d'.repeat(64) });
    await pool.query("UPDATE tasks SET status='cancelled' WHERE id=$1",[row.task_id]);
    const claim = await store.claimCleanup(row.id,'reaper',60_000);
    await expect(store.confirmCleanup(claim,cleanupReceipt(claim,{ launch_generation:2 }))).rejects.toThrow('cleanup_receipt_mismatch');
    await expect(store.confirmCleanup(claim,cleanupReceipt(claim,{ challenge:randomUUID() }))).rejects.toThrow('cleanup_receipt_mismatch');
    await expect(store.confirmCleanup(claim,{ ...cleanupReceipt(claim),authenticated:false })).rejects.toThrow('cleanup_receipt_unverified');
    await pool.query("UPDATE capacity_reservations SET cleanup_claim_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[row.id]);
    await expect(harness.createAttempt(await harnessInput())).rejects.toThrow('capacity_contended');
    const newer = await store.claimCleanup(row.id,'reaper2',60_000);
    await expect(store.confirmCleanup(claim,cleanupReceipt(claim))).rejects.toThrow('cleanup_claim_stale');
    await expect(store.confirmCleanup(newer,cleanupReceipt(newer))).resolves.toMatchObject({ status:'released' });
    await expect(harness.createAttempt(await harnessInput())).resolves.toMatchObject({ status:'queued' });
    await expect(pool.query("UPDATE capacity_reservations SET status='reserved',released_at=NULL WHERE id=$1",[row.id])).rejects.toThrow('released_terminal');
  });
  it('不可换容器或重绑 launch generation；released owner 不可重新启动', async () => {
    const store = await reservationStore(); const value = await scriptInput();
    const { reservation: row } = await store.reserve(value);
    await store.markLaunching(row.id,{ worker_id:'worker',worker_boot_id:'boot' });
    await store.markRunning(row.id,{ worker_id:'worker',worker_boot_id:'boot',container_id:'d'.repeat(64) });
    await expect(store.markRunning(row.id,{ worker_id:'worker',worker_boot_id:'boot',container_id:'e'.repeat(64) })).rejects.toThrow();
    await expect(pool.query('UPDATE capacity_reservations SET launch_generation=2 WHERE id=$1',[row.id])).rejects.toThrow('identity_immutable');
    const claim = await store.claimCleanup(row.id,'reaper',60_000);
    await store.confirmCleanup(claim,cleanupReceipt(claim));
    await expect(store.markLaunching(row.id,{ worker_id:'worker',worker_boot_id:'boot' })).rejects.toThrow();
    await expect(store.reserve(value)).resolves.toMatchObject({ outcome:'released' });
  });
});

describe('脚本预约拒绝未确认 Harness 清理和过时证据', () => {
  it.each(['pending','leased','blocked'])('Harness 已终态但 %s outbox 仍阻止脚本', async (status) => {
    const store = await reservationStore(); const value = await scriptInput();
    const active = await harness.createAttempt(await harnessInput());
    await pool.query(`INSERT INTO harness_attempt_cleanup_outbox
      (attempt_id,run_id,target_machine_id,lease_generation,status,cleanup_cause)
      VALUES($1,$2,$3,0,'pending','cancel_unknown')`, [active.id,active.run_id,machine]);
    await pool.query("UPDATE harness_attempts SET status='failed' WHERE id=$1",[active.id]);
    if (status === 'leased') await pool.query(`UPDATE harness_attempt_cleanup_outbox
      SET status='leased',claim_owner='cleanup',claim_generation=1,claim_expires_at=NOW()+INTERVAL '1 minute'`);
    if (status === 'blocked') await pool.query("UPDATE harness_attempt_cleanup_outbox SET status='blocked',blocked_at=NOW()");
    await expect(store.reserve(value)).resolves.toMatchObject({outcome:'wait'});
    expect((await pool.query('SELECT id FROM capacity_reservations')).rows).toHaveLength(0);
  });
  it('脚本等待同机事务锁期间快照过期，取得锁后拒绝预约', async () => {
    const value = await scriptInput();
    const creator=await pool.connect(); const pid=(await creator.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const store=await reservationStore({connect:async()=>({query:creator.query.bind(creator),release(){}})});
    const blocker = await pool.connect(); await blocker.query('BEGIN');
    await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('harness_attempt_machine:' || $1::text,0))",[machine]);
    value.capacitySnapshot.expires_at=Date.now()+150;
    const pending=store.reserve(value);
    const waited=await waitsForLock(pid);
    await new Promise((resolve)=>setTimeout(resolve,Math.max(0,value.capacitySnapshot.expires_at-Date.now()+5)));
    await blocker.query('COMMIT');blocker.release();
    expect(waited).toBe(true);
    await expect(pending).resolves.toMatchObject({outcome:'wait'});creator.release();
    expect((await pool.query('SELECT id FROM capacity_reservations')).rows).toHaveLength(0);
  });
});

it('任务取消事务先拿到行锁：reserve 读到提交后终态，不能新建预约', async () => {
  const value=await scriptInput();
  const creator=await pool.connect();const pid=(await creator.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const store=await reservationStore({connect:async()=>({query:creator.query.bind(creator),release(){}})});
  const blocker=await pool.connect(); await blocker.query('BEGIN');
  await blocker.query("UPDATE tasks SET status='cancelled' WHERE id=$1",[value.taskId]);
  const pending=store.reserve(value).then((result)=>result,(error)=>error);
  const waited=await waitsForLock(pid);
  await blocker.query('COMMIT');blocker.release();
  const outcome=await pending;creator.release();
  expect(waited).toBe(true);
  expect(outcome).toBeInstanceOf(Error);
  expect((await pool.query('SELECT id FROM capacity_reservations')).rows).toHaveLength(0);
});

async function waitsForLock(pid) {
  for(let i=0;i<200;i++) {
    const row=(await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];
    if(row?.wait_event_type==='Lock')return true;
    await new Promise((resolve)=>setTimeout(resolve,5));
  }
  return false;
}
it('INSERT 发出前跨越快照期限，数据库最终闸门拒绝写入',async()=>{
  const value=await scriptInput();value.capacitySnapshot.expires_at=Date.now()+100;
  const delayed={connect:async()=>{
    const c=await pool.connect();return {release:()=>c.release(),query:async(sql,args)=>{
      if(sql.startsWith('INSERT INTO capacity_reservations')) await new Promise((r)=>setTimeout(r,150));
      return c.query(sql,args);
    }};
  }};
  const store=await reservationStore(delayed);
  await expect(store.reserve(value)).resolves.toMatchObject({outcome:'wait'});
  expect((await pool.query('SELECT id FROM capacity_reservations')).rows).toHaveLength(0);
});
