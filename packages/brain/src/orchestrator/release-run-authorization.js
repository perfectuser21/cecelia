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
            transition.state,
            intent.effect_kind,
            intent.idempotency_key,
            intent.expected_merge_sha
       FROM kernel_release_runs release
       JOIN LATERAL (
         SELECT state
           FROM kernel_release_transitions
          WHERE release_run_id = release.id
          ORDER BY created_at DESC, id DESC
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
  };
}

export const __test__ = { REQUIRED_STATE };
