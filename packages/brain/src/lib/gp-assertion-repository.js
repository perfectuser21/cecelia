import { assertionRunnerError } from './gp-assertion-command.js';

function repositoryError(code, message) {
  return assertionRunnerError(code, message);
}

export async function loadAssertionCellFromDb(
  db,
  linkId,
  { lock = 'share' } = {},
) {
  const lockClause = lock === 'update' ? 'FOR UPDATE' : 'FOR SHARE';
  const { rows } = await db.query(
    `SELECT id, journey_id, assertion_ref, assertion_revision
       FROM journey_step_links
      WHERE id = $1
      ${lockClause}`,
    [linkId],
  );
  if (!rows[0]) {
    throw repositoryError(
      'ASSERTION_CELL_NOT_FOUND',
      `Unknown journey cell: ${linkId}`,
    );
  }
  return rows[0];
}

export async function findReceiptFromDb(db, runId, linkId) {
  const { rows } = await db.query(
    `SELECT *
       FROM journey_assertion_receipts
      WHERE run_id = $1 AND journey_step_link_id = $2`,
    [runId, linkId],
  );
  return rows[0] ?? null;
}

export async function signedContractFromDb(
  db,
  journeyId,
  { lock = null } = {},
) {
  const lockClause = lock === 'share' ? 'FOR SHARE OF contract' : '';
  const { rows } = await db.query(
    `SELECT contract.id, contract.golden_path_id,
            contract.content_hash, contract.status
       FROM golden_path_contract_versions contract
       JOIN golden_paths gp ON gp.id = contract.golden_path_id
      WHERE gp.journey_id = $1
      ORDER BY contract.created_at DESC, contract.version DESC
      ${lockClause}`,
    [journeyId],
  );
  const goldenPathIds = new Set(rows.map(row => String(row.golden_path_id)));
  const signed = rows.filter(row => row.status === 'signed');
  if (goldenPathIds.size > 1 || signed.length > 1) {
    throw repositoryError(
      'GP_CONTRACT_AMBIGUOUS',
      `Journey ${journeyId} has ambiguous Golden Path contract history`,
    );
  }
  return {
    hasHistory: rows.length > 0,
    signed: signed[0] ?? null,
  };
}

export async function persistReceiptToDb(receipt, db) {
  const values = [
    receipt.journey_step_link_id,
    receipt.run_id,
    receipt.assertion_revision,
    receipt.assertion_ref_snapshot,
    receipt.assertion_digest,
    receipt.source_repo,
    receipt.source_sha,
    receipt.gp_contract_id,
    receipt.gp_contract_hash,
    JSON.stringify(receipt.command_argv),
    receipt.scenario_count,
    JSON.stringify(receipt.scenario_evidence),
    receipt.verdict,
    receipt.exit_code,
    receipt.started_at,
    receipt.completed_at,
    receipt.machine_id,
    receipt.output_digest,
    receipt.output_tail,
  ];
  const { rows } = await db.query(
    `INSERT INTO journey_assertion_receipts (
       journey_step_link_id, run_id, assertion_revision,
       assertion_ref_snapshot, assertion_digest, source_repo, source_sha,
       gp_contract_id, gp_contract_hash, command_argv,
       scenario_count, scenario_evidence, verdict, exit_code,
       started_at, completed_at, machine_id, output_digest, output_tail,
       synthetic
     )
     SELECT
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::jsonb,
       $13, $14, $15, $16, $17, $18, $19, false
     FROM journey_step_links cell
     WHERE cell.id = $1
       AND cell.assertion_revision = $3
       AND cell.assertion_ref IS NOT DISTINCT FROM $4
       AND (
         (
           $8::uuid IS NULL
           AND $9::text IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM golden_path_contract_versions contract
             JOIN golden_paths gp
               ON gp.id = contract.golden_path_id
             WHERE gp.journey_id = cell.journey_id
           )
         )
         OR EXISTS (
           SELECT 1
           FROM golden_path_contract_versions contract
           JOIN golden_paths gp
             ON gp.id = contract.golden_path_id
           WHERE contract.id = $8
             AND contract.content_hash = $9
             AND contract.status = 'signed'
             AND gp.journey_id = cell.journey_id
             AND NOT EXISTS (
               SELECT 1
               FROM golden_path_contract_versions other_contract
               JOIN golden_paths other_gp
                 ON other_gp.id = other_contract.golden_path_id
               WHERE other_gp.journey_id = cell.journey_id
                 AND other_contract.golden_path_id
                     <> contract.golden_path_id
             )
         )
       )
     ON CONFLICT (run_id, journey_step_link_id) DO NOTHING
     RETURNING *`,
    values,
  );
  return rows[0] ?? null;
}

export async function inShortTransaction(pool, beginSql, work) {
  if (typeof pool?.connect !== 'function') return work(pool);
  const client = await pool.connect();
  let open = false;
  try {
    await client.query(beginSql);
    open = true;
    const result = await work(client);
    await client.query('COMMIT');
    open = false;
    return result;
  } catch (error) {
    if (open) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the fail-closed root cause.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
