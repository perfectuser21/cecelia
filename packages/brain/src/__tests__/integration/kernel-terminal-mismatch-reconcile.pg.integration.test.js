import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reconcileTerminalMismatches } from '../../../scripts/kernel-terminal-mismatch-reconcile.mjs';
import { DB_DEFAULTS } from '../../db-config.js';
import { finalizeKernelRun } from '../../orchestrator/kernel-run-store.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let adminPool;
let testPool;
let databaseName;
let auditDirectory;

function quotedIdentifier(value) {
  if (!/^kernel_terminal_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

beforeAll(async () => {
  databaseName = `kernel_terminal_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
  auditDirectory = await mkdtemp(join(tmpdir(), 'kernel-terminal-pg-'));
}, 30_000);

afterAll(async () => {
  if (testPool) await testPool.end();
  if (adminPool && databaseName) {
    // Pool#end() can resolve while PostgreSQL is still removing the final
    // server-side session. FORCE races that shutdown and surfaces an
    // unhandled 57P01 after otherwise-passing tests.
    let remainingSessions = 0;
    for (let attempt = 0; attempt < 250; attempt += 1) {
      const result = await adminPool.query(
        'SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1',
        [databaseName],
      );
      remainingSessions = result.rows[0].count;
      if (remainingSessions === 0) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (remainingSessions !== 0) {
      throw new Error(
        `isolated test database still has ${remainingSessions} session(s): ${databaseName}`,
      );
    }
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
  if (auditDirectory) await rm(auditDirectory, { recursive: true, force: true });
}, 30_000);

describe('kernel terminal mismatch reconciliation on real PostgreSQL', () => {
  it('verifies the exact run/task repair and converges to no findings', async () => {
    const taskId = randomUUID();
    const runId = randomUUID();
    await testPool.query(
      `INSERT INTO tasks (id, title, status)
       VALUES ($1, 'terminal mismatch evidence', 'queued')`,
      [taskId],
    );
    await testPool.query(
      `INSERT INTO initiative_runs (
         id, initiative_id, phase, current_task_id, orchestrator_version,
         created_source, started_at, completed_at, failure_reason,
         record_trust_status
       ) VALUES (
         $1, $2, 'failed', $3, 'v2', 'kernel_dispatch',
         NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '1 minute',
         'orphan_guard_exhausted', 'trusted'
       )`,
      [runId, randomUUID(), taskId],
    );

    const dry = await reconcileTerminalMismatches({
      db: testPool,
      productionGuards: true,
      writeLine: () => {},
    });
    expect(dry).toMatchObject({
      database: databaseName,
      proposed: 1,
      blocked: 0,
    });

    const auditOutput = join(auditDirectory, 'terminal-reconcile.jsonl');
    const applied = await reconcileTerminalMismatches({
      db: testPool,
      apply: true,
      auditOutput,
      expectedPlanSha256: dry.plan_sha256,
      expectedProposed: dry.proposed,
      confirmDatabase: databaseName,
      productionGuards: true,
      writeLine: () => {},
    });
    expect(applied).toMatchObject({
      proposed: 1,
      applied: 1,
      verified: 1,
      blocked: 0,
    });

    const state = await testPool.query(
      `SELECT t.status AS task_status, r.phase AS run_phase,
              r.current_task_id
         FROM tasks t
         JOIN initiative_runs r ON r.current_task_id = t.id
        WHERE t.id = $1 AND r.id = $2`,
      [taskId, runId],
    );
    expect(state.rows).toEqual([{
      task_status: 'failed',
      run_phase: 'failed',
      current_task_id: taskId,
    }]);
    const secondDry = await reconcileTerminalMismatches({
      db: testPool,
      productionGuards: true,
      writeLine: () => {},
    });
    expect(secondDry).toMatchObject({ proposed: 0, blocked: 0 });

    expect((await stat(auditOutput)).mode & 0o777).toBe(0o400);
    const audit = await readFile(auditOutput, 'utf8');
    expect(audit).toContain('"commit_state":"verified"');
    expect(audit).toContain('"outcome":"completed"');
  });

  it('does not propose an old terminal run while a sibling run is active', async () => {
    const taskId = randomUUID();
    const oldRunId = randomUUID();
    const activeRunId = randomUUID();
    await testPool.query(
      `INSERT INTO tasks (id, title, status)
       VALUES ($1, 'active sibling evidence', 'in_progress')`,
      [taskId],
    );
    await testPool.query(
      `INSERT INTO initiative_runs (
         id, initiative_id, phase, current_task_id, orchestrator_version,
         created_source, started_at, completed_at, failure_reason,
         record_trust_status
       ) VALUES
         ($1, $3, 'failed', $4, 'v2', 'explicit_recovery',
          NOW() - INTERVAL '3 minutes', NOW() - INTERVAL '2 minutes',
          'old_attempt_failed', 'trusted'),
         ($2, $3, 'generate', $4, 'v2', 'explicit_recovery',
          NOW() - INTERVAL '1 minute', NULL, NULL, 'trusted')`,
      [oldRunId, activeRunId, randomUUID(), taskId],
    );

    const dry = await reconcileTerminalMismatches({
      db: testPool,
      productionGuards: true,
      writeLine: () => {},
    });
    expect(dry).toMatchObject({ proposed: 0, blocked: 0 });
  });

  it('rechecks active siblings under the task lock before terminal repair', async () => {
    const taskId = randomUUID();
    const oldRunId = randomUUID();
    const activeRunId = randomUUID();
    await testPool.query(
      `INSERT INTO tasks (id, title, status)
       VALUES ($1, 'active sibling race fence', 'in_progress')`,
      [taskId],
    );
    await testPool.query(
      `INSERT INTO initiative_runs (
         id, initiative_id, phase, current_task_id, orchestrator_version,
         created_source, started_at, completed_at, failure_reason,
         record_trust_status
       ) VALUES
         ($1, $3, 'failed', $4, 'v2', 'explicit_recovery',
          NOW() - INTERVAL '3 minutes', NOW() - INTERVAL '2 minutes',
          'old_attempt_failed', 'trusted'),
         ($2, $3, 'generate', $4, 'v2', 'explicit_recovery',
          NOW() - INTERVAL '1 minute', NULL, NULL, 'trusted')`,
      [oldRunId, activeRunId, randomUUID(), taskId],
    );

    await expect(finalizeKernelRun(testPool, {
      runId: oldRunId,
      expectedTaskId: taskId,
      expectedTaskStatus: 'in_progress',
      requireNoActiveSibling: true,
      outcome: 'failed',
      reason: 'old_attempt_failed',
    })).rejects.toThrow(/active sibling/);

    const state = await testPool.query(
      `SELECT t.status AS task_status, active.phase AS active_phase
         FROM tasks t
         JOIN initiative_runs active ON active.current_task_id = t.id
        WHERE t.id = $1 AND active.id = $2`,
      [taskId, activeRunId],
    );
    expect(state.rows).toEqual([{
      task_status: 'in_progress',
      active_phase: 'generate',
    }]);
  });
});
