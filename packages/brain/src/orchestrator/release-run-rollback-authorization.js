import { ReleaseRunError } from './release-run-contract.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{40}$/;
const TERMINAL = new Set(['succeeded', 'failed', 'unknown', 'aborted']);

function deny(code) {
  throw new ReleaseRunError(code);
}

function validateAuthorityRequest(request) {
  if (
    !UUID_RE.test(request?.release_run_id ?? '')
    || !SHA_RE.test(request?.merge_sha ?? '')
    || !UUID_RE.test(request?.rollback_authorization ?? '')
  ) {
    deny('release_rollback_authority_request_invalid');
  }
}

function publicAuthority(row) {
  return {
    authority_id: String(row.id ?? row.authority_id),
    release_run_id: String(row.release_run_id),
    merge_sha: row.expected_merge_sha ?? row.merge_sha,
    rollback_authorization: String(row.idempotency_key),
    artifact_versions: row.expected_artifact_versions ?? row.artifact_versions,
    rollback_targets: row.rollback_targets,
  };
}

export async function createRollbackAuthority(pool, request) {
  validateAuthorityRequest(request);
  const { release_run_id: releaseRunId } = request;
  const mergeSha = request.merge_sha;
  const idempotencyKey = request.rollback_authorization;
  const { rows } = await pool.query(
    `WITH exact_release AS (
       SELECT release.*,
              production_receipt.id AS production_effect_receipt_id,
              rollback_intent.id AS rollback_intent_id,
              rollback_receipt.id AS rollback_receipt_id,
              jsonb_agg(
                jsonb_build_object(
                  'artifact_name', artifact_intent.artifact_name,
                  'current_version', artifact_intent.expected_current_version,
                  'current_digest', artifact_intent.expected_current_digest,
                  'anchor', artifact_receipt.observed_anchor,
                  'previous_version', artifact_receipt.observed_previous_version,
                  'previous_digest', artifact_receipt.observed_previous_digest,
                  'rollback_metadata', artifact_receipt.rollback_metadata
                ) ORDER BY artifact_intent.artifact_name
              ) AS rollback_targets
         FROM kernel_release_runs release
         JOIN LATERAL (
           SELECT state
             FROM kernel_release_transitions
            WHERE release_run_id = release.id
            ORDER BY append_seq DESC
            LIMIT 1
         ) transition ON transition.state = 'production_verified'
         JOIN kernel_release_effect_intents production_intent
           ON production_intent.release_run_id = release.id
          AND production_intent.effect_kind = 'production'
          AND production_intent.expected_merge_sha = release.merge_sha
          AND production_intent.expected_artifact_versions = release.artifact_versions
         JOIN kernel_release_effect_receipts production_receipt
           ON production_receipt.intent_id = production_intent.id
          AND production_receipt.receipt_status = 'confirmed'
          AND production_receipt.observed_merge_sha = release.merge_sha
          AND production_receipt.observed_artifact_versions = release.artifact_versions
         JOIN kernel_release_rollback_intents rollback_intent
           ON rollback_intent.release_run_id = release.id
          AND rollback_intent.expected_merge_sha = release.merge_sha
          AND rollback_intent.expected_artifact_versions = release.artifact_versions
         JOIN kernel_release_rollback_receipts rollback_receipt
           ON rollback_receipt.rollback_intent_id = rollback_intent.id
          AND rollback_receipt.effect_receipt_id = production_receipt.id
         JOIN kernel_release_rollback_artifact_intents artifact_intent
           ON artifact_intent.rollback_intent_id = rollback_intent.id
         JOIN kernel_release_rollback_artifact_receipts artifact_receipt
           ON artifact_receipt.rollback_artifact_intent_id = artifact_intent.id
          AND artifact_receipt.effect_receipt_id = production_receipt.id
          AND artifact_receipt.observed_anchor = artifact_intent.expected_anchor
          AND artifact_receipt.observed_previous_version =
              artifact_intent.expected_previous_version
          AND artifact_receipt.observed_previous_digest =
              artifact_intent.expected_previous_digest
        WHERE release.id = $1
          AND release.merge_sha = $2
          AND NOT EXISTS (
            SELECT 1
              FROM kernel_release_effect_intents newer_intent
              JOIN kernel_release_effect_receipts newer_receipt
                ON newer_receipt.intent_id = newer_intent.id
               AND newer_receipt.receipt_status = 'confirmed'
             WHERE newer_intent.effect_kind = 'production'
               AND newer_receipt.append_seq > production_receipt.append_seq
          )
          AND artifact_intent.expected_current_version = (
            SELECT artifact->>'version'
              FROM jsonb_array_elements(release.artifact_versions) artifact
             WHERE artifact->>'name' = artifact_intent.artifact_name
          )
          AND artifact_intent.expected_current_digest = (
            SELECT artifact->>'digest'
              FROM jsonb_array_elements(release.artifact_versions) artifact
             WHERE artifact->>'name' = artifact_intent.artifact_name
          )
        GROUP BY release.id, production_receipt.id, rollback_intent.id,
                 rollback_receipt.id
       HAVING COUNT(*) = jsonb_array_length(release.artifact_versions)
          AND COUNT(DISTINCT artifact_intent.artifact_name) =
              jsonb_array_length(release.artifact_versions)
     ),
     inserted AS (
       INSERT INTO kernel_release_rollback_execution_authorities
         (release_run_id, rollback_intent_id, production_effect_receipt_id,
          rollback_receipt_id, idempotency_key, expected_merge_sha,
          expected_artifact_versions, rollback_targets)
       SELECT id, rollback_intent_id, production_effect_receipt_id,
              rollback_receipt_id, $3, merge_sha, artifact_versions,
              rollback_targets
         FROM exact_release
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *
     )
     SELECT * FROM inserted
     UNION ALL
     SELECT authority.*
       FROM kernel_release_rollback_execution_authorities authority
      WHERE authority.idempotency_key = $3
        AND authority.release_run_id = $1
        AND authority.expected_merge_sha = $2
        AND EXISTS (
          SELECT 1
            FROM exact_release exact
           WHERE exact.id = authority.release_run_id
             AND exact.rollback_intent_id = authority.rollback_intent_id
             AND exact.production_effect_receipt_id =
                 authority.production_effect_receipt_id
             AND exact.rollback_receipt_id = authority.rollback_receipt_id
             AND exact.artifact_versions = authority.expected_artifact_versions
             AND exact.rollback_targets = authority.rollback_targets
        )
     LIMIT 1`,
    [releaseRunId, mergeSha, idempotencyKey],
  );
  if (!rows[0]) deny('release_rollback_authority_unavailable');
  return publicAuthority(rows[0]);
}

