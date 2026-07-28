import {
  ReleaseRunError,
  nextReleaseState,
  normalizeArtifactVersions,
  sameArtifactVersions,
  validateReleaseIdentity,
} from './release-run-contract.js';

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
  return {
    ...row,
    pr_number: Number(row.pr_number),
    artifact_versions: normalizeArtifactVersions(asJson(row.artifact_versions)),
    transition_evidence: asJson(row.transition_evidence) ?? {},
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
                transition.state,
                transition.evidence AS transition_evidence
           FROM kernel_release_runs release
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
        return releaseFromRow({ ...row, ...(transition.rows[0] ?? {}) });
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

    async appendReceipt(client, receipt) {
      const params = [
        receipt.intent_id,
        receipt.receipt_status,
        receipt.observed_merge_sha ?? null,
        receipt.observed_artifact_versions == null
          ? null
          : JSON.stringify(receipt.observed_artifact_versions),
        JSON.stringify(receipt.evidence ?? {}),
      ];
      const baseSql = `INSERT INTO kernel_release_effect_receipts
         (intent_id, receipt_status, observed_merge_sha,
          observed_artifact_versions, evidence)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`;
      if (receipt.receipt_status === 'confirmed') {
        await client.query(
          `${baseSql}
           ON CONFLICT (intent_id) WHERE receipt_status = 'confirmed' DO NOTHING`,
          params,
        );
      } else {
        await client.query(baseSql, params);
      }
      return receipt;
    },
  });
}

export const __test__ = {
  RELEASE_LEASE_KEY,
  asJson,
  sameIdentity,
};
