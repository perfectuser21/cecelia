import { validateContractArtifacts } from './contract-artifacts.js';

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
  artifacts,
  approvedAt = new Date(),
}) {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`invalid approved contract version: ${version}`);
  }
  if (typeof branch !== 'string' || !branch) {
    throw new Error('approved contract branch is required');
  }
  const artifactsProvided = artifacts !== undefined;
  const frozenArtifacts = artifactsProvided
    ? validateContractArtifacts(artifacts, { requireTests: true })
    : [];

  const { rows } = await db.query(
    `WITH run_row AS (
       SELECT initiative_id
         FROM initiative_runs
        WHERE id = $1::uuid
        FOR UPDATE
     ), approved_contract AS (
       INSERT INTO initiative_contracts
         (initiative_id, version, status, prd_content, contract_content,
          review_rounds, approved_at, branch, created_at, updated_at)
       SELECT initiative_id, $2::integer, 'approved', $4::text, $5::text,
              $2::integer, $6::timestamptz, $3::text, $6::timestamptz, $6::timestamptz
         FROM run_row
       ON CONFLICT (initiative_id, version) DO UPDATE
         SET status = 'approved',
             prd_content = COALESCE(EXCLUDED.prd_content, initiative_contracts.prd_content),
             contract_content = COALESCE(EXCLUDED.contract_content, initiative_contracts.contract_content),
             review_rounds = GREATEST(initiative_contracts.review_rounds, EXCLUDED.review_rounds),
             approved_at = EXCLUDED.approved_at,
             branch = EXCLUDED.branch,
             updated_at = EXCLUDED.updated_at
       RETURNING id, initiative_id, version, status, branch
     ), artifact_input AS (
       SELECT path, content, sha256, byte_length, source_revision
         FROM jsonb_to_recordset($7::jsonb) AS input(
           path text,
           content text,
           sha256 text,
           byte_length integer,
           source_revision text
         )
     ), artifact_guard AS (
       SELECT 1 / CASE WHEN $8::boolean AND EXISTS (
         SELECT 1
           FROM approved_contract AS approved
          WHERE EXISTS (
            SELECT 1 FROM initiative_contract_artifacts AS existing
             WHERE existing.contract_id = approved.id
          )
            AND (
              (SELECT count(*) FROM initiative_contract_artifacts AS existing
                WHERE existing.contract_id = approved.id)
                <> (SELECT count(*) FROM artifact_input)
              OR EXISTS (
                SELECT 1
                  FROM initiative_contract_artifacts AS existing
                  FULL JOIN artifact_input AS input USING (path)
                 WHERE existing.contract_id = approved.id
                   AND (
                     input.path IS NULL
                     OR existing.path IS NULL
                     OR existing.content IS DISTINCT FROM input.content
                     OR existing.sha256 IS DISTINCT FROM input.sha256
                     OR existing.byte_length IS DISTINCT FROM input.byte_length
                     OR existing.source_revision IS DISTINCT FROM input.source_revision
                   )
              )
            )
       ) THEN 0 ELSE 1 END AS ok
     ), persisted_artifacts AS (
       INSERT INTO initiative_contract_artifacts
         (contract_id, path, content, sha256, byte_length, source_revision, created_at)
       SELECT approved.id, input.path, input.content, input.sha256,
              input.byte_length, input.source_revision, $6::timestamptz
         FROM approved_contract AS approved
         CROSS JOIN artifact_input AS input
         CROSS JOIN artifact_guard
       ON CONFLICT (contract_id, path) DO NOTHING
       RETURNING contract_id, path
     ), superseded AS (
       UPDATE initiative_contracts AS prior
          SET status = 'superseded', updated_at = $6::timestamptz
         FROM approved_contract AS approved
        WHERE prior.initiative_id = approved.initiative_id
          AND prior.id <> approved.id
          AND prior.status <> 'superseded'
     )
     UPDATE initiative_runs AS run
        SET contract_id = approved.id, updated_at = $6::timestamptz
       FROM approved_contract AS approved
       CROSS JOIN artifact_guard
      WHERE run.id = $1::uuid
     RETURNING approved.id, approved.version, approved.status, approved.branch`,
    [
      runId,
      version,
      branch,
      prdContent ?? null,
      contractContent ?? null,
      approvedAt,
      JSON.stringify(frozenArtifacts),
      artifactsProvided,
    ],
  );

  if (!rows[0]) {
    throw new Error(`cannot materialize approved contract: run ${runId} not found`);
  }
  return rows[0];
}
