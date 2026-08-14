// TDD Red (真 PostgreSQL) — 场景 C：expired attempt 一次事务终态化 + append-only evidence
// + replacement restart_reason lineage + 幂等。禁 mock DB 边：真 harness_attempts、真 migrate。
// 双模式 DB：注入 DB_URL → 直接用该库（Fleet attempt 空库，无需 createdb）；否则自建库（CI brain-integration）。
// 当前应 FAIL：expired fleet-worker attempt 尚未在 reconcileExpiredKernelAttempt 里终态化+建 lineage。
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';
import { reconcileExpiredKernelAttempt } from '../../harness-relay-watchdog.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const INJECTED_URL = process.env.DB_URL || null;

let adminPool;
let testPool;
let databaseName;

function migrateEnv(dbName, extra = {}) {
  return {
    ...process.env,
    NODE_ENV: 'test',
    DB_HOST: DB_DEFAULTS.host,
    DB_PORT: String(DB_DEFAULTS.port),
    DB_USER: DB_DEFAULTS.user,
    DB_PASSWORD: DB_DEFAULTS.password,
    DB_NAME: dbName,
    ...extra,
  };
}

function quotedIdentifier(value) {
  if (!/^kernel_instance_fencing_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

beforeAll(async () => {
  if (INJECTED_URL) {
    // Fleet 注入的 attempt 独享空库：直接迁移并使用，不 createdb。
    const u = new URL(INJECTED_URL);
    databaseName = decodeURIComponent(u.pathname.slice(1));
    execFileSync(process.execPath, ['src/migrate.js'], {
      cwd: BRAIN_ROOT,
      env: migrateEnv(databaseName, {
        DB_HOST: u.hostname || DB_DEFAULTS.host,
        DB_PORT: u.port || String(DB_DEFAULTS.port),
        DB_USER: decodeURIComponent(u.username || DB_DEFAULTS.user),
        DB_PASSWORD: decodeURIComponent(u.password || DB_DEFAULTS.password),
      }),
      stdio: 'pipe',
    });
    testPool = new Pool({ connectionString: INJECTED_URL, max: 4 });
  } else {
    databaseName = `kernel_instance_fencing_${process.pid}_${randomUUID().replaceAll('-', '')}`;
    adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
    await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
    execFileSync(process.execPath, ['src/migrate.js'], {
      cwd: BRAIN_ROOT,
      env: migrateEnv(databaseName),
      stdio: 'pipe',
    });
    testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 4 });
  }
}, 60_000);

afterAll(async () => {
  if (testPool) await testPool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`).catch(() => {});
    await adminPool.end();
  }
});

// 造一个 lease 已过期的 active fleet-worker attempt（含前置 task + v2 run）。
async function seedExpiredAttempt() {
  const taskId = randomUUID();
  const runId = randomUUID();
  const attemptId = randomUUID();
  await testPool.query(
    `INSERT INTO tasks (id, title, status) VALUES ($1, $2, 'in_progress')`,
    [taskId, `instance fencing quarantine ${taskId}`],
  );
  await testPool.query(
    `INSERT INTO initiative_runs (
       id, initiative_id, phase, current_task_id, orchestrator_version,
       created_source, record_trust_status
     ) VALUES ($1, $2, 'generate', $3, 'v2', 'kernel_dispatch', 'trusted')`,
    [runId, randomUUID(), taskId],
  );
  const store = createAttemptStore(testPool);
  await store.createAttempt({
    id: attemptId,
    runId,
    hop: 1,
    phase: 'generate',
    role: 'generator',
    provider: 'auto',
    bundle: { inputs: { execution_surface: 'fleet-worker' } },
    callbackSecretHash: 'c'.repeat(64),
    attemptKind: 'initial',
    workstreamKey: 'ws1',
  });
  await testPool.query(
    `UPDATE harness_attempts
        SET status = 'running',
            execution_transport = 'fleet-worker',
            lease_owner = 'stale-worker',
            lease_expires_at = NOW() - INTERVAL '10 minutes'
      WHERE id = $1`,
    [attemptId],
  );
  return { taskId, runId, attemptId, store };
}

function resumeMarksChildRunning(store) {
  return async (child) => {
    await store.markStarting(child.id, { leaseOwner: 'stale-worker', leaseSeconds: 300 }).catch(() => {});
    return { ok: true };
  };
}

describe('kernel instance-fencing quarantine closure on real PostgreSQL', () => {
  it('terminalizes the expired attempt to failed and records restart_reason lineage on the replacement', async () => {
    const { attemptId, store } = await seedExpiredAttempt();
    await reconcileExpiredKernelAttempt({
      db: testPool,
      attemptStore: store,
      attemptId,
      leaseOwner: 'stale-worker',
      resumeAttempt: resumeMarksChildRunning(store),
      reservedChildHop: 2,
    });
    const parent = await testPool.query(`SELECT status FROM harness_attempts WHERE id=$1`, [attemptId]);
    expect(parent.rows[0].status).toBe('failed');
    const lineage = await testPool.query(
      `SELECT child.restart_reason, child.attempt_kind, child.retry_of_attempt_id
         FROM harness_attempts child
         JOIN harness_attempts parent ON child.retry_of_attempt_id = parent.id
        WHERE parent.id = $1`,
      [attemptId],
    );
    expect(lineage.rows).toHaveLength(1);
    expect(lineage.rows[0].retry_of_attempt_id).toBe(attemptId);
    expect(lineage.rows[0].restart_reason).toBeTruthy();
    expect(lineage.rows[0].attempt_kind).toBe('resume');
  });

  it('is idempotent: a second reconcile creates no second replacement', async () => {
    const { attemptId, store } = await seedExpiredAttempt();
    const drive = () => reconcileExpiredKernelAttempt({
      db: testPool,
      attemptStore: store,
      attemptId,
      leaseOwner: 'stale-worker',
      resumeAttempt: resumeMarksChildRunning(store),
      reservedChildHop: 2,
    });
    await drive();
    const first = await testPool.query(
      `SELECT count(*)::int AS n FROM harness_attempts WHERE retry_of_attempt_id=$1`,
      [attemptId],
    );
    await drive();
    const second = await testPool.query(
      `SELECT count(*)::int AS n FROM harness_attempts WHERE retry_of_attempt_id=$1`,
      [attemptId],
    );
    expect(first.rows[0].n).toBe(1);
    expect(second.rows[0].n).toBe(1);
  });
});
