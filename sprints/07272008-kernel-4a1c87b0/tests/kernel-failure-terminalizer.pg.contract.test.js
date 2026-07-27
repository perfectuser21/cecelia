import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DB_DEFAULTS } from '../../../packages/brain/src/db-config.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../packages/brain/', import.meta.url));

let adminPool;
let testPool;
let databaseName;
let routerPool;
let tasksRouter;

function quotedIdentifier(value) {
  if (!/^kernel_terminalizer_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function createIsolatedDatabase() {
  databaseName = `kernel_terminalizer_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
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
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 8 });
  process.env.NODE_ENV = 'test';
  process.env.DB_HOST = DB_DEFAULTS.host;
  process.env.DB_PORT = String(DB_DEFAULTS.port);
  process.env.DB_USER = DB_DEFAULTS.user;
  process.env.DB_PASSWORD = DB_DEFAULTS.password;
  process.env.DB_NAME = databaseName;
}

async function dropIsolatedDatabase() {
  if (routerPool) await routerPool.end?.().catch(() => {});
  if (testPool) await testPool.end().catch(() => {});
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)} WITH (FORCE)`);
  }
  if (adminPool) await adminPool.end().catch(() => {});
}

async function seedKernelRun({
  taskStatus = 'in_progress',
  retryCount = 0,
  currentTaskMatches = true,
} = {}) {
  const initiativeId = randomUUID();
  const taskId = randomUUID();
  const runId = randomUUID();
  const otherTaskId = randomUUID();
  await testPool.query(
    `INSERT INTO tasks
       (id, title, status, priority, task_type, trigger_source, payload,
        retry_count, claimed_by, claimed_at, started_at, status_history)
     VALUES
       ($1, $2, $3, 'P1', 'harness_initiative', 'api', '{}'::jsonb,
        $4, 'kernel:test', NOW(), NOW(), '[]'::jsonb),
       ($5, $6, 'queued', 'P2', 'harness_initiative', 'api', '{}'::jsonb,
        0, NULL, NULL, NULL, '[]'::jsonb)`,
    [taskId, `kernel-task-${taskId}`, taskStatus, retryCount, otherTaskId, `other-task-${otherTaskId}`],
  );
  await testPool.query(
    `INSERT INTO initiative_runs
       (id, initiative_id, phase, current_task_id, orchestrator_version, started_at, deadline_at)
     VALUES ($1, $2, 'generate', $3, 'v2', NOW(), NOW() + INTERVAL '30 minutes')`,
    [runId, initiativeId, currentTaskMatches ? taskId : otherTaskId],
  );
  return { initiativeId, runId, taskId, otherTaskId };
}

beforeAll(async () => {
  await createIsolatedDatabase();
  vi.resetModules();
  vi.doMock('../../../packages/brain/src/event-bus.js', () => ({
    emit: vi.fn(async () => undefined),
  }));
  vi.doMock('../../../packages/brain/src/capture-inbox.js', () => ({
    pushCaptureAtom: vi.fn(async () => undefined),
  }));
  vi.doMock('../../../packages/brain/src/anchor-check.js', () => ({
    checkAnchor: vi.fn(async () => ({ ok: true })),
  }));
  vi.doMock('../../../packages/brain/src/task-updater.js', () => ({
    blockTask: vi.fn(async () => undefined),
  }));
  const dbMod = await import('../../../packages/brain/src/db.js');
  routerPool = dbMod.default;
  const routerMod = await import('../../../packages/brain/src/routes/tasks.js');
  tasksRouter = routerMod.default;
}, 30_000);

afterAll(async () => {
  await dropIsolatedDatabase();
}, 30_000);

describe('Kernel failure terminalizer PG contract', () => {
  it('hard failure 原子终结 run task history claim 并保持幂等', async () => {
    const mod = await import('../../../packages/brain/src/orchestrator/failure-terminalizer.js');
    expect(typeof mod.failureTerminalizer).toBe('function');

    const seeded = await seedKernelRun();
    await mod.failureTerminalizer({
      pool: testPool,
      runId: seeded.runId,
      taskId: seeded.taskId,
      reason: 'ci_timeout',
      failureClass: 'contract_invalid',
    });
    await mod.failureTerminalizer({
      pool: testPool,
      runId: seeded.runId,
      taskId: seeded.taskId,
      reason: 'ci_timeout',
      failureClass: 'contract_invalid',
    });

    const runRes = await testPool.query(
      `SELECT phase, failure_reason, completed_at
         FROM initiative_runs
        WHERE id = $1`,
      [seeded.runId],
    );
    expect(runRes.rows[0]).toMatchObject({
      phase: 'failed',
      failure_reason: 'ci_timeout',
    });
    expect(runRes.rows[0].completed_at).not.toBeNull();

    const taskRes = await testPool.query(
      `SELECT status, completed_at, claimed_by, claimed_at, retry_count,
              jsonb_array_length(status_history) AS history_len
         FROM tasks
        WHERE id = $1`,
      [seeded.taskId],
    );
    expect(taskRes.rows[0].status).toBe('failed');
    expect(taskRes.rows[0].completed_at).not.toBeNull();
    expect(taskRes.rows[0].claimed_by).toBeNull();
    expect(taskRes.rows[0].claimed_at).toBeNull();
    expect(Number(taskRes.rows[0].history_len)).toBe(1);

    const skipped = await seedKernelRun({ currentTaskMatches: false });
    await mod.failureTerminalizer({
      pool: testPool,
      runId: skipped.runId,
      taskId: skipped.taskId,
      reason: 'blocked_same_state',
      failureClass: 'contract_invalid',
    });
    const skippedTask = await testPool.query(
      `SELECT status, completed_at, claimed_by
         FROM tasks
        WHERE id = $1`,
      [skipped.taskId],
    );
    expect(skippedTask.rows[0]).toMatchObject({
      status: 'in_progress',
      completed_at: null,
      claimed_by: 'kernel:test',
    });
  }, 30_000);

  it('slot allocator 继续以 task status 为 SSOT 且 failed API 补 completed_at', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/brain', tasksRouter);

    const seeded = await seedKernelRun();
    const res = await request(app)
      .patch(`/api/brain/tasks/${seeded.taskId}`)
      .send({ status: 'failed', error: 'kernel fatal' });

    expect(res.status).toBe(200);
    const taskRes = await testPool.query(
      `SELECT status, completed_at, claimed_by, claimed_at
         FROM tasks
        WHERE id = $1`,
      [seeded.taskId],
    );
    expect(taskRes.rows[0]).toMatchObject({
      status: 'failed',
      claimed_by: null,
      claimed_at: null,
    });
    expect(taskRes.rows[0].completed_at).not.toBeNull();

    const slotSource = await import('node:fs').then((fs) =>
      fs.readFileSync('packages/brain/src/slot-allocator.js', 'utf8'),
    );
    expect(slotSource).toContain("t.status = 'in_progress'");
  }, 30_000);
});
