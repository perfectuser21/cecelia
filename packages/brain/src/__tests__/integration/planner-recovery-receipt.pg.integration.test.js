import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { persistPlannerRecoveryReceipt } from '../../orchestrator/planner-recovery-receipt-store.js';
import {
  DIRECT_INSERT_SQL,
  receiptInsertValues,
  seedPlannerRecoveryCallback,
} from './helpers/planner-recovery-receipt-fixture.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let adminPool;
let pool;
let databaseName;
let upSql;
let downSql;
let consumptionUpSql;
let consumptionDownSql;
let runBindingUpSql;
let runBindingDownSql;

function quoteIdentifier(value) {
  if (!/^planner_recovery_[a-z0-9_]+$/.test(value)) throw new Error('unsafe database name');
  return `"${value}"`;
}

beforeAll(async () => {
  databaseName = `planner_recovery_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
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
  pool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 8 });
  upSql = await readFile(
    new URL('../../../migrations/428_planner_recovery_receipts.sql', import.meta.url),
    'utf8',
  );
  downSql = await readFile(
    new URL('../../../migrations/rollback/428_planner_recovery_receipts.down.sql', import.meta.url),
    'utf8',
  );
  consumptionUpSql = await readFile(
    new URL('../../../migrations/429_planner_recovery_consumptions.sql', import.meta.url),
    'utf8',
  );
  consumptionDownSql = await readFile(
    new URL('../../../migrations/rollback/429_planner_recovery_consumptions.down.sql', import.meta.url),
    'utf8',
  );
  runBindingUpSql = await readFile(
    new URL('../../../migrations/430_planner_recovery_run_binding.sql', import.meta.url),
    'utf8',
  );
  runBindingDownSql = await readFile(
    new URL('../../../migrations/rollback/430_planner_recovery_run_binding.down.sql', import.meta.url),
    'utf8',
  );
  await pool.query(runBindingDownSql);
  await pool.query(runBindingDownSql);
  await pool.query(consumptionDownSql);
  await pool.query(consumptionDownSql);
  await pool.query(downSql);
  await pool.query(downSql);
  await pool.query(upSql);
  await pool.query(upSql);
  await pool.query(consumptionUpSql);
  await pool.query(consumptionUpSql);
  await pool.query(runBindingUpSql);
  await pool.query(runBindingUpSql);
}, 60_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

describe.sequential('planner recovery receipt PostgreSQL authority', () => {
  it('locks the ledger before rollback checks emptiness so a concurrent insert is preserved', async () => {
    const fixture = await seedPlannerRecoveryCallback(pool);
    await fixture.callback(async () => {});
    const insertClient = await pool.connect();
    const rollbackClient = await pool.connect();
    const rollbackPid = await rollbackClient.query('SELECT pg_backend_pid() AS pid');
    let rollbackError;
    try {
      await insertClient.query('BEGIN');
      await insertClient.query(DIRECT_INSERT_SQL, receiptInsertValues(fixture));
      const rollbackPromise = rollbackClient.query(downSql).catch((error) => {
        rollbackError = error;
      });

      for (let poll = 0; poll < 100; poll += 1) {
        const waiting = await pool.query(
          `SELECT EXISTS(
             SELECT 1 FROM pg_locks
              WHERE pid=$1
                AND relation='planner_recovery_receipts'::regclass
                AND mode='AccessExclusiveLock'
                AND NOT granted
           ) AS waiting`,
          [rollbackPid.rows[0].pid],
        );
        if (waiting.rows[0].waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      await insertClient.query('COMMIT');
      await rollbackPromise;
      if (rollbackError) await rollbackClient.query('ROLLBACK');
      else await pool.query(upSql);
    } finally {
      await insertClient.query('ROLLBACK').catch(() => {});
      await rollbackClient.query('ROLLBACK').catch(() => {});
      insertClient.release();
      rollbackClient.release();
    }

    expect(rollbackError).toMatchObject({ code: '23514' });
    const preserved = await pool.query(
      'SELECT COUNT(*)::int AS count FROM planner_recovery_receipts WHERE planner_attempt_id=$1',
      [fixture.attemptId],
    );
    expect(preserved.rows[0].count).toBe(1);
  });

  it('persists exactly one receipt for concurrent exact callbacks', async () => {
    const fixture = await seedPlannerRecoveryCallback(pool);
    const outcomes = await Promise.all([fixture.callback(), fixture.callback()]);

    expect(outcomes.filter((outcome) => outcome.deduped)).toHaveLength(1);
    const rows = await pool.query(
      'SELECT * FROM planner_recovery_receipts WHERE planner_attempt_id=$1',
      [fixture.attemptId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      predecessor_run_id: fixture.runId,
      source_task_id: fixture.taskId,
      content: fixture.exactEvidence.content,
    });
  });

  it('rolls back Attempt terminal state, decision receipt, and blob receipt on writer failure', async () => {
    const fixture = await seedPlannerRecoveryCallback(pool);
    await expect(fixture.callback(async (client, hook) => {
      await persistPlannerRecoveryReceipt(client, {
        terminalAttempt: hook.attempt,
        result: hook.result,
        exactEvidence: fixture.exactEvidence,
      });
      throw new Error('injected receipt writer failure');
    })).rejects.toThrow('injected receipt writer failure');

    const attempt = await pool.query('SELECT status,result FROM harness_attempts WHERE id=$1', [fixture.attemptId]);
    const decisions = await pool.query(
      "SELECT COUNT(*)::int AS count FROM orchestrator_decision_log WHERE run_id=$1 AND action='verdict:attempt_callback'",
      [fixture.runId],
    );
    const receipts = await pool.query(
      'SELECT COUNT(*)::int AS count FROM planner_recovery_receipts WHERE planner_attempt_id=$1',
      [fixture.attemptId],
    );
    expect(attempt.rows[0]).toMatchObject({ status: 'running', result: null });
    expect(decisions.rows[0].count).toBe(0);
    expect(receipts.rows[0].count).toBe(0);
  });

  it.each([
    ['wrong run', { predecessorRunId: randomUUID() }],
    ['wrong task', { sourceTaskId: randomUUID() }],
    ['wrong lease', { leaseGeneration: 4 }],
  ])('rejects direct SQL with %s', async (_label, overrides) => {
    const fixture = await seedPlannerRecoveryCallback(pool);
    await fixture.callback(async () => {});
    await expect(pool.query(DIRECT_INSERT_SQL, receiptInsertValues(fixture, {
      ...overrides,
    }))).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects direct SQL whose persisted Attempt result does not match the receipt', async () => {
    const fixture = await seedPlannerRecoveryCallback(pool);
    await fixture.callback(async () => {});
    await pool.query(
      `UPDATE harness_attempts
          SET result=jsonb_set(result,'{server_verification,planner_recovery_receipt,head_sha}',to_jsonb($2::text))
        WHERE id=$1`,
      [fixture.attemptId, 'c'.repeat(40)],
    );
    await expect(pool.query(
      DIRECT_INSERT_SQL,
      receiptInsertValues(fixture),
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects direct SQL when Attempt status and result status disagree', async () => {
    const fixture = await seedPlannerRecoveryCallback(pool);
    await fixture.callback(async () => {});
    await pool.query(
      "UPDATE harness_attempts SET result=jsonb_set(result,'{status}',to_jsonb('failed'::text)) WHERE id=$1",
      [fixture.attemptId],
    );

    await expect(pool.query(
      DIRECT_INSERT_SQL,
      receiptInsertValues(fixture),
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects direct SQL whose planner branch contains a slash', async () => {
    const fixture = await seedPlannerRecoveryCallback(pool);
    await fixture.callback(async () => {});
    const slashBranch = 'cp-harness/prd';
    await pool.query(
      "UPDATE harness_attempts SET task_bundle=jsonb_set(task_bundle,'{inputs,planner_branch}',to_jsonb($2::text)) WHERE id=$1",
      [fixture.attemptId, slashBranch],
    );

    await expect(pool.query(
      DIRECT_INSERT_SQL,
      receiptInsertValues(fixture).map((value, index) => index === 9 ? slashBranch : value),
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects UPDATE and DELETE on sealed receipts', async () => {
    const fixture = await seedPlannerRecoveryCallback(pool);
    await fixture.callback();
    await expect(pool.query(
      'UPDATE planner_recovery_receipts SET content=content WHERE planner_attempt_id=$1',
      [fixture.attemptId],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(
      'DELETE FROM planner_recovery_receipts WHERE planner_attempt_id=$1',
      [fixture.attemptId],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('fails closed when rollback would drop a non-empty authority ledger', async () => {
    const fixture = await seedPlannerRecoveryCallback(pool);
    await fixture.callback();

    await expect(pool.query(downSql)).rejects.toMatchObject({ code: '23514' });
    const preserved = await pool.query(
      'SELECT COUNT(*)::int AS count FROM planner_recovery_receipts WHERE planner_attempt_id=$1',
      [fixture.attemptId],
    );
    expect(preserved.rows[0].count).toBe(1);
  });
});
