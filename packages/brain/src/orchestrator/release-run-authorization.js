import { ReleaseRunError } from './release-run-contract.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{40}$/i;
const REQUIRED_STATE = Object.freeze({
  staging: 'staging_running',
  production: 'production_deploying',
});

function deny(code) {
  throw new ReleaseRunError(code);
}

export async function authorizeReleaseEffect(pool, request) {
  const releaseRunId = request?.release_run_id;
  const mergeSha = request?.merge_sha;
  const idempotencyKey = request?.release_authorization;
  const effectKind = request?.effect_kind;
  if (
    !UUID_RE.test(releaseRunId ?? '')
    || !SHA_RE.test(mergeSha ?? '')
    || !UUID_RE.test(idempotencyKey ?? '')
    || !Object.hasOwn(REQUIRED_STATE, effectKind)
  ) {
    deny('release_effect_request_invalid');
  }

  const { rows } = await pool.query(
    `SELECT release.merge_sha,
            release.artifact_versions,
            transition.state,
            intent.effect_kind,
            intent.idempotency_key,
            intent.expected_merge_sha
       FROM kernel_release_runs release
       JOIN LATERAL (
         SELECT state
           FROM kernel_release_transitions
          WHERE release_run_id = release.id
          ORDER BY append_seq DESC
          LIMIT 1
       ) transition ON TRUE
       JOIN kernel_release_effect_intents intent
         ON intent.release_run_id = release.id
        AND intent.effect_kind = $2
      WHERE release.id = $1
        AND release.merge_sha = $3
        AND intent.expected_merge_sha = $3
        AND intent.idempotency_key = $4`,
    [releaseRunId, effectKind, mergeSha, idempotencyKey],
  );
  const row = rows[0];
  if (
    !row
    || row.state !== REQUIRED_STATE[effectKind]
    || row.merge_sha !== mergeSha
    || row.expected_merge_sha !== mergeSha
    || row.effect_kind !== effectKind
    || row.idempotency_key !== idempotencyKey
  ) {
    deny('release_effect_unauthorized');
  }
  return {
    authorized: true,
    release_run_id: releaseRunId,
    merge_sha: mergeSha,
    effect_kind: effectKind,
    idempotency_key: idempotencyKey,
    artifact_versions: row.artifact_versions,
  };
}

