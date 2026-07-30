import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reconcileRunTrust } from '../../../scripts/kernel-run-trust-reconcile.mjs';
import { DB_DEFAULTS } from '../../db-config.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let adminPool;
let testPool;
let databaseName;
let auditDirectory;

function quotedIdentifier(value) {
  if (!/^kernel_trust_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

beforeAll(async () => {
  databaseName = `kernel_trust_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 4 });
  auditDirectory = await mkdtemp(join(tmpdir(), 'kernel-trust-pg-'));
}, 30_000);

afterAll(async () => {
  if (testPool) await testPool.end();
  if (adminPool && databaseName) {
    await adminPool.query(
      `DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)} WITH (FORCE)`,
    );
  }
  if (adminPool) await adminPool.end();
  if (auditDirectory) await rm(auditDirectory, { recursive: true, force: true });
}, 30_000);

describe('kernel trust reconciliation on real PostgreSQL', () => {
  it('mutates only reviewed historical candidates and converges to zero changes', async () => {
    const cutoff = new Date(Date.now() - 60_000);
    await testPool.query(
      `UPDATE schema_version SET applied_at = $1 WHERE version = '376'`,
      [cutoff],
    );

    const historicalTaskId = randomUUID();
    const historicalRunId = randomUUID();
    const activeRunId = randomUUID();
    const postCutoverRunId = randomUUID();
    const nativeTrustedRunId = randomUUID();
    await testPool.query(
      `INSERT INTO tasks (id, title, status)
       VALUES ($1, 'historical trust evidence', 'completed')`,
      [historicalTaskId],
    );
    const historicalStartedAt = new Date(cutoff.getTime() - 60_000);
    const postCutoverStartedAt = new Date(cutoff.getTime() + 1_000);
    await testPool.query(
       `INSERT INTO initiative_runs (
         id, initiative_id, phase, current_task_id, orchestrator_version,
         created_source, started_at, completed_at,
         record_trust_status, record_trust_reason
       ) VALUES
         ($1, $5, 'done', $6, 'v2', 'historical_reconstruction', $7, $8, 'untrusted', NULL),
         ($2, $5, 'generate', $6, 'v2', 'historical_reconstruction', $7, NULL, 'untrusted', NULL),
         ($3, $5, 'failed', $6, 'v2', 'historical_reconstruction', $9, $8, 'untrusted', NULL),
         ($4, $5, 'done', $6, 'v2', 'kernel_dispatch', $7, $8, 'trusted', 'native_writer')`,
      [
        historicalRunId,
        activeRunId,
        postCutoverRunId,
        nativeTrustedRunId,
        randomUUID(),
        historicalTaskId,
        historicalStartedAt,
        cutoff,
        postCutoverStartedAt,
      ],
    );

    const before = await testPool.query(
      `SELECT id, phase, record_trust_status, record_trust_reason
         FROM initiative_runs
        WHERE id = ANY($1::uuid[])
        ORDER BY id`,
      [[historicalRunId, activeRunId, postCutoverRunId, nativeTrustedRunId]],
    );
    const dry = await reconcileRunTrust({
      db: testPool,
      productionGuards: true,
      writeLine: () => {},
    });
    expect(dry).toMatchObject({
      database: databaseName,
      proposed: 1,
      would_change: 1,
    });

    const auditOutput = join(auditDirectory, 'trust-reconcile.jsonl');
    const applied = await reconcileRunTrust({
      db: testPool,
      apply: true,
      auditOutput,
      expectedPlanSha256: dry.plan_sha256,
      expectedProposed: dry.proposed,
      confirmDatabase: databaseName,
      productionGuards: true,
      failOnConflict: true,
      batchSize: 50,
      writeLine: () => {},
    });
    expect(applied).toMatchObject({
      applied: 1,
      unchanged: 0,
      conflicts: 0,
      would_change: 1,
    });

    const after = await testPool.query(
      `SELECT id, phase, record_trust_status, record_trust_reason
         FROM initiative_runs
        WHERE id = ANY($1::uuid[])
        ORDER BY id`,
      [[historicalRunId, activeRunId, postCutoverRunId, nativeTrustedRunId]],
    );
    const beforeById = Object.fromEntries(before.rows.map(row => [row.id, row]));
    const afterById = Object.fromEntries(after.rows.map(row => [row.id, row]));
    expect(afterById[historicalRunId]).toMatchObject({
      record_trust_status: 'reconstructed',
      record_trust_reason: 'direct_task_reference',
    });
    for (const untouchedId of [activeRunId, postCutoverRunId, nativeTrustedRunId]) {
      expect(afterById[untouchedId]).toEqual(beforeById[untouchedId]);
    }

    const secondDry = await reconcileRunTrust({
      db: testPool,
      productionGuards: true,
      writeLine: () => {},
    });
    expect(secondDry).toMatchObject({
      proposed: 1,
      would_change: 0,
    });
    expect((await stat(auditOutput)).mode & 0o777).toBe(0o400);
    const audit = await readFile(auditOutput, 'utf8');
    expect(audit).toContain('"outcome":"batch_committed"');
    expect(audit).toContain('"outcome":"completed"');
  });

  it('rolls back when classification evidence changes after plan review', async () => {
    const cutoffResult = await testPool.query(
      `SELECT applied_at FROM schema_version WHERE version = '376'`,
    );
    const cutoff = new Date(cutoffResult.rows[0].applied_at);
    const taskId = randomUUID();
    const runId = randomUUID();
    await testPool.query(
      `INSERT INTO tasks (id, title, status)
       VALUES ($1, 'trust evidence drift', 'completed')`,
      [taskId],
    );
    await testPool.query(
      `INSERT INTO initiative_runs (
         id, initiative_id, phase, current_task_id, orchestrator_version,
         created_source, started_at, completed_at,
         record_trust_status, record_trust_reason
       ) VALUES (
         $1, $2, 'done', $3, 'v2', 'historical_reconstruction',
         $4, $5, 'untrusted', NULL
       )`,
      [
        runId,
        randomUUID(),
        taskId,
        new Date(cutoff.getTime() - 120_000),
        new Date(cutoff.getTime() - 60_000),
      ],
    );

    const dry = await reconcileRunTrust({
      db: testPool,
      productionGuards: true,
      writeLine: () => {},
    });
    let inserted = false;
    const appendAudit = async (_path, content) => {
      if (!inserted && content.includes('"outcome":"started"')) {
        inserted = true;
        await testPool.query(
          `INSERT INTO harness_attempts (
             id, run_id, hop, phase, role, provider,
             task_bundle, callback_secret_hash
           ) VALUES
             ($1, $3, 1, 'generate', 'generator', 'auto', '{}'::jsonb, 'x'),
             ($2, $3, 2, 'generate', 'generator', 'auto', '{}'::jsonb, 'y')`,
          [randomUUID(), randomUUID(), runId],
        );
      }
    };

    await expect(reconcileRunTrust({
      db: testPool,
      apply: true,
      auditOutput: '/tmp/kernel-trust-evidence-drift.jsonl',
      expectedPlanSha256: dry.plan_sha256,
      expectedProposed: dry.proposed,
      confirmDatabase: databaseName,
      productionGuards: true,
      failOnConflict: true,
      batchSize: 500,
      appendAudit,
      writeLine: () => {},
    })).rejects.toThrow(/evidence.*changed|optimistic conflict/);

    const state = await testPool.query(
      `SELECT record_trust_status, record_trust_reason
         FROM initiative_runs
        WHERE id = $1`,
      [runId],
    );
    expect(state.rows).toEqual([{
      record_trust_status: 'untrusted',
      record_trust_reason: null,
    }]);
  });

  it('uses advisory-task-run lock order without deadlocking a terminal writer', async () => {
    const cutoffResult = await testPool.query(
      `SELECT applied_at FROM schema_version WHERE version = '376'`,
    );
    const cutoff = new Date(cutoffResult.rows[0].applied_at);
    const taskId = randomUUID();
    const runId = randomUUID();
    await testPool.query(
      `INSERT INTO tasks (id, title, status)
       VALUES ($1, 'trust lock order', 'in_progress')`,
      [taskId],
    );
    await testPool.query(
      `INSERT INTO initiative_runs (
         id, initiative_id, phase, current_task_id, orchestrator_version,
         created_source, started_at, completed_at,
         record_trust_status, record_trust_reason
       ) VALUES (
         $1, $2, 'failed', $3, 'v2', 'historical_reconstruction',
         $4, $5, 'untrusted', NULL
       )`,
      [
        runId,
        randomUUID(),
        taskId,
        new Date(cutoff.getTime() - 120_000),
        new Date(cutoff.getTime() - 60_000),
      ],
    );
    const dry = await reconcileRunTrust({
      db: testPool,
      productionGuards: true,
      writeLine: () => {},
    });

    let terminalWriter = null;
    let writerClient = null;
    let started = false;
    const appendAudit = async (_path, content) => {
      if (started || !content.includes('"outcome":"started"')) return;
      started = true;
      writerClient = await testPool.connect();
      await writerClient.query('BEGIN');
      await writerClient.query(
        `SELECT id FROM tasks WHERE id = $1 FOR UPDATE`,
        [taskId],
      );
      terminalWriter = new Promise((resolve) => setTimeout(resolve, 50))
        .then(() => writerClient.query(
          `SELECT id FROM initiative_runs WHERE id = $1 FOR UPDATE`,
          [runId],
        ))
        .then(() => writerClient.query('COMMIT'))
        .finally(() => writerClient.release());
    };

    const applying = reconcileRunTrust({
      db: testPool,
      apply: true,
      auditOutput: '/tmp/kernel-trust-lock-order.jsonl',
      expectedPlanSha256: dry.plan_sha256,
      expectedProposed: dry.proposed,
      confirmDatabase: databaseName,
      productionGuards: true,
      failOnConflict: true,
      batchSize: 500,
      appendAudit,
      writeLine: () => {},
    });
    const applyResult = await Promise.allSettled([
      applying,
      new Promise((resolve) => setTimeout(resolve, 100))
        .then(() => terminalWriter),
    ]);

    for (const result of applyResult) {
      if (result.status === 'rejected') {
        expect(result.reason?.code).not.toBe('40P01');
      }
    }
    expect(applyResult[0].status).toBe('fulfilled');
    expect(applyResult[1].status).toBe('fulfilled');
  });
});
