/**
 * [BEHAVIOR] Kernel CLI 在任何 task 业务状态推进前完成 Controller ownership CAS。
 *
 * 真实 seam：真 PostgreSQL + actual `node src/orchestrator/run.js` 子进程。
 * 禁止 mock pg / writeHeartbeat / activateQueuedKernelTask / runLoop。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { createKernelRun } from '../../orchestrator/kernel-run-store.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^kernel_cli_owner_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function createIsolatedDatabase() {
  databaseName = `kernel_cli_owner_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({
    ...DB_DEFAULTS,
    database: 'postgres',
    max: 1,
    statement_timeout: 10_000,
  });
  await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
  execFileSync(process.execPath, ['src/migrate.js'], {
    cwd: BRAIN_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: DB_DEFAULTS.host,
      DB_PORT: String(DB_DEFAULTS.port),
      DB_USER: DB_DEFAULTS.user,
      DB_PASSWORD: DB_DEFAULTS.password,
      DB_NAME: databaseName,
    },
    stdio: 'pipe',
  });
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 5 });
}

async function dropIsolatedDatabase() {
  if (testPool) await testPool.end().catch(() => {});
  if (adminPool && databaseName) {
    await adminPool.query(
      'UPDATE pg_database SET datallowconn=false WHERE datname=$1',
      [databaseName],
    ).catch(() => {});
    await adminPool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    ).catch(() => {});
    await adminPool.query(
      `DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`,
    ).catch(() => {});
  }
  if (adminPool) await adminPool.end().catch(() => {});
}

async function seedQueuedRun() {
  const taskId = randomUUID();
  const initiativeId = randomUUID();
  const controllerSessionId = randomUUID();
  await testPool.query(
    `INSERT INTO tasks (id, title, status, priority, task_type, trigger_source, payload)
     VALUES ($1, $2, 'queued', 'P2', 'harness_initiative', 'api', $3::jsonb)`,
    [
      taskId,
      `kernel-cli-owner-${taskId}`,
      JSON.stringify({ initiative_id: initiativeId }),
    ],
  );
  const created = await createKernelRun(testPool, {
    taskId,
    initiativeId,
    phase: 'planning',
    journeyId: null,
    abilityId: null,
    host: 'kernel-cli-test',
    deadlineHours: 8,
    createdSource: 'kernel_dispatch',
    controllerSessionId,
  });
  return {
    taskId,
    runId: created.run.id,
    controllerSessionId,
    initialLease: created.run.controller_lease_expires_at,
  };
}

function runActualCli({ taskId, runId, controllerSessionId }) {
  return spawnSync(process.execPath, [
    'src/orchestrator/run.js',
    '--task-id', taskId,
    '--run-id', runId,
    '--controller-session-id', controllerSessionId,
    // 正确 owner 用无对应请求的 resume token 确定性结束，不进入 provider 派发。
    '--resume-token', `no-request-${randomUUID()}`,
  ], {
    cwd: BRAIN_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: DB_DEFAULTS.host,
      DB_PORT: String(DB_DEFAULTS.port),
      DB_USER: DB_DEFAULTS.user,
      DB_PASSWORD: DB_DEFAULTS.password,
      DB_NAME: databaseName,
    },
    encoding: 'utf8',
    timeout: 15_000,
  });
}

async function readOracle({ taskId, runId }) {
  const { rows } = await testPool.query(
    `SELECT t.status AS task_status,
            t.started_at,
            r.phase,
            r.failure_reason,
            r.controller_session_id,
            r.controller_lease_expires_at,
            r.orchestrator_heartbeat_at,
            (SELECT count(*)::int FROM orchestrator_decision_log d WHERE d.run_id = r.id) AS decision_count,
            (SELECT count(*)::int FROM harness_attempts a WHERE a.run_id = r.id) AS attempt_count
       FROM tasks t
       JOIN initiative_runs r ON r.current_task_id = t.id
      WHERE t.id = $1 AND r.id = $2`,
    [taskId, runId],
  );
  return rows[0];
}

beforeAll(createIsolatedDatabase, 60_000);
afterAll(dropIsolatedDatabase, 30_000);

describe('Kernel CLI ownership pre-action fence（真 PG）', () => {
  it('wrong session: exit 2/controller_lease_lost 且 queued task 零业务推进', async () => {
    const seeded = await seedQueuedRun();
    const before = await readOracle(seeded);
    const cli = runActualCli({
      ...seeded,
      controllerSessionId: 'forged-wrong-session',
    });
    const after = await readOracle(seeded);

    expect(cli.status).toBe(2);
    expect(cli.stdout).toContain('controller_lease_lost');
    expect(before.task_status).toBe('queued');
    expect(after.task_status).toBe('queued');
    expect(after.started_at).toBeNull();
    expect(after.phase).toBe('planning');
    expect(after.failure_reason).toBeNull();
    expect(after.controller_session_id).toBe(seeded.controllerSessionId);
    expect(after.controller_lease_expires_at.toISOString())
      .toBe(new Date(seeded.initialLease).toISOString());
    expect(after.orchestrator_heartbeat_at).toBeNull();
    expect(after.decision_count).toBe(0);
    expect(after.attempt_count).toBe(0);
  });

  it('correct session: CLI 通过 owner fence 后仍把 queued task 激活为 in_progress', async () => {
    const seeded = await seedQueuedRun();
    const cli = runActualCli(seeded);
    const after = await readOracle(seeded);

    expect(cli.status).toBe(0);
    expect(cli.stdout).toContain('context_resume_claim_lost');
    expect(after.task_status).toBe('in_progress');
    expect(after.started_at).not.toBeNull();
    expect(after.phase).toBe('planning');
    expect(after.orchestrator_heartbeat_at).not.toBeNull();
    expect(after.decision_count).toBe(0);
    expect(after.attempt_count).toBe(0);
  });
});
