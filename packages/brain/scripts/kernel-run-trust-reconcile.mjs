#!/usr/bin/env node
import { appendFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import pool from '../src/db.js';
import { classifyRunTrust } from '../src/orchestrator/run-trust-classifier.js';

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
  return { apply, auditOutput, batchSize };
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

async function applyBatch(db, proposals) {
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    let applied = 0;
    for (const proposal of proposals) {
      const result = await client.query(
        `UPDATE initiative_runs
            SET record_trust_status = $2,
                record_trust_reason = $3
          WHERE id = $1
            AND (
              record_trust_status IS DISTINCT FROM $2
              OR record_trust_reason IS DISTINCT FROM $3
            )`,
        [
          proposal.run_id,
          proposal.after.status,
          proposal.after.reason,
        ],
      );
      applied += result.rowCount ?? 0;
    }
    await client.query('COMMIT');
    return applied;
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
  writeLine = line => process.stdout.write(`${line}\n`),
  appendAudit = (file, content) => appendFile(file, content, { encoding: 'utf8' }),
} = {}) {
  if (apply && (!auditOutput || !isAbsolute(auditOutput))) {
    throw new Error('apply requires an absolute audit output path');
  }
  const { rows } = await db.query(EVIDENCE_SQL);
  const proposals = rows.map(proposalFor);
  for (const proposal of proposals) {
    writeLine(JSON.stringify(proposal));
  }
  if (!apply) {
    return {
      scanned: rows.length,
      proposed: proposals.length,
      applied: 0,
    };
  }

  await appendAudit(
    auditOutput,
    proposals.map(proposal => `${JSON.stringify(proposal)}\n`).join(''),
  );
  let applied = 0;
  for (let offset = 0; offset < proposals.length; offset += batchSize) {
    applied += await applyBatch(db, proposals.slice(offset, offset + batchSize));
  }
  return {
    scanned: rows.length,
    proposed: proposals.length,
    applied,
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
