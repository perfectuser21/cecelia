#!/usr/bin/env node
/* global process */
import { createHash, randomUUID } from 'node:crypto';
import { chmod, open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { DB_DEFAULTS } from '../src/db-config.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RECONCILE_LOCK_KEY = 'kernel_stale_attempt_reconcile';
const ACTIVE_ATTEMPT_STATUSES = new Set(['queued', 'starting', 'running']);

const PRODUCTION_PREFLIGHT_SQL = `
  SELECT current_database() AS database_name
`;

const EVIDENCE_SQL = `
  SELECT attempt.id AS attempt_id,
         attempt.run_id,
         run.current_task_id AS task_id,
         attempt.status AS attempt_status,
         attempt.lease_owner,
         attempt.lease_expires_at,
         attempt.updated_at AS attempt_updated_at,
         attempt.error_code,
         attempt.error_message,
         attempt.completed_at,
         run.phase AS run_phase,
         run.orchestrator_version
    FROM harness_attempts attempt
    JOIN initiative_runs run ON run.id = attempt.run_id
   WHERE attempt.status IN ('queued', 'starting', 'running')
     AND run.orchestrator_version = 'v2'
     AND run.phase IN ('done', 'failed')
     AND (
       attempt.lease_expires_at IS NULL
       OR attempt.lease_expires_at <= NOW()
     )
   ORDER BY attempt.id ASC
`;

function timestampValue(value) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function proposalFor(row) {
  return {
    kind: 'repair',
    attempt_id: row.attempt_id,
    run_id: row.run_id,
    task_id: row.task_id,
    before: {
      status: row.attempt_status,
      lease_owner: row.lease_owner,
      lease_expires_at: timestampValue(row.lease_expires_at),
      updated_at: timestampValue(row.attempt_updated_at),
      error_code: row.error_code,
      error_message: row.error_message,
      completed_at: timestampValue(row.completed_at),
      run_phase: row.run_phase,
      orchestrator_version: row.orchestrator_version,
    },
    after: {
      status: 'cancelled',
      error_code: 'parent_run_terminal',
      lease_owner: null,
      lease_expires_at: null,
    },
    reason: 'expired_active_attempt_under_terminal_run',
  };
}

export function parseStaleAttemptReconcileArgs(argv) {
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

export function parseProductionStaleAttemptReconcileArgs(argv) {
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
  const base = parseStaleAttemptReconcileArgs(baseArgs);
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

function sameEvidence(current, proposal) {
  return (
    current
    && current.id === proposal.attempt_id
    && current.run_id === proposal.run_id
    && current.current_task_id === proposal.task_id
    && current.status === proposal.before.status
    && current.lease_owner === proposal.before.lease_owner
    && timestampValue(current.lease_expires_at) === proposal.before.lease_expires_at
    && timestampValue(current.updated_at) === proposal.before.updated_at
    && current.error_code === proposal.before.error_code
    && current.error_message === proposal.before.error_message
    && timestampValue(current.completed_at) === proposal.before.completed_at
    && current.run_phase === proposal.before.run_phase
    && current.orchestrator_version === proposal.before.orchestrator_version
    && ['done', 'failed'].includes(current.run_phase)
    && ACTIVE_ATTEMPT_STATUSES.has(current.status)
    && current.lease_is_stale === true
  );
}

async function applyOne(db, proposal) {
  const client = await db.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    if (proposal.task_id) {
      const taskLock = await client.query(
        `SELECT id
           FROM tasks
          WHERE id = $1
          FOR UPDATE`,
        [proposal.task_id],
      );
      if (taskLock.rows.length !== 1) {
        await client.query('ROLLBACK');
        committed = true;
        return { outcome: 'blocked', reason: 'parent_task_missing' };
      }
    }
    const runLock = await client.query(
      `SELECT id, current_task_id, phase, orchestrator_version
         FROM initiative_runs
        WHERE id = $1
        FOR UPDATE`,
      [proposal.run_id],
    );
    const run = runLock.rows[0] ?? null;
    const attemptLock = await client.query(
      `SELECT attempt.id, attempt.run_id, attempt.status, attempt.lease_owner,
              attempt.lease_expires_at, attempt.updated_at, attempt.error_code,
              attempt.error_message, attempt.completed_at,
              run.current_task_id, run.phase AS run_phase,
              run.orchestrator_version,
              (
                attempt.lease_expires_at IS NULL
                OR attempt.lease_expires_at <= NOW()
              ) AS lease_is_stale
         FROM harness_attempts attempt
         JOIN initiative_runs run ON run.id = attempt.run_id
        WHERE attempt.id = $1
          AND attempt.run_id = $2
        FOR UPDATE OF attempt`,
      [proposal.attempt_id, proposal.run_id],
    );
    const current = attemptLock.rows[0] ?? null;
    if (
      !run
      || run.current_task_id !== proposal.task_id
      || run.phase !== proposal.before.run_phase
      || run.orchestrator_version !== proposal.before.orchestrator_version
      || !sameEvidence(current, proposal)
    ) {
      await client.query('ROLLBACK');
      committed = true;
      return { outcome: 'blocked', reason: 'evidence_drift' };
    }

    const result = await client.query(
      `UPDATE harness_attempts
          SET status = 'cancelled',
              error_code = 'parent_run_terminal',
              error_message = $3,
              completed_at = COALESCE(completed_at, NOW()),
              lease_owner = NULL,
              lease_expires_at = NULL,
              updated_at = NOW()
        WHERE id = $1
          AND run_id = $2
          AND status IN ('queued', 'starting', 'running')
          AND (
            lease_expires_at IS NULL
            OR lease_expires_at <= NOW()
          )`,
      [
        proposal.attempt_id,
        proposal.run_id,
        `Historical reconciliation: parent Kernel run ${proposal.before.run_phase}`,
      ],
    );
    if (result.rowCount !== 1) {
      await client.query('ROLLBACK');
      committed = true;
      return { outcome: 'blocked', reason: 'conditional_update_missed' };
    }
    await client.query('COMMIT');
    committed = true;
    return { outcome: 'applied' };
  } catch (error) {
    if (!committed) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function verifyApplied(db, proposal) {
  const result = await db.query(
    `SELECT status, error_code, error_message, completed_at,
            lease_owner, lease_expires_at
       FROM harness_attempts
      WHERE id = $1
        AND run_id = $2`,
    [proposal.attempt_id, proposal.run_id],
  );
  const row = result.rows[0] ?? null;
  return (
    row
    && row.status === 'cancelled'
    && row.error_code === 'parent_run_terminal'
    && row.completed_at != null
    && row.lease_owner == null
    && row.lease_expires_at == null
  );
}

export async function reconcileStaleAttempts({
  db = pool,
  apply = false,
  auditOutput = null,
  expectedPlanSha256 = null,
  expectedProposed = null,
  confirmDatabase = null,
  productionGuards = false,
  writeLine = line => process.stdout.write(`${line}\n`),
  appendAudit = null,
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
        throw new Error('another kernel stale attempt reconcile is already running');
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
    const proposals = rows.map(proposalFor);
    const planContent = proposals
      .map(proposal => `${JSON.stringify(proposal)}\n`)
      .join('');
    const planSha256 = createHash('sha256').update(planContent).digest('hex');
    for (const proposal of proposals) {
      writeLine(JSON.stringify(proposal));
    }

    if (apply && expectedPlanSha256 !== planSha256) {
      throw new Error(
        `reviewed plan digest mismatch: expected ${expectedPlanSha256}, actual ${planSha256}`,
      );
    }
    if (
      apply
      && expectedProposed !== null
      && expectedProposed !== proposals.length
    ) {
      throw new Error(
        `proposal count mismatch: expected ${expectedProposed}, actual ${proposals.length}`,
      );
    }
    if (apply && confirmDatabase !== null && confirmDatabase !== databaseName) {
      throw new Error(
        `database confirmation mismatch: expected ${confirmDatabase}, actual ${databaseName}`,
      );
    }
    const metadata = productionGuards ? { database: databaseName } : {};
    if (!apply) {
      return {
        scanned: rows.length,
        proposed: proposals.length,
        applied: 0,
        blocked: 0,
        plan_sha256: planSha256,
        ...metadata,
      };
    }
    if (proposals.length > 100) {
      throw new Error(`stale attempt repair blast radius exceeds 100 rows: ${proposals.length}`);
    }
    if (typeof db.connect !== 'function') {
      throw new Error('apply requires a transactional PostgreSQL pool');
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
    let blocked = 0;
    try {
      await writeAudit(`${JSON.stringify({
        execution_id: executionId,
        kind: 'kernel_stale_attempt_reconcile',
        outcome: 'started',
        proposed: proposals.length,
        plan_sha256: planSha256,
        ...metadata,
      })}\n`);
      for (const proposal of proposals) {
        await writeAudit(`${JSON.stringify({
          execution_id: executionId,
          commit_state: 'pending',
          ...proposal,
        })}\n`);
        const result = await applyOne(db, proposal);
        if (result.outcome !== 'applied') {
          blocked += 1;
          await writeAudit(`${JSON.stringify({
            execution_id: executionId,
            commit_state: 'blocked',
            ...proposal,
            block_reason: result.reason,
          })}\n`);
          continue;
        }
        applied += 1;
        if (!await verifyApplied(queryDb, proposal)) {
          throw new Error(`stale attempt verification failed: ${proposal.attempt_id}`);
        }
        verified += 1;
        await writeAudit(`${JSON.stringify({
          execution_id: executionId,
          commit_state: 'verified',
          ...proposal,
        })}\n`);
      }
      await writeAudit(`${JSON.stringify({
        execution_id: executionId,
        kind: 'kernel_stale_attempt_reconcile',
        outcome: 'completed',
        applied,
        verified,
        blocked,
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
      proposed: proposals.length,
      applied,
      verified,
      blocked,
      execution_id: executionId,
      plan_sha256: planSha256,
      ...metadata,
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
  const options = parseProductionStaleAttemptReconcileArgs(process.argv.slice(2));
  const result = await reconcileStaleAttempts(options);
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