async function claimReleaseGeneration(pool, request, claimMode, claimOutcome = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      [
        request?.effect_kind === 'production'
          ? 'kernel-release/production-mutation/v1'
          : `kernel-release/effect/${request?.release_run_id ?? ''}/${request?.effect_kind ?? ''}`,
      ],
    );
    const authorization = await authorizeReleaseEffect(client, request);
    const claimed = await client.query(
      `WITH matching_intent AS (
         SELECT intent.*
           FROM kernel_release_effect_intents intent
          WHERE intent.release_run_id = $1
            AND intent.effect_kind = $2
            AND intent.idempotency_key = $3
       ),
       latest AS (
         SELECT claim.*,
                GREATEST(
                  claim.lease_expires_at,
                  COALESCE(MAX(renewal.lease_expires_at), claim.lease_expires_at)
                ) AS effective_lease_expires_at,
                outcome.id AS outcome_id
           FROM kernel_release_effect_dispatch_claims claim
           LEFT JOIN kernel_release_effect_dispatch_renewals renewal
             ON renewal.dispatch_claim_id = claim.id
            AND renewal.generation = claim.generation
           LEFT JOIN kernel_release_effect_dispatch_outcomes outcome
             ON outcome.dispatch_claim_id = claim.id
          WHERE claim.intent_id = (SELECT id FROM matching_intent)
          GROUP BY claim.id, outcome.id
          ORDER BY claim.generation DESC
          LIMIT 1
       ),
       inserted AS (
         INSERT INTO kernel_release_effect_dispatch_claims
           (intent_id, generation, idempotency_key, effect_kind, claim_mode,
            lease_expires_at)
         SELECT intent.id,
                COALESCE(MAX(claim.generation), 0) + 1,
                intent.idempotency_key,
                intent.effect_kind,
                $4,
                clock_timestamp() + INTERVAL '15 minutes'
           FROM matching_intent intent
           LEFT JOIN kernel_release_effect_dispatch_claims claim
             ON claim.intent_id = intent.id
          WHERE NOT EXISTS (
            SELECT 1
              FROM latest
             WHERE outcome_id IS NULL
               AND effective_lease_expires_at > clock_timestamp()
          )
          GROUP BY intent.id, intent.idempotency_key, intent.effect_kind
         RETURNING id, generation, lease_expires_at
       )
       SELECT id, generation, lease_expires_at, TRUE AS inserted
         FROM inserted
       UNION ALL
       SELECT id, generation, effective_lease_expires_at, FALSE AS inserted
         FROM latest
        WHERE outcome_id IS NULL
          AND effective_lease_expires_at > clock_timestamp()
          AND claim_mode = $4
       LIMIT 1`,
      [
        authorization.release_run_id,
        authorization.effect_kind,
        authorization.idempotency_key,
        claimMode,
      ],
    );
    const row = claimed.rows[0];
    if (!row) deny('release_effect_claim_unavailable');
    if (claimOutcome) {
      await appendDispatchOutcome(
        client,
        row.id,
        Number(row.generation),
        claimOutcome,
        { source: 'server_owned_live_readback' },
      );
    }
    await client.query('COMMIT');
    return {
      ...authorization,
      claimed: row.inserted === true,
      deduped: row.inserted !== true,
      dispatch_claim_id: row.id,
      generation: Number(row.generation),
      lease_expires_at: new Date(row.lease_expires_at).toISOString(),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function claimReleaseEffect(pool, request) {
  return claimReleaseGeneration(pool, request, 'dispatch');
}

export async function renewReleaseEffectClaim(pool, {
  dispatch_claim_id: claimId,
  generation,
}) {
  if (!Number.isInteger(Number(claimId)) || !Number.isInteger(Number(generation))) {
    deny('release_dispatch_renewal_invalid');
  }
  const renewed = await pool.query(
    `WITH latest AS (
       SELECT intent_id, MAX(generation) AS generation
         FROM kernel_release_effect_dispatch_claims
        WHERE intent_id = (
          SELECT intent_id
            FROM kernel_release_effect_dispatch_claims
           WHERE id = $1
        )
        GROUP BY intent_id
     ),
     effective AS (
       SELECT claim.id,
              GREATEST(
                claim.lease_expires_at,
                COALESCE(MAX(renewal.lease_expires_at), claim.lease_expires_at)
              ) AS effective_lease_expires_at
         FROM kernel_release_effect_dispatch_claims claim
         JOIN latest
           ON latest.intent_id = claim.intent_id
          AND claim.generation = latest.generation
         LEFT JOIN kernel_release_effect_dispatch_renewals renewal
           ON renewal.dispatch_claim_id = claim.id
          AND renewal.generation = claim.generation
         LEFT JOIN kernel_release_effect_dispatch_outcomes outcome
           ON outcome.dispatch_claim_id = claim.id
        WHERE claim.id = $1
          AND claim.generation = $2
          AND outcome.id IS NULL
        GROUP BY claim.id
     )
     INSERT INTO kernel_release_effect_dispatch_renewals
       (dispatch_claim_id, generation, lease_expires_at)
     SELECT $1, $2, clock_timestamp() + INTERVAL '15 minutes'
       FROM effective
      WHERE effective_lease_expires_at > clock_timestamp()
     RETURNING lease_expires_at`,
    [claimId, Number(generation)],
  );
  const row = renewed.rows[0];
  if (!row) deny('release_dispatch_renewal_fenced');
  return {
    dispatch_claim_id: Number(claimId),
    generation: Number(generation),
    lease_expires_at: new Date(row.lease_expires_at).toISOString(),
  };
}

export async function appendDispatchOutcome(
  pool,
  claimId,
  generation,
  outcome,
  evidence = {},
) {
  if (
    !Number.isInteger(Number(claimId))
    || !Number.isInteger(Number(generation))
    || !['dispatched', 'failed', 'observed', 'unknown'].includes(outcome)
  ) {
    throw new ReleaseRunError('release_dispatch_outcome_invalid');
  }
  const inserted = await pool.query(
    `INSERT INTO kernel_release_effect_dispatch_outcomes
       (dispatch_claim_id, outcome, evidence)
     SELECT claim.id, $3, $4::jsonb
       FROM kernel_release_effect_dispatch_claims claim
       JOIN LATERAL (
         SELECT GREATEST(
           claim.lease_expires_at,
           COALESCE(MAX(renewal.lease_expires_at), claim.lease_expires_at)
         ) AS effective_lease_expires_at
           FROM kernel_release_effect_dispatch_renewals renewal
          WHERE renewal.dispatch_claim_id = claim.id
            AND renewal.generation = claim.generation
       ) lease ON TRUE
      WHERE claim.id = $1
        AND claim.generation = $2
        AND claim.generation = (
          SELECT MAX(latest.generation)
            FROM kernel_release_effect_dispatch_claims latest
           WHERE latest.intent_id = claim.intent_id
        )
        AND lease.effective_lease_expires_at > clock_timestamp()
     ON CONFLICT (dispatch_claim_id) DO NOTHING
     RETURNING id`,
    [Number(claimId), Number(generation), outcome, JSON.stringify(evidence)],
  );
  if (inserted.rowCount !== 1) deny('release_dispatch_outcome_fenced');
  return { dispatch_claim_id: Number(claimId), generation: Number(generation), outcome };
}

export async function claimReleaseVerification(pool, request) {
  const claim = await claimReleaseGeneration(
    pool,
    request,
    'verification',
    'observed',
  );
  return { ...claim, outcome: 'observed' };
}

export const __test__ = { REQUIRED_STATE };
