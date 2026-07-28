import {
  ReleaseRunError,
  nextReleaseState,
  normalizeArtifactVersions,
  sameArtifactVersions,
  validateReleaseIdentity,
} from './release-run-contract.js';
import {
  createRequiredE2EManifest,
  validateRequiredE2EManifest,
} from './release-run-e2e.js';
import { isDeepStrictEqual } from 'node:util';

const RELEASE_LEASE_KEY = 'kernel-release/global';

function deny(code) {
  throw new ReleaseRunError(code);
}

function asJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function sameIdentity(row, identity) {
  return row
    && row.run_id === identity.run_id
    && row.task_id === identity.task_id
    && row.merge_intent_id === identity.merge_intent_id
    && row.merge_receipt_id === identity.merge_receipt_id
    && row.repository === identity.repository
    && Number(row.pr_number) === identity.pr_number
    && row.source_head_sha === identity.source_head_sha
    && row.merge_sha === identity.merge_sha
    && row.policy_version === identity.policy_version
    && sameArtifactVersions(asJson(row.artifact_versions), identity.artifact_versions);
}

function releaseFromRow(row) {
  if (!row) return null;
  let e2eManifest = row.e2e_manifest ?? null;
  if (!e2eManifest && row.e2e_manifest_id) {
    e2eManifest = {
      id: row.e2e_manifest_id,
      release_run_id: row.id,
      run_id: row.run_id,
      repository: row.repository,
      contract_id: row.e2e_contract_id,
      contract_version: Number(row.e2e_contract_version),
      contract_approved_at: new Date(row.e2e_contract_approved_at).toISOString(),
      contract_digest: row.e2e_contract_digest,
      merge_sha: row.e2e_merge_sha,
      policy_version: row.e2e_policy_version,
      artifact_versions: asJson(row.e2e_artifact_versions),
      artifact_set_digest: row.e2e_artifact_set_digest,
      e2e_acceptance: asJson(row.e2e_acceptance),
      e2e_acceptance_digest: row.e2e_acceptance_digest,
      scenarios_total: Number(row.e2e_scenarios_total),
      manifest_digest: row.e2e_manifest_digest,
    };
  }
  if (e2eManifest) {
    const { id, ...manifest } = e2eManifest;
    e2eManifest = {
      id,
      ...validateRequiredE2EManifest(manifest, {
        release_run_id: row.id,
        run_id: row.run_id,
        repository: row.repository,
        merge_sha: row.merge_sha,
        artifact_versions: asJson(row.artifact_versions),
      }),
    };
  }
  return {
    ...row,
    pr_number: Number(row.pr_number),
    artifact_versions: normalizeArtifactVersions(asJson(row.artifact_versions)),
    transition_evidence: asJson(row.transition_evidence) ?? {},
    e2e_manifest: e2eManifest,
  };
}

