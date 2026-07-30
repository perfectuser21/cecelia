#!/usr/bin/env node
/* global process */
import { createHash, randomUUID } from 'node:crypto';
import { chmod, open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { DB_DEFAULTS } from '../src/db-config.js';
import { classifyRunTrust } from '../src/orchestrator/run-trust-classifier.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RECONCILE_LOCK_KEY = 'kernel_run_trust_reconcile';
const PRODUCTION_PREFLIGHT_SQL = `
  SELECT current_database() AS database_name,
         (
           SELECT applied_at
             FROM schema_version
            WHERE version = '376'
         ) AS historical_cutoff
`;

const EVIDENCE_SQL = `
  WITH evidence AS (
    SELECT r.id,
           r.current_task_id,
           r.record_trust_status,
           r.record_trust_reason,
           current_database() AS database_name,
           cutover.historical_cutoff,
           (SELECT COUNT(*) FROM tasks t WHERE t.id = r.current_task_id)
             AS task_reference_count,
           (SELECT COUNT(*) FROM harness_attempts a WHERE a.run_id = r.id)
             AS matching_attempt_count,
           CASE
             WHEN r.completed_at IS NULL THEN 1
             ELSE COUNT(*) OVER (
               PARTITION BY r.initiative_id, r.completed_at
             )
           END AS batch_collision_count
      FROM initiative_runs r
      CROSS JOIN (
        SELECT applied_at AS historical_cutoff
          FROM schema_version
         WHERE version = '376'
      ) cutover
     WHERE r.orchestrator_version = 'v2'
       AND r.phase IN ('done', 'failed')
       AND r.completed_at IS NOT NULL
       AND r.record_trust_status <> 'trusted'
       AND r.started_at < cutover.historical_cutoff
  )
  SELECT *
    FROM evidence
   ORDER BY id ASC
`;

export function parseTrustReconcileArgs(argv) {
  let apply = false;
  let auditOutput = null;
  let batchSize = 100;
  let expectedPlanSha256 = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      apply = true;
    } else if (arg === '--audit-output') {
      auditOutput = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--batch-size') {
      batchSize = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--expected-plan-sha256') {
      expectedPlanSha256 = argv[index + 1] ?? null;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error('--batch-size must be an integer between 1 and 500');
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
  return {
    apply,
    auditOutput,
    batchSize,
    expectedPlanSha256,
  };
}

export function parseProductionTrustReconcileArgs(argv) {
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
  const base = parseTrustReconcileArgs(baseArgs);
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
    failOnConflict: true,
  };
}

function proposalFor(row) {
  const evidence = {
    task_reference_count: Number(row.task_reference_count),
    matching_attempt_count: Number(row.matching_attempt_count),
    batch_collision_count: Number(row.batch_collision_count),
  };
  const after = classifyRunTrust({
    run: row,
    taskReferenceCount: evidence.task_reference_count,
    matchingAttemptCount: evidence.matching_attempt_count,
    batchCollisionCount: evidence.batch_collision_count,
  });
  return {
    run_id: row.id,
    before: {
      status: row.record_trust_status,
      reason: row.record_trust_reason,
    },
    after,
    reason: after.reason,
    evidence,
  };
}

function evidenceMatches(left, right) {
  return (
    left.task_reference_count === right.task_reference_count
    && left.matching_attempt_count === right.matching_attempt_count
    && left.batch_collision_count === right.batch_collision_count
  );
}

