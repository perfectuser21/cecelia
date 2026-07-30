#!/usr/bin/env node
/* global process */
import { createHash, randomUUID } from 'node:crypto';
import { chmod, open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { DB_DEFAULTS } from '../src/db-config.js';
import { finalizeKernelRun } from '../src/orchestrator/kernel-run-store.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RECONCILE_LOCK_KEY = 'kernel_terminal_mismatch_reconcile';
const PRODUCTION_PREFLIGHT_SQL = `
  SELECT current_database() AS database_name
`;
const TERMINAL_TASK_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'canceled',
]);

const EVIDENCE_SQL = `
  WITH terminal_history AS (
    SELECT r.current_task_id AS task_id,
           COUNT(*)::int AS terminal_run_count,
           COUNT(DISTINCT r.phase)::int AS distinct_outcome_count
      FROM initiative_runs r
     WHERE r.orchestrator_version = 'v2'
       AND r.current_task_id IS NOT NULL
       AND r.phase IN ('done', 'failed')
     GROUP BY r.current_task_id
  ),
  latest_terminal AS (
    SELECT DISTINCT ON (r.current_task_id)
           r.current_task_id AS task_id,
           r.id AS run_id,
           r.phase AS run_phase,
           r.failure_reason
      FROM initiative_runs r
     WHERE r.orchestrator_version = 'v2'
       AND r.current_task_id IS NOT NULL
       AND r.phase IN ('done', 'failed')
     ORDER BY r.current_task_id,
              r.completed_at DESC NULLS LAST,
              r.started_at DESC,
              r.id DESC
  )
  SELECT t.id AS task_id,
         t.status AS task_status,
         latest.run_id,
         latest.run_phase,
         latest.failure_reason,
         history.terminal_run_count,
         history.distinct_outcome_count
    FROM tasks t
    JOIN terminal_history history ON history.task_id = t.id
    JOIN latest_terminal latest ON latest.task_id = t.id
   WHERE NOT EXISTS (
     SELECT 1
       FROM initiative_runs active
      WHERE active.current_task_id = t.id
        AND active.orchestrator_version = 'v2'
        AND active.phase NOT IN ('done', 'failed')
   )
     AND (
       (
         latest.run_phase = 'done'
         AND t.status <> 'completed'
       ) OR (
         latest.run_phase = 'failed'
         AND t.status <> 'failed'
       )
     )
   ORDER BY t.id ASC
`;

export function parseTerminalReconcileArgs(argv) {
  let apply = false;
  let auditOutput = null;
  let expectedPlanSha256 = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      apply = true;
    } else if (arg === '--audit-output') {
      auditOutput = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--expected-plan-sha256') {
      expectedPlanSha256 = argv[index + 1] ?? null;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (apply && !auditOutput) {
    throw new Error('--apply requires --audit-output');
  }
  if (apply && !isAbsolute(auditOutput)) {
    throw new Error('--audit-output must be an absolute path');
  }
  if (expectedPlanSha256 && !SHA256_PATTERN.test(expectedPlanSha256)) {
    throw new Error('--expected-plan-sha256 must be 64 lowercase hex characters');
  }
  if (apply && !expectedPlanSha256) {
    throw new Error('--apply requires --expected-plan-sha256');
  }
  return { apply, auditOutput, expectedPlanSha256 };
}

export function parseProductionTerminalReconcileArgs(argv) {
  let expectedProposed = null;
  let confirmDatabase = null;
  const baseArgs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--expected-proposed') {
      expectedProposed = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--confirm-database') {
      confirmDatabase = argv[index + 1] ?? null;
      index += 1;
    } else {
      baseArgs.push(arg);
    }
  }
  const base = parseTerminalReconcileArgs(baseArgs);
  if (
    expectedProposed !== null
    && (!Number.isInteger(expectedProposed) || expectedProposed < 0)
  ) {
    throw new Error('--expected-proposed must be a non-negative integer');
  }
  if (base.apply && expectedProposed === null) {
    throw new Error('--apply requires --expected-proposed');
  }
  if (base.apply && !confirmDatabase) {
    throw new Error('--apply requires --confirm-database');
  }
  return {
    ...base,
    expectedProposed,
    confirmDatabase,
    productionGuards: true,
  };
}

