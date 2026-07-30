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

const EVIDENCE_SQL = `
  WITH evidence AS (
    SELECT r.id,
           r.current_task_id,
           r.record_trust_status,
           r.record_trust_reason,
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
     WHERE r.orchestrator_version = 'v2'
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

async function applyBatch(
  db,
  proposals,
  executionId,
  batchId,
  writeAudit,
) {
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    const outcomes = [];
    for (const proposal of proposals) {
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
  const { rows } = await db.query(EVIDENCE_SQL);
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
  if (!apply) {
    return {
      scanned: rows.length,
      proposed: proposals.length,
      applied: 0,
      plan_sha256: planSha256,
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
    })}\n`);
    for (let offset = 0; offset < proposals.length; offset += batchSize) {
      const batchId = `${executionId}:${Math.floor(offset / batchSize) + 1}`;
      const batchOutcomes = await applyBatch(
        db,
        proposals.slice(offset, offset + batchSize),
        executionId,
        batchId,
        writeAudit,
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
  };
}

async function main() {
  const options = parseTrustReconcileArgs(process.argv.slice(2));
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