async function lockAndReadCurrentEvidence(client, proposal) {
  const identityResult = await client.query(
    `SELECT id, initiative_id, current_task_id
       FROM initiative_runs
      WHERE id = $1`,
    [proposal.run_id],
  );
  const identity = identityResult.rows?.[0] ?? null;
  if (!identity) return null;

  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended(
         'relay-prefix:' ||
         lower(substr(replace($1::text, '-', ''), 1, 8)),
         0
       )
     )`,
    [identity.initiative_id],
  );
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended('relay-initiative:' || $1::text, 0)
     )`,
    [identity.initiative_id],
  );
  const taskLocks = identity.current_task_id
    ? await client.query(
        `SELECT id
           FROM tasks
          WHERE id = $1
          FOR KEY SHARE`,
        [identity.current_task_id],
      )
    : { rows: [] };
  const initiativeRunLocks = await client.query(
    `SELECT id, initiative_id, current_task_id, phase, completed_at,
            record_trust_status, record_trust_reason
       FROM initiative_runs
      WHERE initiative_id = $1
      ORDER BY id
      FOR UPDATE`,
    [identity.initiative_id],
  );
  const current = initiativeRunLocks.rows.find(row => row.id === proposal.run_id) ?? null;
  if (
    !current
    || current.initiative_id !== identity.initiative_id
    || current.current_task_id !== identity.current_task_id
  ) {
    return null;
  }
  const eligibilityResult = await client.query(
    `SELECT EXISTS (
       SELECT 1
         FROM initiative_runs eligible
         CROSS JOIN (
           SELECT applied_at AS historical_cutoff
             FROM schema_version
            WHERE version = '376'
         ) cutover
        WHERE eligible.id = $1
          AND eligible.orchestrator_version = 'v2'
          AND eligible.phase IN ('done', 'failed')
          AND eligible.completed_at IS NOT NULL
          AND eligible.record_trust_status <> 'trusted'
          AND eligible.started_at < cutover.historical_cutoff
     ) AS eligible`,
    [proposal.run_id],
  );
  if (eligibilityResult.rows?.[0]?.eligible !== true) {
    return null;
  }
  const attemptLocks = await client.query(
    `SELECT id
       FROM harness_attempts
      WHERE run_id = $1
      FOR UPDATE`,
    [proposal.run_id],
  );
  const collisionResult = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM initiative_runs
      CROSS JOIN (
        SELECT applied_at AS historical_cutoff
          FROM schema_version
         WHERE version = '376'
      ) cutover
      WHERE initiative_id = $1
        AND completed_at = (
          SELECT exact.completed_at
            FROM initiative_runs exact
           WHERE exact.id = $2
        )
        AND orchestrator_version = 'v2'
        AND phase IN ('done', 'failed')
        AND record_trust_status <> 'trusted'
        AND started_at < cutover.historical_cutoff`,
    [current.initiative_id, proposal.run_id],
  );
  return {
    run: current,
    evidence: {
      task_reference_count: taskLocks.rows.length,
      matching_attempt_count: attemptLocks.rows.length,
      batch_collision_count: Number(collisionResult.rows[0].count),
    },
  };
}

async function applyBatch(
  db,
  proposals,
  executionId,
  batchId,
  writeAudit,
  failOnConflict = false,
) {
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    const outcomes = [];
    for (const proposal of proposals) {
      if (failOnConflict) {
        const currentEvidence = await lockAndReadCurrentEvidence(client, proposal);
        const evidenceChanged = (
          !currentEvidence
          || currentEvidence.run.record_trust_status !== proposal.before.status
          || currentEvidence.run.record_trust_reason !== proposal.before.reason
          || !evidenceMatches(currentEvidence.evidence, proposal.evidence)
        );
        if (evidenceChanged) {
          outcomes.push({
            execution_id: executionId,
            batch_id: batchId,
            commit_state: 'pending',
            ...proposal,
            current_evidence: currentEvidence?.evidence ?? null,
            outcome: 'conflict',
          });
          continue;
        }
      }
      const result = await client.query(
        `UPDATE initiative_runs
            SET record_trust_status = $2,
                record_trust_reason = $3
          WHERE id = $1
            AND record_trust_status IS NOT DISTINCT FROM $4
            AND record_trust_reason IS NOT DISTINCT FROM $5
            AND (
              record_trust_status IS DISTINCT FROM $2
              OR record_trust_reason IS DISTINCT FROM $3
            )`,
        [
          proposal.run_id,
          proposal.after.status,
          proposal.after.reason,
          proposal.before.status,
          proposal.before.reason,
        ],
      );
      let outcome = 'applied';
      if ((result.rowCount ?? 0) !== 1) {
        const current = await client.query(
          `SELECT record_trust_status, record_trust_reason
             FROM initiative_runs
            WHERE id = $1`,
          [proposal.run_id],
        );
        const row = current.rows?.[0] ?? null;
        outcome = (
          row
          && row.record_trust_status === proposal.after.status
          && row.record_trust_reason === proposal.after.reason
        ) ? 'unchanged' : 'conflict';
      }
      outcomes.push({
        execution_id: executionId,
        batch_id: batchId,
        commit_state: 'pending',
        ...proposal,
        outcome,
      });
    }
    await writeAudit(
      outcomes.map(outcome => `${JSON.stringify(outcome)}\n`).join(''),
    );
    if (
      failOnConflict
      && outcomes.some(outcome => outcome.outcome === 'conflict')
    ) {
      throw new Error('production reconcile optimistic conflict');
    }
    await client.query('COMMIT');
    return outcomes;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release?.();
  }
}

export async function reconcileRunTrust({
  db = pool,
  apply = false,
  auditOutput = null,
  batchSize = 100,
  expectedPlanSha256 = null,
  expectedProposed = null,
  confirmDatabase = null,
  productionGuards = false,
  failOnConflict = false,
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
        throw new Error('another kernel run trust reconcile is already running');
      }
    }

    const queryDb = lockClient ?? db;
    let databaseName = null;
    let historicalCutoff = null;
    if (productionGuards) {
      const preflight = await queryDb.query(PRODUCTION_PREFLIGHT_SQL);
      databaseName = preflight.rows?.[0]?.database_name ?? null;
      historicalCutoff = preflight.rows?.[0]?.historical_cutoff ?? null;
      if (!databaseName || !historicalCutoff) {
        throw new Error('production reconcile preflight is missing database or migration 376 cutoff');
      }
    }

    const { rows } = await queryDb.query(EVIDENCE_SQL);
    const proposals = rows
      .filter(row => row.record_trust_status !== 'trusted')
      .map(proposalFor);
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
    if (
      apply
      && confirmDatabase !== null
      && confirmDatabase !== databaseName
    ) {
      throw new Error(
        `database confirmation mismatch: expected ${confirmDatabase}, actual ${databaseName}`,
      );
    }
    const wouldChange = proposals.filter(proposal => (
      proposal.before.status !== proposal.after.status
      || proposal.before.reason !== proposal.after.reason
    )).length;
    const productionMetadata = productionGuards
      ? {
          database: databaseName,
          historical_cutoff: new Date(historicalCutoff).toISOString(),
          would_change: wouldChange,
        }
      : {};
    if (!apply) {
      return {
        scanned: rows.length,
        proposed: proposals.length,
        applied: 0,
        plan_sha256: planSha256,
        ...productionMetadata,
      };
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
    const outcomes = [];
    try {
      await writeAudit(`${JSON.stringify({
        execution_id: executionId,
        kind: 'kernel_run_trust_reconcile',
        outcome: 'started',
        proposed: proposals.length,
        plan_sha256: planSha256,
        ...productionMetadata,
      })}\n`);
      const effectiveBatchSize = failOnConflict ? 1 : batchSize;
      for (let offset = 0; offset < proposals.length; offset += effectiveBatchSize) {
        const batchId = `${executionId}:${Math.floor(offset / effectiveBatchSize) + 1}`;
        const batchOutcomes = await applyBatch(
          db,
          proposals.slice(offset, offset + effectiveBatchSize),
          executionId,
          batchId,
          writeAudit,
          failOnConflict,
        );
        outcomes.push(...batchOutcomes);
        await writeAudit(`${JSON.stringify({
          execution_id: executionId,
          batch_id: batchId,
          outcome: 'batch_committed',
          rows: batchOutcomes.length,
        })}\n`);
      }
      await writeAudit(`${JSON.stringify({
        execution_id: executionId,
        kind: 'kernel_run_trust_reconcile',
        outcome: 'completed',
        applied: outcomes.filter(outcome => outcome.outcome === 'applied').length,
        unchanged: outcomes.filter(outcome => outcome.outcome === 'unchanged').length,
        conflicts: outcomes.filter(outcome => outcome.outcome === 'conflict').length,
      })}\n`);
    } finally {
      if (auditHandle) {
        await auditHandle.sync();
        await auditHandle.close();
        await chmod(auditOutput, 0o400);
      }
    }
    const applied = outcomes.filter(outcome => outcome.outcome === 'applied').length;
    const conflicts = outcomes.filter(outcome => outcome.outcome === 'conflict').length;
    const unchanged = outcomes.filter(outcome => outcome.outcome === 'unchanged').length;
    return {
      scanned: rows.length,
      proposed: proposals.length,
      applied,
      unchanged,
      conflicts,
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
  const options = parseProductionTrustReconcileArgs(process.argv.slice(2));
  const result = await reconcileRunTrust(options);
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
