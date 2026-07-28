import { ReleaseRunError, normalizeArtifactVersions } from './release-run-contract.js';
import {
  createRequiredE2EManifest,
  executeRequiredE2EManifest,
  validateRequiredE2EManifest,
} from './release-run-e2e.js';

function deny(code) {
  throw new ReleaseRunError(code);
}

function asJson(value) {
  if (typeof value === 'object' && value !== null) return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function bootstrapManifestFromRow(row, expected = {}) {
  if (!row) deny('release_bootstrap_e2e_manifest_missing');
  const manifest = {
    release_run_id: row.bootstrap_run_id,
    run_id: row.run_id,
    repository: row.repository,
    merge_sha: row.merge_sha,
    artifact_versions: asJson(row.artifact_versions),
    artifact_set_digest: row.artifact_set_digest,
    contract_id: row.contract_id,
    contract_version: Number(row.contract_version),
    contract_approved_at: new Date(row.contract_approved_at).toISOString(),
    contract_digest: row.contract_digest,
    policy_version: row.policy_version,
    e2e_acceptance: asJson(row.e2e_acceptance),
    e2e_acceptance_digest: row.e2e_acceptance_digest,
    scenarios_total: Number(row.scenarios_total),
    manifest_digest: row.manifest_digest,
  };
  return {
    id: row.id,
    ...validateRequiredE2EManifest(manifest, {
      release_run_id: row.bootstrap_run_id,
      ...expected,
    }),
  };
}

const SELECT_BOOTSTRAP_MANIFEST = `
  SELECT id, bootstrap_run_id, run_id, repository, contract_id, merge_sha,
         artifact_versions, artifact_set_digest, contract_version,
         contract_approved_at, contract_digest, policy_version,
         e2e_acceptance, e2e_acceptance_digest, scenarios_total,
         manifest_digest
    FROM kernel_release_bootstrap_e2e_manifests
   WHERE bootstrap_run_id = $1`;

export async function loadBootstrapE2EManifest(client, {
  bootstrap_run_id: bootstrapRunId,
  ...expected
}) {
  const { rows } = await client.query(SELECT_BOOTSTRAP_MANIFEST, [bootstrapRunId]);
  return bootstrapManifestFromRow(rows[0], expected);
}

export async function materializeBootstrapE2EManifest(client, {
  bootstrap_run_id: bootstrapRunId,
  repository,
  source_head_sha: sourceHeadSha,
  merge_sha: mergeSha,
  artifact_versions: rawArtifactVersions,
}) {
  const artifactVersions = normalizeArtifactVersions(rawArtifactVersions);
  await client.query('BEGIN');
  try {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      [`kernel-release/bootstrap/${bootstrapRunId}`],
    );
    const { rows } = await client.query(
      `SELECT bootstrap.id AS bootstrap_run_id,
              run.id AS run_id,
              bootstrap.repository,
              bootstrap.source_head_sha,
              bootstrap.merge_sha,
              contract.id AS contract_id,
              contract.version AS contract_version,
              contract.approved_at AS contract_approved_at,
              contract.contract_content,
              contract.e2e_acceptance
         FROM kernel_release_bootstrap_runs bootstrap
         JOIN kernel_merge_authorizations auth
           ON auth.repository = bootstrap.repository
          AND auth.pr_number = bootstrap.pr_number
          AND auth.head_sha = bootstrap.source_head_sha
         JOIN kernel_merge_effect_intents intent
           ON intent.authorization_id = auth.id
          AND intent.run_id = auth.run_id
          AND intent.requested_head_sha = auth.head_sha
         JOIN kernel_merge_effect_receipts receipt
           ON receipt.intent_id = intent.id
          AND receipt.receipt_status = 'confirmed'
          AND receipt.merged = TRUE
          AND receipt.observed_head_sha = intent.requested_head_sha
          AND receipt.evidence->>'merge_commit_sha' = bootstrap.merge_sha
         JOIN initiative_runs run
           ON run.id = auth.run_id
         JOIN initiative_contracts contract
           ON contract.id = run.contract_id
          AND contract.status = 'approved'
          AND contract.approved_at IS NOT NULL
          AND contract.contract_content IS NOT NULL
          AND contract.e2e_acceptance IS NOT NULL
        WHERE bootstrap.id = $1
          AND bootstrap.repository = $2
          AND bootstrap.source_head_sha = $3
          AND bootstrap.merge_sha = $4
        FOR SHARE OF bootstrap, auth, intent, receipt, run, contract`,
      [bootstrapRunId, repository, sourceHeadSha, mergeSha],
    );
    const authority = rows[0];
    if (!authority) deny('release_bootstrap_e2e_authority_missing');

    const manifest = createRequiredE2EManifest({
      release_run_id: bootstrapRunId,
      run_id: authority.run_id,
      repository,
      merge_sha: mergeSha,
      artifact_versions: artifactVersions,
      contract: {
        id: authority.contract_id,
        version: Number(authority.contract_version),
        approved_at: new Date(authority.contract_approved_at).toISOString(),
        contract_content: authority.contract_content,
        e2e_acceptance: asJson(authority.e2e_acceptance),
      },
    });
    await client.query(
      `INSERT INTO kernel_release_bootstrap_e2e_manifests
         (bootstrap_run_id, run_id, repository, merge_sha,
          artifact_versions, artifact_set_digest, contract_id,
          contract_version, contract_approved_at, contract_content,
          contract_digest, policy_version, e2e_acceptance,
          e2e_acceptance_digest, scenarios_total, manifest_digest)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10,
               $11, $12, $13::jsonb, $14, $15, $16)
       ON CONFLICT (bootstrap_run_id) DO NOTHING`,
      [
        bootstrapRunId,
        manifest.run_id,
        repository,
        mergeSha,
        JSON.stringify(manifest.artifact_versions),
        manifest.artifact_set_digest,
        manifest.contract_id,
        manifest.contract_version,
        manifest.contract_approved_at,
        authority.contract_content,
        manifest.contract_digest,
        manifest.policy_version,
        JSON.stringify(manifest.e2e_acceptance),
        manifest.e2e_acceptance_digest,
        manifest.scenarios_total,
        manifest.manifest_digest,
      ],
    );
    const persisted = await loadBootstrapE2EManifest(client, {
      bootstrap_run_id: bootstrapRunId,
      run_id: manifest.run_id,
      repository,
      merge_sha: mergeSha,
      artifact_versions: artifactVersions,
      contract_id: manifest.contract_id,
      contract_version: manifest.contract_version,
      contract_approved_at: manifest.contract_approved_at,
      contract_digest: manifest.contract_digest,
      e2e_acceptance_digest: manifest.e2e_acceptance_digest,
    });
    if (persisted.manifest_digest !== manifest.manifest_digest) {
      deny('release_bootstrap_e2e_manifest_conflict');
    }
    await client.query('COMMIT');
    return persisted;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function executeBootstrapE2EManifest(manifestWithId, {
  environment,
  artifact_readback: artifactReadback,
  fetchFn,
  endpoints,
  now,
}) {
  const { id: _manifestId, ...manifest } = manifestWithId;
  return executeRequiredE2EManifest(manifest, {
    environment,
    artifact_readback: artifactReadback,
    fetchFn,
    endpoints,
    now,
  });
}

export const __test__ = {
  bootstrapManifestFromRow,
};