function findingFor(row) {
  const terminalRunCount = Number(row.terminal_run_count);
  const distinctOutcomeCount = Number(row.distinct_outcome_count);
  const afterTaskStatus = row.run_phase === 'done' ? 'completed' : 'failed';
  const evidence = {
    terminal_run_count: terminalRunCount,
    distinct_outcome_count: distinctOutcomeCount,
  };
  if (distinctOutcomeCount !== 1) {
    return {
      kind: 'blocked',
      task_id: row.task_id,
      run_id: row.run_id,
      before_task_status: row.task_status,
      run_phase: row.run_phase,
      after_task_status: afterTaskStatus,
      reason: 'ambiguous_terminal_outcomes',
      evidence,
    };
  }
  if (TERMINAL_TASK_STATUSES.has(row.task_status)) {
    return {
      kind: 'blocked',
      task_id: row.task_id,
      run_id: row.run_id,
      before_task_status: row.task_status,
      run_phase: row.run_phase,
      after_task_status: afterTaskStatus,
      reason: 'terminal_task_outcome_conflict',
      evidence,
    };
  }
  return {
    kind: 'repair',
    task_id: row.task_id,
    run_id: row.run_id,
    before_task_status: row.task_status,
    run_phase: row.run_phase,
    after_task_status: afterTaskStatus,
    reason: row.failure_reason ?? 'terminal_run_reconciliation',
    evidence,
  };
}

