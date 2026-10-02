import { importLegacyPolicy } from '../../execution-directory/store.js';
import { directory } from '../../execution-directory/directory.js';
import { LEGACY_BINDINGS } from '../../execution-directory/legacy-policy.js';
import { confirmExpiredParentCleanup } from '../../orchestrator/attempt-resource-cleanup.js';
import { reserveExpiredAttemptReplacement } from '../../orchestrator/attempt-resource-replacement.js';
import { reconcileExpiredKernelAttempt } from '../../harness-relay-watchdog.js';
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
    provider: 'codex', accountId: 'team1', machineId: machine, callbackSecretHash: 'a'.repeat(64),
    bundle: { inputs: {workspace_spec:{repo:"perfectuser21/cecelia"}} }, capacitySnapshot: snapshot(slots), ...extras };
}
const store = createAttemptStore(pool);
beforeAll(async () => {
  admin = new pg.Client(options);
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE system_registry(id UUID PRIMARY KEY,type TEXT,name TEXT,status TEXT,metadata JSONB DEFAULT '{}');
      CREATE TABLE tasks(id UUID PRIMARY KEY,status TEXT);
      CREATE TABLE schema_version(version TEXT PRIMARY KEY, description TEXT, applied_at TIMESTAMPTZ);
      CREATE TABLE initiative_runs(id UUID PRIMARY KEY, phase TEXT DEFAULT 'planning', map_recovery_contract_id UUID,
        orchestrator_version TEXT DEFAULT 'v2');
      CREATE TABLE map_recovery_consumptions(contract_id UUID, attempt_id UUID);`);
    for (const name of ['357_harness_provider_attempts', '362_kernel_attempt_telemetry_reconcile',
      '363_kernel_fleet_execution_receipts', '364_kernel_local_container_naming',
      '425_harness_attempt_cleanup_outbox', '501_capacity_reservations', '503_execution_directory']) {
      await client.query(readFileSync(new URL(`../../../migrations/${name}.sql`, import.meta.url), 'utf8'));
    }
    await client.query('ALTER TABLE harness_attempts ADD COLUMN failure_class TEXT');
  } finally { client.release(); }
  for(const [,id,name] of LEGACY_BINDINGS) await pool.query("INSERT INTO system_registry(id,type,name,status) VALUES($1,'machine',$2,'active')",[id,name]);
  await importLegacyPolicy({pool,env:{FLEET_WORKER_US_MAC_M4_URL:'http://mmv:5231'}});
});
beforeEach(async () => {
  await directory.refresh({pool});
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

  it.each([true, false])('真实恢复编排保留父清理身份，子启动结果=%s', async (ok) => {
    const first = await store.createAttempt(await input('generator', 4));
    await pool.query(`UPDATE harness_attempts SET status='running',lease_owner='old-owner',lease_generation=3,
      lease_expires_at=NOW()-interval '1 minute',provider_session_id='thread-old',execution_transport='local-docker',
      local_container_naming='legacy-unsuffixed' WHERE id=$1`, [first.id]);
    const childId = randomUUID();
    const removed = [];
    let resumed = 0;
    const result = await reconcileExpiredKernelAttempt({
      db: pool, attemptId: first.id, leaseOwner: 'watchdog:fixture', reservedChildHop: 2,
      randomUUIDFn: () => childId, collectSnapshot: async () => snapshot(4),
      confirmCleanup: (parent) => confirmExpiredParentCleanup(parent, {
        env: { CECELIA_MACHINE_ID: machine },
        removeContainer: async (id) => { removed.push(id); return true; }, inspectContainer: async () => false,
      }),
      resumeAttempt: async (child, context) => {
        resumed++;
        expect(child).toMatchObject({ id: childId, retry_of_attempt_id: first.id, lease_owner: 'watchdog:fixture' });
        expect(context.parentAttempt).toMatchObject({ id: first.id, lease_owner: 'old-owner', lease_generation: 3 });
        expect(context.parentCleanupConfirmed).toBe(true);
        expect(removed).toEqual([`cecelia-harness-${first.id.replaceAll('-', '').slice(0, 8)}`]);
        return ok ? { ok: true } : false;
      },
    });
    expect(resumed).toBe(1);
    expect(result.ok).toBe(ok);
    expect((await pool.query('SELECT status,error_code,lease_generation FROM harness_attempts WHERE id=$1', [first.id])).rows)
      .toEqual([{ status: 'failed', error_code: 'resumed_as_child', lease_generation: 3 }]);
    expect((await pool.query('SELECT status,error_code FROM harness_attempts WHERE id=$1', [childId])).rows)
      .toEqual([{ status: ok ? 'starting' : 'failed', error_code: ok ? null : 'resume_returned_false' }]);
    const pending = (await pool.query('SELECT target_machine_id,status FROM harness_attempt_cleanup_outbox WHERE attempt_id=$1', [childId])).rows;
    expect(pending).toEqual(ok ? [] : [{ target_machine_id: machine, status: 'pending' }]);
    await expect(store.createAttempt(await input('reporter', 4))).rejects.toThrow('capacity_contended');
  });

  it('terminal-first并发保持真实425 trigger的23514拒绝，不被无效容量fixture提前截断', async () => {
    const first = await store.createAttempt(await input());
    const next = { ...await input(), runId: first.run_id, hop: 2, machineId: 'xian-mac-m4',
      capacitySnapshot: { ...snapshot(), machine: 'xian-mac-m4' } };
    const terminal = await pool.connect(); const creator = await pool.connect();
    const terminalPid = (await terminal.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const creatorPid = (await creator.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const waitsFor = async (pid, kind, event) => {
      for (let count = 0; count < 200; count++) {
        const row = (await pool.query('SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
        if (row?.wait_event_type === kind && (!event || row.wait_event === event)) return true;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return false;
    };
    let committed;
    try {
      await pool.query(`CREATE FUNCTION pause_weighted_cleanup() RETURNS TRIGGER AS $$
        BEGIN PERFORM pg_sleep(1); RETURN NEW; END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER pause_weighted_cleanup BEFORE INSERT ON harness_attempt_cleanup_outbox
        FOR EACH ROW EXECUTE FUNCTION pause_weighted_cleanup()`);
      await terminal.query('BEGIN');
      await terminal.query("UPDATE initiative_runs SET phase='failed' WHERE id=$1", [first.run_id]);
      committed = terminal.query('COMMIT');
      const reachedCleanup = await waitsFor(terminalPid, 'Timeout', 'PgSleep');
      await creator.query('BEGIN');
      const creation = createAttemptStore(creator, { transactionClient: true }).createAttempt(next)
        .then(() => null, (error) => error);
      const waited = await waitsFor(creatorPid, 'Lock');
      await committed;
      const error = await creation;
      await creator.query('ROLLBACK');
      expect(reachedCleanup).toBe(true); expect(waited).toBe(true);
      expect(error).toMatchObject({ code: '23514', message: `attempt_parent_run_terminal:${first.run_id}` });
      expect((await pool.query("SELECT id FROM harness_attempts WHERE run_id=$1 AND status IN ('queued','starting','running')", [first.run_id])).rows).toHaveLength(0);
    } finally {
      if (committed) await committed;
      await terminal.query('ROLLBACK'); await creator.query('ROLLBACK');
      terminal.release(); creator.release();
      await pool.query('DROP TRIGGER IF EXISTS pause_weighted_cleanup ON harness_attempt_cleanup_outbox; DROP FUNCTION IF EXISTS pause_weighted_cleanup()');
    }
  });

});
