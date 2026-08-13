import {
  contractArtifactManifestDigest,
  validateContractArtifacts,
} from './contract-artifacts.js';

function assertArtifactProjection(artifacts, prdContent, contractContent) {
  const byPath = new Map(artifacts.map((artifact) => [artifact.path, artifact.content]));
  const draftPath = artifacts.find(({ path }) => path.endsWith('/contract-draft.md'))?.path;
  const root = draftPath?.slice(0, -'/contract-draft.md'.length);
  const expectedPrd = byPath.get(`${root}/sprint-prd.md`);
  const expectedContract = `${byPath.get(`${root}/contract-draft.md`)}\n\n${byPath.get(`${root}/contract-dod.md`)}`;
  if (prdContent !== expectedPrd || contractContent !== expectedContract) {
    throw new Error('FROZEN_CONTRACT_ARTIFACT_INVALID:contract_projection');
  }
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
    ? validateContractArtifacts(artifacts, { requireTests: true, requireCore: true })
    : [];
  if (artifactsProvided) assertArtifactProjection(frozenArtifacts, prdContent, contractContent);
  const manifestDigest = artifactsProvided
    ? contractArtifactManifestDigest(frozenArtifacts)
    : null;
  const sourceRevision = artifactsProvided ? frozenArtifacts[0].source_revision : null;
  const ownsClient = typeof db.connect === 'function' && typeof db.release !== 'function';
  const client = ownsClient ? await db.connect() : db;

  try {
    if (ownsClient) await client.query('BEGIN');
    // Lock the initiative in a separate statement. PostgreSQL fixes a statement
    // snapshot before a contended lock returns, so version allocation must use
    // a later statement and a fresh snapshot.
    const runResult = await client.query(
      `SELECT run.initiative_id, run.contract_id
         FROM initiative_runs AS run
         JOIN tasks AS task ON task.id = run.initiative_id
        WHERE run.id = $1::uuid
        FOR UPDATE OF run, task`,
      [runId],
    );
    const run = runResult.rows[0];
    if (!run) {
      throw new Error(`cannot materialize approved contract: run ${runId} not found`);
    }
    if (run.contract_id) {
      const existing = await client.query(
        `SELECT contract.id, contract.version, contract.status, contract.branch,
                contract.approved_sha IS NOT DISTINCT FROM $2::text
                  AND contract.review_rounds = $3::integer
                  AND contract.branch = $4::text
                  AND contract.prd_content IS NOT DISTINCT FROM $5::text
                  AND contract.contract_content IS NOT DISTINCT FROM $6::text
                  AND (
                    ($7::boolean = false AND seal.contract_id IS NULL)
                    OR ($7::boolean = true
                      AND seal.artifact_count = $8::integer
                      AND seal.manifest_sha256 = $9::text
                      AND seal.source_revision = $2::text)
                  ) AS evidence_matches
           FROM initiative_contracts AS contract
           LEFT JOIN initiative_contract_artifact_seals AS seal
             ON seal.contract_id = contract.id
          WHERE contract.id = $1::uuid`,
        [
          run.contract_id,
          sourceRevision,
          version,
          branch,
          prdContent ?? null,
          contractContent ?? null,
          artifactsProvided,
          frozenArtifacts.length,
          manifestDigest,
        ],
      );
      if (!existing.rows[0]) {
        throw new Error(`attached approved contract ${run.contract_id} not found`);
      }
      const attached = existing.rows[0];
      // 状态机守卫（fail-closed）：附着合同只有 draft（可原子换版）与 approved（幂等/mismatch
      // 比对）两态是合法可继续的。superseded / 未知状态附着若落到下方 draft 换版插入路径，会把
      // 已作废合同「重激活」成新 approved（复活废弃合同证据，安全红线）——一律报错，事务回滚。
      if (attached.status !== 'approved' && attached.status !== 'draft') {
        throw new Error(
          `invalid_attached_contract_status: 附着合同状态 '${attached.status}' 不得重激活`
          + `（仅 draft 可原子换版；approved 走幂等/mismatch；superseded/未知一律拒绝）`,
        );
      }
      // ATOMIC_RESWAP_ON_DRAFT: reopen_gan_contract 后 run.contract_id 可能仍附着一份
      // v1 draft 合同（旧草稿），它不是「本轮批准证据」。只有附着合同已是 approved
      // 时才走逐字段比对 + fail-closed（禁止静默覆盖已批准合同，安全红线）。
      // 附着为 draft（或其他非 approved 态）时不比对，落到下方插入路径原子换版：
      // 单事务内插 v2 approved + 置 v1 superseded + run.contract_id 切 v2，
      // 修复 reopen 后把 draft 附件误判为已批准证据而抛 mismatch 的 run 死锁。
      if (attached.status === 'approved') {
        if (!attached.evidence_matches) {
          throw new Error(`attached approved contract evidence mismatch for run ${runId}`);
        }
        delete attached.evidence_matches;
        if (ownsClient) await client.query('COMMIT');
        return attached;
      }
      // draft 附着 → 不 return，继续走原子换版插入路径（run.contract_id 将被切到 v2）。
    }

    const versionResult = await client.query(
      `SELECT CASE
                WHEN bool_or(existing.version = $2::integer AND existing.status = 'draft')
                  THEN $2::integer
                ELSE GREATEST($2::integer, COALESCE(MAX(existing.version), 0) + 1)
              END AS version
         FROM initiative_contracts AS existing
        WHERE existing.initiative_id = $1::uuid`,
      [run.initiative_id, version],
    );
    const storedVersion = versionResult.rows[0].version;

    const { rows } = await client.query(
    `WITH run_row AS (
       SELECT initiative_id
         FROM initiative_runs
        WHERE id = $1::uuid
        FOR UPDATE
     ), approved_contract AS (
       INSERT INTO initiative_contracts
         (initiative_id, version, status, prd_content, contract_content,
          approved_sha, review_rounds, approved_at, branch,
          created_at, updated_at)
       SELECT initiative_id, $11::integer, 'approved', $4::text, $5::text,
              $10::text, $2::integer, $6::timestamptz, $3::text,
              $6::timestamptz, $6::timestamptz
         FROM run_row
       ON CONFLICT (initiative_id, version) DO UPDATE
         SET status = CASE
               WHEN initiative_contracts.status = 'draft' THEN 'approved'
               ELSE initiative_contracts.status
             END,
             prd_content = COALESCE(EXCLUDED.prd_content, initiative_contracts.prd_content),
             contract_content = COALESCE(EXCLUDED.contract_content, initiative_contracts.contract_content),
             approved_sha = COALESCE(initiative_contracts.approved_sha, EXCLUDED.approved_sha),
             review_rounds = GREATEST(initiative_contracts.review_rounds, EXCLUDED.review_rounds),
             approved_at = COALESCE(initiative_contracts.approved_at, EXCLUDED.approved_at),
             branch = COALESCE(initiative_contracts.branch, EXCLUDED.branch),
             updated_at = CASE
               WHEN initiative_contracts.status = 'draft' THEN EXCLUDED.updated_at
               ELSE initiative_contracts.updated_at
             END
       WHERE initiative_contracts.status IN ('draft', 'approved')
         AND (initiative_contracts.branch IS NULL
           OR initiative_contracts.branch = EXCLUDED.branch)
         AND (initiative_contracts.prd_content IS NULL
           OR initiative_contracts.prd_content IS NOT DISTINCT FROM EXCLUDED.prd_content)
         AND (initiative_contracts.contract_content IS NULL
           OR initiative_contracts.contract_content IS NOT DISTINCT FROM EXCLUDED.contract_content)
         AND (initiative_contracts.approved_sha IS NULL
           OR initiative_contracts.approved_sha IS NOT DISTINCT FROM EXCLUDED.approved_sha)
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
        WHERE NOT EXISTS (
          SELECT 1 FROM initiative_contract_artifact_seals AS seal
           WHERE seal.contract_id = approved.id
        )
       ON CONFLICT (contract_id, path) DO NOTHING
       RETURNING contract_id, path
     ), persisted_artifact_barrier AS (
       SELECT count(*) AS inserted_count FROM persisted_artifacts
     ), persisted_seal AS (
       INSERT INTO initiative_contract_artifact_seals
         (contract_id, artifact_count, manifest_sha256, source_revision, sealed_at)
       SELECT approved.id, (SELECT count(*) FROM artifact_input),
              $9::text, $10::text, $6::timestamptz
         FROM approved_contract AS approved
         CROSS JOIN artifact_guard
         CROSS JOIN persisted_artifact_barrier
        WHERE $8::boolean
       ON CONFLICT (contract_id) DO NOTHING
       RETURNING contract_id
     ), seal_guard AS (
       SELECT 1 / CASE WHEN $8::boolean AND EXISTS (
         SELECT 1
           FROM approved_contract AS approved
           JOIN initiative_contract_artifact_seals AS seal
             ON seal.contract_id = approved.id
          WHERE seal.artifact_count <> (SELECT count(*) FROM artifact_input)
             OR seal.manifest_sha256 <> $9::text
             OR seal.source_revision <> $10::text
       ) THEN 0 ELSE 1 END AS ok
     ), superseded AS (
       UPDATE initiative_contracts AS prior
          SET status = 'superseded', updated_at = $6::timestamptz
         FROM approved_contract AS approved
         CROSS JOIN seal_guard
        WHERE prior.initiative_id = approved.initiative_id
          AND prior.id <> approved.id
          AND prior.status <> 'superseded'
     )
     UPDATE initiative_runs AS run
        SET contract_id = approved.id, updated_at = $6::timestamptz
       FROM approved_contract AS approved
       CROSS JOIN artifact_guard
       CROSS JOIN seal_guard
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
      manifestDigest,
      sourceRevision,
      storedVersion,
    ],
  );

    if (!rows[0]) {
      const diagnostic = await client.query(
        `SELECT 1
           FROM initiative_contracts AS contract
           JOIN initiative_runs AS run ON run.initiative_id = contract.initiative_id
          WHERE run.id = $1::uuid AND contract.version = $2::integer`,
        [runId, storedVersion],
      );
      if (diagnostic.rows[0]) {
        throw new Error('approved_contract_immutable_mismatch');
      }
      throw new Error(`cannot materialize approved contract: run ${runId} not found`);
    }
    if (ownsClient) await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    if (ownsClient) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the materialization root cause; the pool discards broken clients.
      }
    }
    if (error?.code === '22012') {
      const artifactError = new Error('FROZEN_CONTRACT_ARTIFACT_INVALID:seal_mismatch', {
        cause: error,
      });
      artifactError.code = 'FROZEN_CONTRACT_ARTIFACT_INVALID';
      throw artifactError;
    }
    throw error;
  } finally {
    if (ownsClient) client.release();
  }
}