export async function claimRollbackExecution(pool, request) {
  validateAuthorityRequest(request);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      [`kernel-release/rollback/${request.release_run_id}`],
    );
    const { rows } = await client.query(
      `WITH matching_authority AS (
         SELECT *
           FROM kernel_release_rollback_execution_authorities
          WHERE release_run_id = $1
            AND expected_merge_sha = $2
            AND idempotency_key = $3
       ),
       current_claim AS (
         SELECT claim.*,
                GREATEST(
                  claim.lease_expires_at,
                  COALESCE(MAX(renewal.lease_expires_at), claim.lease_expires_at)
                ) AS effective_lease_expires_at
           FROM kernel_release_rollback_execution_claims claim
           LEFT JOIN kernel_release_rollback_execution_renewals renewal
             ON renewal.claim_id = claim.id
            AND renewal.generation = claim.generation
          WHERE claim.authority_id = (SELECT id FROM matching_authority)
          GROUP BY claim.id
       ),
       inserted AS (
         INSERT INTO kernel_release_rollback_execution_claims
           (authority_id, generation, lease_expires_at)
         SELECT id, 1, clock_timestamp() + INTERVAL '15 minutes'
           FROM matching_authority
          WHERE NOT EXISTS (SELECT 1 FROM current_claim)
            AND NOT EXISTS (
              SELECT 1
                FROM kernel_release_rollback_execution_settlements settlement
               WHERE settlement.authority_id = matching_authority.id
            )
       RETURNING *, TRUE AS inserted
       ),
       chosen AS (
         SELECT id, authority_id, generation, claimed_at, lease_expires_at,
                inserted
           FROM inserted
         UNION ALL
         SELECT current_claim.id, current_claim.authority_id,
                current_claim.generation, current_claim.claimed_at,
                current_claim.effective_lease_expires_at AS lease_expires_at,
                FALSE AS inserted
           FROM current_claim
           LEFT JOIN kernel_release_rollback_execution_settlements settlement
             ON settlement.claim_id = current_claim.id
          WHERE settlement.id IS NULL
            AND current_claim.effective_lease_expires_at > clock_timestamp()
       )
       SELECT authority.id AS authority_id,
              authority.release_run_id,
              authority.expected_merge_sha,
              authority.idempotency_key,
              authority.expected_artifact_versions,
              authority.rollback_targets,
              chosen.id AS claim_id,
              chosen.generation,
              chosen.lease_expires_at,
              chosen.inserted
         FROM matching_authority authority
         JOIN chosen ON chosen.authority_id = authority.id
        LIMIT 1`,
      [request.release_run_id, request.merge_sha, request.rollback_authorization],
    );
    if (!rows[0]) deny('release_rollback_claim_unavailable');
    await client.query('COMMIT');
    return {
      ...publicAuthority(rows[0]),
      claim_id: Number(rows[0].claim_id),
      generation: Number(rows[0].generation),
      lease_expires_at: new Date(rows[0].lease_expires_at).toISOString(),
      claimed: rows[0].inserted === true,
      deduped: rows[0].inserted !== true,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function renewRollbackClaim(pool, { claim_id: claimId, generation }) {
  if (!Number.isInteger(Number(claimId)) || Number(generation) !== 1) {
    deny('release_rollback_renewal_invalid');
  }
  const { rows } = await pool.query(
    `WITH effective AS (
       SELECT claim.id,
              GREATEST(
                claim.lease_expires_at,
                COALESCE(MAX(renewal.lease_expires_at), claim.lease_expires_at)
              ) AS effective_lease_expires_at
         FROM kernel_release_rollback_execution_claims claim
         LEFT JOIN kernel_release_rollback_execution_renewals renewal
           ON renewal.claim_id = claim.id
          AND renewal.generation = claim.generation
         LEFT JOIN kernel_release_rollback_execution_settlements settlement
           ON settlement.claim_id = claim.id
        WHERE claim.id = $1
          AND claim.generation = $2
          AND settlement.id IS NULL
        GROUP BY claim.id
     )
     INSERT INTO kernel_release_rollback_execution_renewals
       (claim_id, generation, lease_expires_at)
     SELECT $1, $2, clock_timestamp() + INTERVAL '15 minutes'
       FROM effective
      WHERE effective.effective_lease_expires_at > clock_timestamp()
     RETURNING lease_expires_at`,
    [Number(claimId), Number(generation)],
  );
  if (!rows[0]) deny('release_rollback_renewal_fenced');
  return {
    claim_id: Number(claimId),
    generation: Number(generation),
    lease_expires_at: new Date(rows[0].lease_expires_at).toISOString(),
  };
}

export async function assertRollbackExecutionCurrent(
  pool,
  { claim_id: claimId, generation },
) {
  if (!Number.isInteger(Number(claimId)) || Number(generation) !== 1) {
    deny('release_rollback_current_validation_invalid');
  }
  const { rows } = await pool.query(
    `SELECT authority.id AS authority_id
       FROM kernel_release_rollback_execution_claims claim
       JOIN kernel_release_rollback_execution_authorities authority
         ON authority.id = claim.authority_id
       JOIN kernel_release_effect_receipts production_receipt
         ON production_receipt.id = authority.production_effect_receipt_id
      WHERE claim.id = $1
        AND claim.generation = $2
        AND production_receipt.receipt_status = 'confirmed'
        AND production_receipt.dispatch_claim_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
            FROM kernel_release_effect_receipts newer_receipt
            JOIN kernel_release_effect_intents newer_receipt_intent
              ON newer_receipt_intent.id = newer_receipt.intent_id
           WHERE newer_receipt_intent.effect_kind = 'production'
             AND newer_receipt.receipt_status = 'confirmed'
             AND newer_receipt.append_seq > production_receipt.append_seq
        )
        AND NOT EXISTS (
          SELECT 1
            FROM kernel_release_effect_dispatch_claims newer_claim
            JOIN kernel_release_effect_intents newer_intent
              ON newer_intent.id = newer_claim.intent_id
           WHERE newer_intent.effect_kind = 'production'
             AND newer_claim.id > production_receipt.dispatch_claim_id
        )
        AND NOT EXISTS (
          SELECT 1
            FROM kernel_release_rollback_execution_settlements settlement
           WHERE settlement.authority_id = authority.id
        )
      LIMIT 1`,
    [Number(claimId), Number(generation)],
  );
  if (!rows[0]) deny('release_rollback_authority_stale');
  return { authority_id: String(rows[0].authority_id) };
}

export async function settleRollbackExecution(pool, request, {
  connectionKind = 'pool',
} = {}) {
  const claimId = Number(request?.claim_id);
  const generation = Number(request?.generation);
  const status = request?.status;
  const lateEffectRisk = request?.late_effect_risk;
  if (
    !Number.isInteger(claimId)
    || generation !== 1
    || !TERMINAL.has(status)
    || typeof lateEffectRisk !== 'boolean'
    || (['unknown', 'aborted'].includes(status) && lateEffectRisk !== true)
    || request?.evidence == null
    || typeof request.evidence !== 'object'
    || Array.isArray(request.evidence)
    || (status === 'succeeded' && (
      !Array.isArray(request.observed_targets)
      || !Array.isArray(request.observed_readbacks)
    ))
    || !['pool', 'client'].includes(connectionKind)
  ) {
    deny('release_rollback_settlement_invalid');
  }
  const execute = async (queryable) => queryable.query(
    `WITH exact_claim AS (
       SELECT claim.*,
              GREATEST(
                claim.lease_expires_at,
                COALESCE(MAX(renewal.lease_expires_at), claim.lease_expires_at)
              ) AS effective_lease_expires_at
         FROM kernel_release_rollback_execution_claims claim
         LEFT JOIN kernel_release_rollback_execution_renewals renewal
           ON renewal.claim_id = claim.id
          AND renewal.generation = claim.generation
        WHERE claim.id = $1
          AND claim.generation = $2
        GROUP BY claim.id
     ),
     inserted_settlement AS (
       INSERT INTO kernel_release_rollback_execution_settlements
         (authority_id, claim_id, settlement_status, late_effect_risk, evidence)
       SELECT claim.authority_id, claim.id, $3, $4, $5::jsonb
         FROM exact_claim claim
         JOIN kernel_release_rollback_execution_authorities authority
           ON authority.id = claim.authority_id
         JOIN kernel_release_effect_receipts production_receipt
           ON production_receipt.id = authority.production_effect_receipt_id
        WHERE ($3 <> 'succeeded'
               OR (
                 claim.effective_lease_expires_at > clock_timestamp()
                 AND production_receipt.receipt_status = 'confirmed'
                 AND production_receipt.dispatch_claim_id IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1
                     FROM kernel_release_effect_receipts newer_receipt
                     JOIN kernel_release_effect_intents newer_receipt_intent
                       ON newer_receipt_intent.id = newer_receipt.intent_id
                    WHERE newer_receipt_intent.effect_kind = 'production'
                      AND newer_receipt.receipt_status = 'confirmed'
                      AND newer_receipt.append_seq >
                          production_receipt.append_seq
                 )
                 AND NOT EXISTS (
                   SELECT 1
                     FROM kernel_release_effect_dispatch_claims newer_claim
                     JOIN kernel_release_effect_intents newer_intent
                       ON newer_intent.id = newer_claim.intent_id
                    WHERE newer_intent.effect_kind = 'production'
                      AND newer_claim.id >
                          production_receipt.dispatch_claim_id
                 )
               ))
          AND NOT EXISTS (
            SELECT 1
              FROM kernel_release_rollback_execution_settlements settlement
             WHERE settlement.authority_id = claim.authority_id
          )
       ON CONFLICT (authority_id) DO NOTHING
       RETURNING *
     ),
     inserted_receipt AS (
       INSERT INTO kernel_release_rollback_execution_receipts
         (authority_id, settlement_id, observed_targets, observed_readbacks,
          evidence)
       SELECT settlement.authority_id, settlement.id, $6::jsonb, $7::jsonb,
              $5::jsonb
         FROM inserted_settlement settlement
         JOIN kernel_release_rollback_execution_authorities authority
           ON authority.id = settlement.authority_id
        WHERE settlement.settlement_status = 'succeeded'
          AND $6::jsonb = authority.rollback_targets
       RETURNING id
     )
     SELECT settlement.*,
            authority.id AS authority_id,
            receipt.id AS receipt_id
       FROM inserted_settlement settlement
       JOIN kernel_release_rollback_execution_authorities authority
         ON authority.id = settlement.authority_id
       LEFT JOIN inserted_receipt receipt ON TRUE
      WHERE settlement.settlement_status <> 'succeeded'
         OR receipt.id IS NOT NULL`,
    [
      claimId,
      generation,
      status,
      lateEffectRisk,
      JSON.stringify(request.evidence),
      request.observed_targets == null
        ? null
        : JSON.stringify(request.observed_targets),
      request.observed_readbacks == null
        ? null
        : JSON.stringify(request.observed_readbacks),
    ],
  );
  const abortSignal = request.abort_signal;
  if (abortSignal == null) {
    const { rows } = await execute(pool);
    if (!rows[0]) deny('release_rollback_settlement_fenced');
    return {
      authority_id: String(rows[0].authority_id),
      status: rows[0].settlement_status,
      late_effect_risk: rows[0].late_effect_risk,
      receipt_id: rows[0].receipt_id == null ? null : String(rows[0].receipt_id),
    };
  }
  if (
    typeof abortSignal !== 'object'
    || typeof abortSignal.aborted !== 'boolean'
    || (connectionKind === 'pool' && typeof pool.connect !== 'function')
    || (connectionKind === 'client' && typeof pool.query !== 'function')
  ) {
    deny('release_rollback_settlement_invalid');
  }
  const ownsClient = connectionKind === 'pool';
  const client = ownsClient ? await pool.connect() : pool;
  const interruptStore = request.interrupt_store ?? (ownsClient ? pool : null);
  let rows;
  let committed = false;
  let commitStarted = false;
  let interruptRecorded = false;
  const recordCommitInterrupt = async (kind) => {
    if (interruptRecorded) return;
    if (typeof interruptStore?.query !== 'function') {
      deny('release_rollback_interrupt_store_unavailable');
    }
    await interruptStore.query(
      `INSERT INTO kernel_release_rollback_execution_interrupts
         (claim_id, generation, interrupt_kind, evidence)
       SELECT claim.id, claim.generation, $3,
              jsonb_build_object(
                'source', 'release_rollback_success_commit_interrupt',
                'error_code', 'release_rollback_aborted'
              )
         FROM kernel_release_rollback_execution_claims claim
        WHERE claim.id = $1
          AND claim.generation = $2
       ON CONFLICT (claim_id) DO NOTHING
       RETURNING id`,
      [claimId, generation, kind],
    );
    interruptRecorded = true;
  };
  try {
    await client.query('BEGIN');
    if (abortSignal.aborted) deny('release_rollback_aborted');
    ({ rows } = await execute(client));
    if (abortSignal.aborted) deny('release_rollback_aborted');
    if (!rows[0]) deny('release_rollback_settlement_fenced');
    commitStarted = true;
    await client.query('COMMIT');
    committed = true;
    if (abortSignal.aborted) {
      await recordCommitInterrupt('abort_during_commit');
      deny('release_rollback_aborted');
    }
  } catch (error) {
    if (commitStarted && !committed) {
      await recordCommitInterrupt('commit_outcome_unknown');
    } else if (commitStarted && abortSignal.aborted) {
      await recordCommitInterrupt('abort_during_commit');
    }
    if (!committed) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw error;
  } finally {
    if (ownsClient) client.release();
  }
  if (!rows[0]) deny('release_rollback_settlement_fenced');
  return {
    authority_id: String(rows[0].authority_id),
    status: rows[0].settlement_status,
    late_effect_risk: rows[0].late_effect_risk,
    receipt_id: rows[0].receipt_id == null ? null : String(rows[0].receipt_id),
  };
}

export async function observeRollbackAuthority(pool, authorityId) {
  if (!UUID_RE.test(authorityId ?? '')) {
    deny('release_rollback_observation_invalid');
  }
  await pool.query(
    `WITH expired AS (
       SELECT claim.authority_id, claim.id AS claim_id
         FROM kernel_release_rollback_execution_claims claim
         LEFT JOIN kernel_release_rollback_execution_renewals renewal
           ON renewal.claim_id = claim.id
          AND renewal.generation = claim.generation
         LEFT JOIN kernel_release_rollback_execution_settlements settlement
           ON settlement.authority_id = claim.authority_id
        WHERE claim.authority_id = $1
          AND settlement.id IS NULL
        GROUP BY claim.id
       HAVING GREATEST(
         claim.lease_expires_at,
         COALESCE(MAX(renewal.lease_expires_at), claim.lease_expires_at)
       ) <= clock_timestamp()
     )
     INSERT INTO kernel_release_rollback_execution_settlements
       (authority_id, claim_id, settlement_status, late_effect_risk, evidence)
     SELECT authority_id, claim_id, 'unknown', TRUE,
            '{"source":"release_rollback_expired_claim_reaper",
              "error_code":"release_rollback_claim_expired"}'::jsonb
       FROM expired
     ON CONFLICT (authority_id) DO NOTHING`,
    [authorityId],
  );
  const { rows } = await pool.query(
    `SELECT authority.id AS authority_id,
            authority.release_run_id,
            authority.expected_merge_sha AS merge_sha,
            authority.expected_artifact_versions AS artifact_versions,
            authority.rollback_targets,
            claim.id AS claim_id,
            claim.generation,
            settlement.settlement_status,
            settlement.late_effect_risk,
            settlement.evidence,
            receipt.id AS receipt_id,
            interrupt.id AS interrupt_id,
            interrupt.interrupt_kind,
            interrupt.evidence AS interrupt_evidence,
            authority.created_at,
            settlement.created_at AS settled_at
       FROM kernel_release_rollback_execution_authorities authority
       LEFT JOIN kernel_release_rollback_execution_claims claim
         ON claim.authority_id = authority.id
       LEFT JOIN kernel_release_rollback_execution_settlements settlement
         ON settlement.authority_id = authority.id
       LEFT JOIN kernel_release_rollback_execution_receipts receipt
         ON receipt.authority_id = authority.id
       LEFT JOIN kernel_release_rollback_execution_interrupts interrupt
         ON interrupt.claim_id = claim.id
      WHERE authority.id = $1`,
    [authorityId],
  );
  const row = rows[0];
  if (!row) deny('release_rollback_authority_not_found');
  return {
    authority_id: String(row.authority_id),
    release_run_id: String(row.release_run_id),
    merge_sha: row.merge_sha,
    artifact_versions: row.artifact_versions,
    rollback_targets: row.rollback_targets,
    claim_id: row.claim_id == null ? null : Number(row.claim_id),
    generation: row.generation == null ? null : Number(row.generation),
    status: row.interrupt_id == null
      ? (row.settlement_status ?? (row.claim_id == null ? 'authorized' : 'running'))
      : 'unknown',
    late_effect_risk: row.interrupt_id == null
      ? (row.late_effect_risk ?? false)
      : true,
    evidence: row.interrupt_id == null
      ? (row.evidence ?? {})
      : {
        ...(row.evidence ?? {}),
        ...(row.interrupt_evidence ?? {}),
        interrupt_kind: row.interrupt_kind,
      },
    receipt_id: row.receipt_id == null ? null : String(row.receipt_id),
    created_at: row.created_at == null ? null : new Date(row.created_at).toISOString(),
    settled_at: row.settled_at == null ? null : new Date(row.settled_at).toISOString(),
  };
}

export const __test__ = { UUID_RE, SHA_RE, TERMINAL };