export function createPostgresReleaseRunStore(pool) {
  return Object.freeze({
    async withReleaseLease(callback) {
      const client = await pool.connect();
      let locked = false;
      try {
        await client.query(
          'SELECT pg_advisory_lock(hashtextextended($1::text, 0))',
          [RELEASE_LEASE_KEY],
        );
        locked = true;
        return await callback(client);
      } finally {
        try {
          if (locked) {
            await client.query(
              'SELECT pg_advisory_unlock(hashtextextended($1::text, 0)) AS unlocked',
              [RELEASE_LEASE_KEY],
            );
          }
        } finally {
          client.release();
        }
      }
    },

    async loadMergeAuthority(client, { runId, taskId }) {
      const { rows } = await client.query(
        `SELECT auth.run_id,
                auth.task_id,
                intent.id AS merge_intent_id,
                receipt.id AS merge_receipt_id,
                auth.repository,
                auth.pr_number,
                intent.requested_head_sha AS source_head_sha,
                receipt.evidence->>'merge_commit_sha' AS merge_sha
           FROM kernel_merge_effect_intents intent
           JOIN kernel_merge_authorizations auth
             ON auth.id = intent.authorization_id
           JOIN kernel_merge_effect_receipts receipt
             ON receipt.intent_id = intent.id
            AND receipt.receipt_status = 'confirmed'
            AND receipt.merged = TRUE
            AND receipt.observed_head_sha = intent.requested_head_sha
          WHERE auth.run_id = $1
            AND auth.task_id = $2
          ORDER BY receipt.observed_at DESC
          LIMIT 1`,
        [runId, taskId],
      );
      const row = rows[0];
      if (!row) deny('release_merge_receipt_missing');
      if (!/^[0-9a-f]{40}$/.test(row.source_head_sha ?? '')) {
        deny('release_merge_head_invalid');
      }
      if (!/^[0-9a-f]{40}$/.test(row.merge_sha ?? '')) {
        deny('release_merge_commit_invalid');
      }
      return {
        ...row,
        pr_number: Number(row.pr_number),
      };
    },

    async loadRelease(client, { runId }) {
      const { rows } = await client.query(
        `SELECT release.*,
                manifest.id AS e2e_manifest_id,
                manifest.contract_id AS e2e_contract_id,
                manifest.contract_version AS e2e_contract_version,
                manifest.contract_approved_at AS e2e_contract_approved_at,
                manifest.contract_digest AS e2e_contract_digest,
                manifest.merge_sha AS e2e_merge_sha,
                manifest.policy_version AS e2e_policy_version,
                manifest.artifact_versions AS e2e_artifact_versions,
                manifest.artifact_set_digest AS e2e_artifact_set_digest,
                manifest.e2e_acceptance,
                manifest.e2e_acceptance_digest,
                manifest.scenarios_total AS e2e_scenarios_total,
                manifest.manifest_digest AS e2e_manifest_digest,
                transition.state,
                transition.evidence AS transition_evidence
           FROM kernel_release_runs release
           LEFT JOIN kernel_release_e2e_manifests manifest
             ON manifest.release_run_id = release.id
           LEFT JOIN LATERAL (
             SELECT state, evidence
               FROM kernel_release_transitions
              WHERE release_run_id = release.id
              ORDER BY append_seq DESC
              LIMIT 1
           ) transition ON TRUE
          WHERE release.run_id = $1`,
        [runId],
      );
      return releaseFromRow(rows[0]);
    },

    async createRelease(client, rawIdentity) {
      const identity = validateReleaseIdentity(rawIdentity);
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO kernel_release_runs
             (run_id, task_id, merge_intent_id, merge_receipt_id, repository,
              pr_number, source_head_sha, merge_sha, artifact_versions, policy_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
           ON CONFLICT (run_id) DO NOTHING`,
          [
            identity.run_id,
            identity.task_id,
            identity.merge_intent_id,
            identity.merge_receipt_id,
            identity.repository,
            identity.pr_number,
            identity.source_head_sha,
            identity.merge_sha,
            JSON.stringify(identity.artifact_versions),
            identity.policy_version,
          ],
        );
        const selected = await client.query(
          'SELECT * FROM kernel_release_runs WHERE run_id = $1',
          [identity.run_id],
        );
        const row = selected.rows[0];
        if (!sameIdentity(row, identity)) deny('release_identity_conflict');
        const contract = await client.query(
          `SELECT run.contract_id,
                  contract.version AS contract_version,
                  contract.approved_at AS contract_approved_at,
                  contract.contract_content,
                  contract.e2e_acceptance
             FROM initiative_runs run
             JOIN initiative_contracts contract
               ON contract.id = run.contract_id
              AND contract.status = 'approved'
            WHERE run.id = $1
              AND contract.approved_at IS NOT NULL
              AND contract.contract_content IS NOT NULL
              AND contract.e2e_acceptance IS NOT NULL`,
          [identity.run_id],
        );
        if (!contract.rows[0]) deny('release_e2e_manifest_authority_missing');
        const manifest = createRequiredE2EManifest({
          release_run_id: row.id,
          run_id: identity.run_id,
          repository: identity.repository,
          merge_sha: identity.merge_sha,
          artifact_versions: identity.artifact_versions,
          contract: {
            id: contract.rows[0].contract_id,
            version: Number(contract.rows[0].contract_version),
            approved_at: new Date(contract.rows[0].contract_approved_at).toISOString(),
            contract_content: contract.rows[0].contract_content,
            e2e_acceptance: asJson(contract.rows[0].e2e_acceptance),
          },
        });
        await client.query(
          `INSERT INTO kernel_release_e2e_manifests
             (release_run_id, run_id, repository, merge_sha,
              artifact_versions, artifact_set_digest, contract_id,
              contract_version, contract_approved_at, contract_content,
              contract_digest, policy_version, e2e_acceptance,
              e2e_acceptance_digest, scenarios_total, manifest_digest)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10,
                   $11, $12, $13::jsonb, $14, $15, $16)
           ON CONFLICT (release_run_id) DO NOTHING`,
          [
            manifest.release_run_id,
            manifest.run_id,
            manifest.repository,
            manifest.merge_sha,
            JSON.stringify(manifest.artifact_versions),
            manifest.artifact_set_digest,
            manifest.contract_id,
            manifest.contract_version,
            manifest.contract_approved_at,
            contract.rows[0].contract_content,
            manifest.contract_digest,
            manifest.policy_version,
            JSON.stringify(manifest.e2e_acceptance),
            manifest.e2e_acceptance_digest,
            manifest.scenarios_total,
            manifest.manifest_digest,
          ],
        );
        const persistedManifest = await client.query(
          `SELECT id, release_run_id, run_id, repository, contract_id, merge_sha,
                  artifact_versions, artifact_set_digest, contract_version,
                  contract_approved_at, contract_digest, policy_version,
                  e2e_acceptance, e2e_acceptance_digest, scenarios_total,
                  manifest_digest
             FROM kernel_release_e2e_manifests
            WHERE release_run_id = $1`,
          [row.id],
        );
        const manifestRow = persistedManifest.rows[0];
        if (!manifestRow) deny('release_e2e_manifest_missing');
        const { id: manifestId, ...persistedManifestValue } = manifestRow;
        const verifiedManifest = validateRequiredE2EManifest({
          ...persistedManifestValue,
          contract_version: Number(persistedManifestValue.contract_version),
          contract_approved_at: new Date(
            persistedManifestValue.contract_approved_at,
          ).toISOString(),
          artifact_versions: asJson(persistedManifestValue.artifact_versions),
          e2e_acceptance: asJson(persistedManifestValue.e2e_acceptance),
          scenarios_total: Number(persistedManifestValue.scenarios_total),
        }, {
          release_run_id: row.id,
          run_id: identity.run_id,
          repository: identity.repository,
          contract_id: manifest.contract_id,
          contract_version: manifest.contract_version,
          contract_approved_at: manifest.contract_approved_at,
          contract_digest: manifest.contract_digest,
          e2e_acceptance_digest: manifest.e2e_acceptance_digest,
          merge_sha: identity.merge_sha,
          artifact_versions: identity.artifact_versions,
        });
        if (verifiedManifest.manifest_digest !== manifest.manifest_digest) {
          deny('release_e2e_manifest_conflict');
        }
        await client.query(
          `INSERT INTO kernel_release_transitions
             (release_run_id, state, evidence)
           VALUES ($1, 'merged', $2::jsonb)
           ON CONFLICT (release_run_id, state) DO NOTHING`,
          [row.id, JSON.stringify({ merge_sha: identity.merge_sha })],
        );
        await client.query('COMMIT');
        const transition = await client.query(
          `SELECT transition.state,
                  transition.evidence AS transition_evidence
             FROM kernel_release_transitions transition
            WHERE transition.release_run_id = $1
            ORDER BY transition.append_seq DESC
            LIMIT 1`,
          [row.id],
        );
        return releaseFromRow({
          ...row,
          ...(transition.rows[0] ?? {}),
          e2e_manifest: {
            id: manifestId,
            ...verifiedManifest,
          },
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    },

    async appendTransition(client, { releaseRunId, currentState, state, evidence = {} }) {
      if (state === currentState) return { state, evidence };
      if (nextReleaseState(currentState) !== state) deny('release_transition_invalid');
      await client.query(
        `INSERT INTO kernel_release_transitions
           (release_run_id, state, evidence)
         VALUES ($1, $2, $3::jsonb)`,
        [releaseRunId, state, JSON.stringify(evidence)],
      );
      return { state, evidence };
    },

    async findOrCreateIntent(client, { releaseRun, effectKind }) {
      if (!['staging', 'production'].includes(effectKind)) {
        deny('release_effect_kind_invalid');
      }
      await client.query(
        `INSERT INTO kernel_release_effect_intents
           (release_run_id, effect_kind, expected_merge_sha, expected_artifact_versions)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (release_run_id, effect_kind) DO NOTHING`,
        [
          releaseRun.id,
          effectKind,
          releaseRun.merge_sha,
          JSON.stringify(releaseRun.artifact_versions),
        ],
      );
      const { rows } = await client.query(
        `SELECT intent.*,
                confirmed.id AS confirmed_receipt,
                latest.receipt_status AS last_receipt_status
           FROM kernel_release_effect_intents intent
           LEFT JOIN LATERAL (
             SELECT id
               FROM kernel_release_effect_receipts
              WHERE intent_id = intent.id
                AND receipt_status = 'confirmed'
              ORDER BY append_seq DESC
              LIMIT 1
           ) confirmed ON TRUE
           LEFT JOIN LATERAL (
             SELECT receipt_status
               FROM kernel_release_effect_receipts
              WHERE intent_id = intent.id
              ORDER BY append_seq DESC
              LIMIT 1
           ) latest ON TRUE
          WHERE intent.release_run_id = $1
            AND intent.effect_kind = $2`,
        [releaseRun.id, effectKind],
      );
      const intent = rows[0];
      if (!intent) deny('release_effect_intent_missing');
      if (
        intent.expected_merge_sha !== releaseRun.merge_sha
        || !sameArtifactVersions(
          asJson(intent.expected_artifact_versions),
          releaseRun.artifact_versions,
        )
      ) {
        deny('release_effect_intent_conflict');
      }
      return {
        ...intent,
        expected_artifact_versions: normalizeArtifactVersions(
          asJson(intent.expected_artifact_versions),
        ),
      };
    },

    async findOrCreateRollbackIntent(client, { releaseRun }) {
      await client.query(
        `INSERT INTO kernel_release_rollback_intents
           (release_run_id, expected_merge_sha, expected_artifact_versions)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (release_run_id) DO NOTHING`,
        [
          releaseRun.id,
          releaseRun.merge_sha,
          JSON.stringify(releaseRun.artifact_versions),
        ],
      );
      const { rows } = await client.query(
        `SELECT *
           FROM kernel_release_rollback_intents
          WHERE release_run_id = $1`,
        [releaseRun.id],
      );
      const intent = rows[0];
      if (
        !intent
        || intent.expected_merge_sha !== releaseRun.merge_sha
        || !sameArtifactVersions(
          asJson(intent.expected_artifact_versions),
          releaseRun.artifact_versions,
        )
      ) {
        deny('release_rollback_intent_conflict');
      }
      return {
        ...intent,
        expected_artifact_versions: normalizeArtifactVersions(
          asJson(intent.expected_artifact_versions),
        ),
      };
    },

    async appendRollbackReceipt(client, receipt) {
      const params = [
        receipt.rollback_intent_id,
        receipt.effect_receipt_id,
        receipt.anchor,
        receipt.previous_version,
        JSON.stringify(receipt.rollback_metadata),
      ];
      let result = await client.query(
        `INSERT INTO kernel_release_rollback_receipts
           (rollback_intent_id, effect_receipt_id, anchor, previous_version,
            rollback_metadata)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (rollback_intent_id) DO NOTHING
         RETURNING *`,
        params,
      );
      if (!result.rows[0]) {
        result = await client.query(
          `SELECT *
             FROM kernel_release_rollback_receipts
            WHERE rollback_intent_id = $1`,
          [receipt.rollback_intent_id],
        );
      }
      const persisted = result.rows[0];
      if (
        !persisted
        || String(persisted.effect_receipt_id) !== String(receipt.effect_receipt_id)
        || persisted.anchor !== receipt.anchor
        || persisted.previous_version !== receipt.previous_version
        || !isDeepStrictEqual(
          asJson(persisted.rollback_metadata),
          receipt.rollback_metadata,
        )
      ) {
        deny('release_rollback_receipt_conflict');
      }
      return {
        ...persisted,
        rollback_metadata: asJson(persisted.rollback_metadata),
      };
    },

    async appendReceipt(client, receipt) {
      const params = [
        receipt.intent_id,
        receipt.receipt_status,
        receipt.observed_merge_sha ?? null,
        receipt.observed_artifact_versions == null
          ? null
          : JSON.stringify(receipt.observed_artifact_versions),
        receipt.dispatch_claim_id ?? null,
        receipt.dispatch_generation ?? null,
        receipt.e2e_manifest_id ?? null,
        receipt.e2e_manifest_digest ?? null,
        receipt.e2e_scenarios_total ?? null,
        receipt.e2e_scenarios_passed ?? null,
        receipt.e2e_environment ?? null,
        receipt.e2e_scenario_results == null
          ? null
          : JSON.stringify(receipt.e2e_scenario_results),
        receipt.e2e_started_at ?? null,
        receipt.e2e_finished_at ?? null,
        JSON.stringify(receipt.evidence ?? {}),
      ];
      const baseSql = `INSERT INTO kernel_release_effect_receipts
         (intent_id, receipt_status, observed_merge_sha,
          observed_artifact_versions, dispatch_claim_id, dispatch_generation,
          e2e_manifest_id, e2e_manifest_digest,
          e2e_scenarios_total, e2e_scenarios_passed, e2e_environment,
          e2e_scenario_results, e2e_started_at, e2e_finished_at, evidence)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11,
               $12::jsonb, $13, $14, $15::jsonb)
       RETURNING id`;
      let result;
      if (receipt.receipt_status === 'confirmed') {
        result = await client.query(
          `${baseSql.slice(0, -'RETURNING id'.length)}
           ON CONFLICT (intent_id) WHERE receipt_status = 'confirmed' DO NOTHING
           RETURNING id`,
          params,
        );
        if (!result.rows[0]) {
          result = await client.query(
            `SELECT id
               FROM kernel_release_effect_receipts
              WHERE intent_id = $1
                AND receipt_status = 'confirmed'`,
            [receipt.intent_id],
          );
        }
      } else {
        result = await client.query(baseSql, params);
      }
      return { id: result.rows[0]?.id ?? null, ...receipt };
    },
  });
}

export const __test__ = {
  RELEASE_LEASE_KEY,
  asJson,
  sameIdentity,
};
