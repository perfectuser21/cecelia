import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizeE2EScript,
  parseCanonicalE2EScript,
} = require('../../../../scripts/extract-contract-e2e.cjs');

const MAX_APPROVED_E2E_COMMAND_BYTES = 8192;

/**
 * Convert the immutable approved Markdown contract into the structured DB
 * acceptance consumed by both the evaluator and final staging gate.
 * Only the canonical E2E section is executable authority.
 */
export function buildApprovedE2eAcceptance(contractContent, coveredTaskId) {
  const extracted = parseCanonicalE2EScript(contractContent);
  const command = extracted === null ? '' : normalizeE2EScript(extracted);
  if (
    typeof coveredTaskId !== 'string'
    || coveredTaskId.trim() !== coveredTaskId
    || coveredTaskId.length === 0
    || command.length === 0
    || command.length > MAX_APPROVED_E2E_COMMAND_BYTES
    || command.trim() !== command
    || command.includes('\0')
  ) {
    throw new Error('approved_contract_e2e_invalid');
  }
  return {
    scenarios: [{
      name: 'Approved contract E2E',
      covered_tasks: [coveredTaskId],
      commands: [{ type: 'bash', cmd: command }],
    }],
  };
}

/**
 * Atomically freeze an approved Git contract into DB and attach it to its run.
 * Git remains the source artifact; this row is the durable gate snapshot used by
 * generate/evaluate after the GAN reviewer approves a specific rN branch.
 */
export async function materializeApprovedContract(db, {
  runId,
  version,
  branch,
  prdContent,
  contractContent,
  coveredTaskId,
  approvedAt = new Date(),
}) {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`invalid approved contract version: ${version}`);
  }
  if (typeof branch !== 'string' || !branch) {
    throw new Error('approved contract branch is required');
  }
  const e2eAcceptance = buildApprovedE2eAcceptance(contractContent, coveredTaskId);

  const { rows } = await db.query(
    `WITH run_row AS (
       SELECT initiative_id
         FROM initiative_runs
        WHERE id = $1::uuid
        FOR UPDATE
     ), approved_contract AS (
       INSERT INTO initiative_contracts
         (initiative_id, version, status, prd_content, contract_content, e2e_acceptance,
          review_rounds, approved_at, branch, created_at, updated_at)
       SELECT initiative_id, $2::integer, 'approved', $4::text, $5::text, $6::jsonb,
              $2::integer, $7::timestamptz, $3::text, $7::timestamptz, $7::timestamptz
         FROM run_row
       ON CONFLICT (initiative_id, version) DO UPDATE
         SET status = 'approved',
             prd_content = COALESCE(EXCLUDED.prd_content, initiative_contracts.prd_content),
             contract_content = COALESCE(EXCLUDED.contract_content, initiative_contracts.contract_content),
             e2e_acceptance = EXCLUDED.e2e_acceptance,
             review_rounds = GREATEST(initiative_contracts.review_rounds, EXCLUDED.review_rounds),
             approved_at = EXCLUDED.approved_at,
             branch = EXCLUDED.branch,
             updated_at = EXCLUDED.updated_at
       RETURNING id, initiative_id, version, status, branch
     ), superseded AS (
       UPDATE initiative_contracts AS prior
          SET status = 'superseded', updated_at = $7::timestamptz
         FROM approved_contract AS approved
        WHERE prior.initiative_id = approved.initiative_id
          AND prior.id <> approved.id
          AND prior.status <> 'superseded'
     )
     UPDATE initiative_runs AS run
        SET contract_id = approved.id, updated_at = $7::timestamptz
       FROM approved_contract AS approved
      WHERE run.id = $1::uuid
     RETURNING approved.id, approved.version, approved.status, approved.branch`,
    [
      runId,
      version,
      branch,
      prdContent ?? null,
      contractContent ?? null,
      e2eAcceptance,
      approvedAt,
    ],
  );

  if (!rows[0]) {
    throw new Error(`cannot materialize approved contract: run ${runId} not found`);
  }
  return rows[0];
}
