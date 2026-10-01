import { confirmExpiredParentCleanup } from '../../orchestrator/attempt-resource-cleanup.js';
import { reserveExpiredAttemptReplacement } from '../../orchestrator/attempt-resource-replacement.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';

const database = process.env.TEST_DATABASE_URL
  ? decodeURIComponent(new URL(process.env.TEST_DATABASE_URL).pathname.slice(1))
  : DB_DEFAULTS.database;
if (!/_(scratch|test)$/.test(database)) throw new Error('scratch/test database required');
const schema = `weighted_${process.pid}_${randomUUID().replaceAll('-', '')}`;
const options = process.env.TEST_DATABASE_URL
  ? { connectionString: process.env.TEST_DATABASE_URL } : DB_DEFAULTS;
const pool = new pg.Pool({ ...options, max: 8, options: `-c search_path=${schema},public` });
let admin;
const machine = 'us-mac-m4';
function snapshot(slots = 6, extras = {}) {
  return { verified: true, machine, expires_at: Date.now() + 60_000,
    capacity: { ok: true, available: 1, physical_capacity: 2,
      physical_base_slots: slots, effective_base_slots: slots, ...extras } };
}
async function input(role = 'generator', slots = 6, extras = {}) {
  const runId = randomUUID();
  await pool.query("INSERT INTO initiative_runs(id,orchestrator_version) VALUES($1,'v2')", [runId]);
  return { id: randomUUID(), runId, hop: 1, phase: 'generate', role,
    provider: 'codex', machineId: machine, callbackSecretHash: 'a'.repeat(64),
    bundle: { inputs: {} }, capacitySnapshot: snapshot(slots), ...extras };
}
const store = createAttemptStore(pool);
beforeAll(async () => {
  admin = new pg.Client(options);
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE schema_version(version TEXT PRIMARY KEY, description TEXT, applied_at TIMESTAMPTZ);
      CREATE TABLE initiative_runs(id UUID PRIMARY KEY, phase TEXT DEFAULT 'planning', map_recovery_contract_id UUID,
        orchestrator_version TEXT DEFAULT 'v2');
      CREATE TABLE map_recovery_consumptions(contract_id UUID, attempt_id UUID);`);
    for (const name of ['357_harness_provider_attempts', '362_kernel_attempt_telemetry_reconcile',
      '363_kernel_fleet_execution_receipts', '364_kernel_local_container_naming',
      '425_harness_attempt_cleanup_outbox']) {
      await client.query(readFileSync(new URL(`../../../migrations/${name}.sql`, import.meta.url), 'utf8'));
    }
    await client.query('ALTER TABLE harness_attempts ADD COLUMN failure_class TEXT');
  } finally { client.release(); }
});
beforeEach(async () => {
  await pool.query('TRUNCATE harness_attempt_cleanup_outbox, harness_attempts, initiative_runs, map_recovery_consumptions CASCADE');
});
afterAll(async () => {
  await pool.end();
  if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
});

describe('真实 PG 加权预约与未确认取消', () => {
  it('并发 generator(4)+generator(4) 不能超出六基础槽', async () => {
    const inputs = await Promise.all([input(), input()]);
    const outcomes = await Promise.allSettled(inputs.map((value) => store.createAttempt(value)));
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await pool.query('SELECT id FROM harness_attempts')).rows).toHaveLength(1);
  });
  it('混合 generator(4)+proposer(2) 占满六槽，reporter(1) 等待', async () => {
    await store.createAttempt(await input());
    await store.createAttempt(await input('proposer'));
    await expect(store.createAttempt(await input('reporter'))).rejects.toThrow('machine_capacity_contended');
  });
  it('run/hop 幂等不追加，即使快照已过期', async () => {
    const value = await input();
    const winner = await store.createAttempt(value);
    await expect(store.createAttempt({ ...value, id: randomUUID(), capacitySnapshot: { ...value.capacitySnapshot, expires_at: 0 } }))
      .resolves.toMatchObject({ id: winner.id });
    expect((await pool.query('SELECT id FROM harness_attempts')).rows).toHaveLength(1);
  });
  it.each(['autonomous_progress_floor', 'manual_capacity_override'])('%s 单例排他', async (flag) => {
    await store.createAttempt(await input('generator', 1, { capacitySnapshot: snapshot(1, { [flag]: true }) }));
    await expect(store.createAttempt(await input('reporter'))).rejects.toThrow('capacity_contended');
  });
  it('缺失快照、未知角色不能新增', async () => {
    await expect(store.createAttempt(await input('generator', 6, { capacitySnapshot: null }))).rejects.toThrow('capacity_contended');
    await expect(store.createAttempt(await input('mystery'))).rejects.toThrow('capacity_contended');
    expect((await pool.query('SELECT id FROM harness_attempts')).rows).toHaveLength(0);
  });
  it('锁等待期间快照过期，提交后仍拒绝新增', async () => {
    const value = await input();
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('harness_attempt_machine:' || $1::text, 0))", [machine]);
    value.capacitySnapshot.expires_at = Date.now() + 60;
    const pending = store.createAttempt(value).then(() => null, (error) => error);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await blocker.query('COMMIT'); blocker.release();
    expect((await pending)?.message).toContain('capacity_contended');
  });
  it('取消未知同事务留 outbox，pending/blocked 保留预算，confirmed 才释放', async () => {
    const first = await store.createAttempt(await input('generator', 4));
    await pool.query("UPDATE harness_attempts SET status='running',execution_transport='remote-bridge',remote_job_id='job-1',lease_owner='worker',lease_generation=2 WHERE id=$1", [first.id]);
    await store.fail(first.id, { code: 'launch_start_failed', message: 'cancel timeout' }, { retainResources: true });
    const outbox = (await pool.query('SELECT * FROM harness_attempt_cleanup_outbox')).rows;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ attempt_id: first.id, remote_job_id: 'job-1', lease_owner: 'worker', lease_generation: 2 });
    await expect(store.createAttempt(await input('reporter', 4))).rejects.toThrow('capacity_contended');
    await pool.query("UPDATE harness_attempt_cleanup_outbox SET status='blocked',blocked_at=NOW() WHERE id=$1", [outbox[0].id]);
    await expect(store.createAttempt(await input('reporter', 4))).rejects.toThrow('capacity_contended');
    await pool.query("UPDATE harness_attempt_cleanup_outbox SET status='pending',blocked_at=NULL WHERE id=$1", [outbox[0].id]);
    await pool.query("UPDATE harness_attempt_cleanup_outbox SET status='leased',claim_owner='cleanup',claim_generation=1,claim_expires_at=NOW()+interval '1 minute' WHERE id=$1", [outbox[0].id]);
    await pool.query("UPDATE harness_attempt_cleanup_outbox SET status='confirmed',confirmed_at=NOW(),receipt='{}' WHERE id=$1", [outbox[0].id]);
    await expect(store.createAttempt(await input('reporter', 4))).resolves.toMatchObject({ status: 'queued' });
  });
  it('425 父 run 终态 trigger 的 cleanup 也占用预算', async () => {
    const first = await store.createAttempt(await input('generator', 4));
    await pool.query("UPDATE initiative_runs SET phase='failed' WHERE id=$1", [first.run_id]);
    expect((await pool.query('SELECT status FROM harness_attempt_cleanup_outbox')).rows).toEqual([{ status: 'pending' }]);
    await expect(store.createAttempt(await input('reporter', 4))).rejects.toThrow('capacity_contended');
  });
  it('失败留痕写入错误时终态和预约一起回滚', async () => {
    const first = await store.createAttempt(await input('generator', 4));
    const tx = await pool.connect();
    await tx.query('BEGIN');
    try {
      await createAttemptStore(tx, { transactionClient: true }).fail(first.id, { code: 'cancel_unknown' }, { retainResources: true });
      await tx.query('SELECT 1 / 0');
    } catch { await tx.query('ROLLBACK'); } finally { tx.release(); }
    expect((await pool.query('SELECT status FROM harness_attempts WHERE id=$1', [first.id])).rows[0].status).toBe('queued');
    expect((await pool.query('SELECT id FROM harness_attempt_cleanup_outbox')).rows).toHaveLength(0);
    await expect(store.createAttempt(await input('reporter', 4))).rejects.toThrow('capacity_contended');
  });
  it('确认旧进程退出后原子替换4槽父为4槽子，不产生8槽窗口', async () => {
    const parent = await store.createAttempt(await input('generator', 4));
    await pool.query("UPDATE harness_attempts SET status='running',lease_owner='old',lease_expires_at=NOW()-interval '1 minute' WHERE id=$1", [parent.id]);
    const old = (await pool.query('SELECT * FROM harness_attempts WHERE id=$1', [parent.id])).rows[0];
    const childInput = { ...await input('generator', 4), runId: parent.run_id, hop: 2 };
    const replacement = await reserveExpiredAttemptReplacement({ pool, parentAttempt: old, childInput,
      collectSnapshot: async () => snapshot(4),
      confirmCleanup: async (locked) => ({ status: 'cleaned', attempt_id: locked.id }),
    });
    expect(replacement.child.status).toBe('queued');
    expect((await pool.query('SELECT status FROM harness_attempts WHERE id=$1', [parent.id])).rows[0].status).toBe('failed');
    expect((await pool.query("SELECT id FROM harness_attempts WHERE status IN ('queued','running','starting')")).rows).toHaveLength(1);
  });
  it.each(['unknown', 'wrong_identity', 'rollback_after_clean'])('恢复%s保留父预算和原generation', async (scenario) => {
    const parent = await store.createAttempt(await input('generator', 4));
    await pool.query("UPDATE harness_attempts SET status='running',lease_owner='old',lease_expires_at=NOW()-interval '1 minute' WHERE id=$1", [parent.id]);
    const old = (await pool.query('SELECT * FROM harness_attempts WHERE id=$1', [parent.id])).rows[0];
    const childInput = { ...await input('generator', 4), runId: parent.run_id, hop: 2,
      ...(scenario === 'rollback_after_clean' ? { id: parent.id } : {}) };
    await expect(reserveExpiredAttemptReplacement({ pool, parentAttempt: old, childInput,
      collectSnapshot: async () => snapshot(4),
      confirmCleanup: async () => ({ status: scenario === 'unknown' ? 'missing' : 'cleaned',
        attempt_id: scenario === 'wrong_identity' ? randomUUID() : old.id }),
    })).rejects.toThrow();
    expect((await pool.query('SELECT status,lease_generation FROM harness_attempts WHERE id=$1', [parent.id])).rows[0])
      .toEqual({ status: 'running', lease_generation: old.lease_generation });
    await expect(store.createAttempt(await input('reporter', 4))).rejects.toThrow('capacity_contended');
  });
  it('已续租父不会被取消或替换', async () => {
    const parent = await store.createAttempt(await input('generator', 4));
    await pool.query("UPDATE harness_attempts SET status='running',lease_owner='old',lease_expires_at=NOW()+interval '1 minute' WHERE id=$1", [parent.id]);
    const old = (await pool.query('SELECT * FROM harness_attempts WHERE id=$1', [parent.id])).rows[0];
    let cancelled = false;
    expect(await reserveExpiredAttemptReplacement({ pool, parentAttempt: old,
      childInput: { ...await input('generator', 4), runId: parent.run_id, hop: 2 },
      collectSnapshot: async () => snapshot(4), confirmCleanup: async () => { cancelled = true; },
    })).toBeNull();
    expect(cancelled).toBe(false);
  });

  it('活动和多代cleanup交集只计一个attempt，不重复扣权重', async () => {
    const first = await store.createAttempt(await input('proposer', 4));
    for (const generation of [0, 1]) {
      await pool.query(`INSERT INTO harness_attempt_cleanup_outbox(run_id,attempt_id,target_machine_id,lease_generation,cleanup_cause)
        VALUES($1,$2,$3,$4,'unknown')`, [first.run_id, first.id, machine, generation]);
    }
    await expect(store.createAttempt(await input('proposer', 4))).resolves.toMatchObject({ status: 'queued' });
    await expect(store.createAttempt(await input('reporter', 4))).rejects.toThrow('capacity_contended');
  });
  it('未知既存role阻止新增，不能默认为零权重', async () => {
    const first = await store.createAttempt(await input('proposer', 4));
    await pool.query('ALTER TABLE harness_attempts DROP CONSTRAINT harness_attempts_role_check');
    await pool.query("UPDATE harness_attempts SET role='future_role' WHERE id=$1", [first.id]);
    await expect(store.createAttempt(await input('reporter', 7))).rejects.toThrow('capacity_contended');
  });
  it('回执写入失败时cleanup保留刚验证的外部执行identity', async () => {
    const first = await store.createAttempt(await input('generator', 4));
    await store.fail(first.id, { code: 'launch_receipt_persist_failed' }, {
      retainResources: true, cleanupIdentity: { actualMachineId: machine, executionTransport: 'fleet-worker', remoteJobId: 'external-exact-job' },
    });
    expect((await pool.query('SELECT target_machine_id,execution_transport,remote_job_id FROM harness_attempt_cleanup_outbox')).rows)
      .toEqual([{ target_machine_id: machine, execution_transport: 'fleet-worker', remote_job_id: 'external-exact-job' }]);
  });
  it('从未launch的普通失败无需cleanup并释放预算', async () => {
    const first = await store.createAttempt(await input('generator', 4));
    await store.fail(first.id, { code: 'bundle_invalid' });
    expect((await pool.query('SELECT id FROM harness_attempt_cleanup_outbox')).rows).toHaveLength(0);
    await expect(store.createAttempt(await input('generator', 4))).resolves.toMatchObject({ status: 'queued' });
  });

  it('精确legacy清理成功后DB回滚，真实helper重试不存在容器并完成预算转移', async () => {
    const parent = await store.createAttempt(await input('generator', 4));
    await pool.query(`UPDATE harness_attempts SET status='running',lease_owner='old',lease_expires_at=NOW()-interval '1 minute',
      execution_transport='local-docker',local_container_naming='legacy-unsuffixed' WHERE id=$1`, [parent.id]);
    const old = (await pool.query('SELECT * FROM harness_attempts WHERE id=$1', [parent.id])).rows[0];
    const childInput = { ...await input('generator', 4), runId: parent.run_id, hop: 2 };
    let exists = true;
    const receipts = [];
    const confirmCleanup = async (locked) => {
      const receipt = await confirmExpiredParentCleanup(locked, {
        env: { CECELIA_MACHINE_ID: machine },
        removeContainer: async () => { const removed = exists; exists = false; return removed; },
        inspectContainer: async () => exists,
      });
      receipts.push(receipt.status);
      return receipt;
    };
    await expect(reserveExpiredAttemptReplacement({ pool, parentAttempt: old,
      childInput: { ...childInput, id: parent.id }, collectSnapshot: async () => snapshot(4), confirmCleanup }))
      .rejects.toThrow();
    expect((await pool.query('SELECT status FROM harness_attempts WHERE id=$1', [parent.id])).rows[0].status).toBe('running');
    const replacement = await reserveExpiredAttemptReplacement({ pool, parentAttempt: old, childInput,
      collectSnapshot: async () => snapshot(4), confirmCleanup });
    expect(receipts).toEqual(['cleaned', 'already_clean']);
    expect(replacement.child).toMatchObject({ id: childInput.id, status: 'queued' });
    expect((await pool.query('SELECT status FROM harness_attempts WHERE id=$1', [parent.id])).rows[0].status).toBe('failed');
  });

});