export async function reconcileTerminalMismatches({
  db = pool,
  apply = false,
  auditOutput = null,
  expectedPlanSha256 = null,
  expectedProposed = null,
  confirmDatabase = null,
  productionGuards = false,
  writeLine = line => process.stdout.write(`${line}\n`),
  appendAudit = null,
  finalizeRun = finalizeKernelRun,
  randomUUIDFn = randomUUID,
} = {}) {
  if (apply && (!auditOutput || !isAbsolute(auditOutput))) {
    throw new Error('apply requires an absolute audit output path');
  }
  if (apply && !SHA256_PATTERN.test(expectedPlanSha256 ?? '')) {
    throw new Error('apply requires a valid expected plan sha256');
  }

  let lockClient = null;
  let lockHeld = false;
  try {
    if (apply && productionGuards && typeof db.connect === 'function') {
      lockClient = await db.connect();
      const lockResult = await lockClient.query(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
        [RECONCILE_LOCK_KEY],
      );
      lockHeld = lockResult.rows?.[0]?.locked === true;
      if (!lockHeld) {
        lockClient.release();
        lockClient = null;
        throw new Error('another kernel terminal mismatch reconcile is already running');
      }
    }

  const queryDb = lockClient ?? db;
  let databaseName = null;
  if (productionGuards) {
    const preflight = await queryDb.query(PRODUCTION_PREFLIGHT_SQL);
    databaseName = preflight.rows?.[0]?.database_name ?? null;
    if (!databaseName) {
      throw new Error('production reconcile preflight is missing database name');
    }
  }
  const { rows } = await queryDb.query(EVIDENCE_SQL);
  const findings = rows.map(findingFor);
  const repairs = findings.filter(finding => finding.kind === 'repair');
  const blocked = findings.filter(finding => finding.kind === 'blocked');
  const planContent = findings
    .map(finding => `${JSON.stringify(finding)}\n`)
    .join('');
  const planSha256 = createHash('sha256').update(planContent).digest('hex');
  for (const finding of findings) {
    writeLine(JSON.stringify(finding));
  }

  if (apply && expectedPlanSha256 !== planSha256) {
    throw new Error(
      `reviewed plan digest mismatch: expected ${expectedPlanSha256}, actual ${planSha256}`,
    );
  }
  if (
    apply
    && expectedProposed !== null
    && expectedProposed !== repairs.length
  ) {
    throw new Error(
      `proposal count mismatch: expected ${expectedProposed}, actual ${repairs.length}`,
    );
  }
  if (
    apply
    && confirmDatabase !== null
    && confirmDatabase !== databaseName
  ) {
    throw new Error(
      `database confirmation mismatch: expected ${confirmDatabase}, actual ${databaseName}`,
    );
  }
  const productionMetadata = productionGuards
    ? { database: databaseName }
    : {};
  if (!apply) {
    return {
      scanned: rows.length,
      proposed: repairs.length,
      blocked: blocked.length,
      applied: 0,
      plan_sha256: planSha256,
      ...productionMetadata,
    };
  }
  if (blocked.length > 0) {
    throw new Error(
      `blocked terminal mismatch findings require manual review: ${blocked.length}`,
    );
  }
  if (repairs.length > 100) {
    throw new Error(`terminal repair blast radius exceeds 100 rows: ${repairs.length}`);
  }

  const executionId = randomUUIDFn();
  let auditHandle = null;
  const writeAudit = appendAudit
    ? content => appendAudit(auditOutput, content)
    : async content => {
        await auditHandle.write(content);
        await auditHandle.sync();
      };
  if (!appendAudit) {
    auditHandle = await open(auditOutput, 'wx', 0o600);
  }

  let applied = 0;
  let verified = 0;
  try {
    await writeAudit(`${JSON.stringify({
      execution_id: executionId,
      kind: 'kernel_terminal_mismatch_reconcile',
      outcome: 'started',
      proposed: repairs.length,
      plan_sha256: planSha256,
      ...productionMetadata,
    })}\n`);
    for (const repair of repairs) {
      await writeAudit(`${JSON.stringify({
        execution_id: executionId,
        commit_state: 'pending',
        ...repair,
      })}\n`);
      await finalizeRun(db, {
        runId: repair.run_id,
        expectedTaskId: repair.task_id,
        expectedTaskStatus: repair.before_task_status,
        requireNoActiveSibling: true,
        outcome: repair.run_phase,
        reason: repair.reason,
      });
      if (productionGuards) {
        const verification = await queryDb.query(
          `SELECT t.status AS task_status,
                  r.phase AS run_phase,
                  r.current_task_id,
                  NOT EXISTS (
                    SELECT 1
                      FROM initiative_runs active
                     WHERE active.current_task_id = r.current_task_id
                       AND active.id <> r.id
                       AND active.orchestrator_version = 'v2'
                       AND active.phase NOT IN ('done', 'failed')
                  ) AS no_active_sibling
             FROM initiative_runs r
             JOIN tasks t ON t.id = r.current_task_id
            WHERE r.id = $1
              AND t.id = $2`,
          [repair.run_id, repair.task_id],
        );
        const verifiedRow = verification.rows?.[0] ?? null;
        if (
          !verifiedRow
          || verifiedRow.run_phase !== repair.run_phase
          || verifiedRow.task_status !== repair.after_task_status
          || verifiedRow.current_task_id !== repair.task_id
          || verifiedRow.no_active_sibling !== true
        ) {
          throw new Error(
            `terminal repair verification failed: ${repair.run_id}/${repair.task_id}`,
          );
        }
        verified += 1;
      }
      applied += 1;
      await writeAudit(`${JSON.stringify({
        execution_id: executionId,
        commit_state: productionGuards ? 'verified' : 'committed',
        ...repair,
      })}\n`);
    }
    await writeAudit(`${JSON.stringify({
      execution_id: executionId,
      kind: 'kernel_terminal_mismatch_reconcile',
      outcome: 'completed',
      applied,
      ...(productionGuards ? { verified } : {}),
    })}\n`);
  } finally {
    if (auditHandle) {
      await auditHandle.sync();
      await auditHandle.close();
      await chmod(auditOutput, 0o400);
    }
  }

  return {
    scanned: rows.length,
    proposed: repairs.length,
    blocked: blocked.length,
    applied,
    ...(productionGuards ? { verified } : {}),
    execution_id: executionId,
    plan_sha256: planSha256,
    ...productionMetadata,
  };
  } finally {
    if (lockClient) {
      if (lockHeld) {
        await lockClient.query(
          'SELECT pg_advisory_unlock(hashtext($1)) AS unlocked',
          [RECONCILE_LOCK_KEY],
        ).catch(() => {});
      }
      lockClient.release();
    }
  }
}

async function main() {
  const options = parseProductionTerminalReconcileArgs(process.argv.slice(2));
  const result = await reconcileTerminalMismatches(options);
  process.stderr.write(`${JSON.stringify(result)}\n`);
  await pool.end();
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(async (error) => {
    process.stderr.write(`${error.message}\n`);
    await pool.end().catch(() => {});
    process.exitCode = 1;
  });
}
