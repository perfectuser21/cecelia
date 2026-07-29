import { createHash } from 'node:crypto';

import {
  canonicalJson,
  sha256Canonical,
} from './kernel-equivalence-receipts.js';

const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const CELL_PATTERN =
  /^KERNEL-P[01]-[0-9]{2}-[A-Z0-9-]+::(?:claude|codex|grok)::(?:normal|violation|recovery)$/;
const REASON_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;
const DEFAULT_LOCK_TIMEOUT_MS = 2_000;
const MAXIMUM_TIMEOUT_MS = 300_000;
const GRANT_FIELDS = Object.freeze([
  'adapter_id',
  'artifact_sha',
  'attempt_id',
  'behavior_id',
  'brain_version',
  'cell_id',
  'engine_version',
  'environment',
  'expires_at',
  'grant_id',
  'issued_at',
  'key_id',
  'nonce',
  'provider',
  'resource_id',
  'resource_prefix',
  'resource_ref',
  'run_id',
  'scenario',
  'schema_version',
  'scopes',
  'seam_id',
  'signature',
]);
const REVOCATION_DISPOSITIONS = new Set([
  'safe_no_effect',
  'effect_possible',
]);

const SQL = Object.freeze({
  register:
    `SELECT *
       FROM kernel_equivalence_register_grant_authority(
         $1::uuid, $2::jsonb, $3::text
       )`,
  append:
    `SELECT *
       FROM kernel_equivalence_append_grant_event(
         $1::uuid, $2::text, $3::text, $4::uuid, $5::jsonb
       )`,
  resolve:
    `SELECT *
       FROM kernel_equivalence_resolve_active_grant(
         $1::uuid, $2::text, $3::text
       )`,
  revoke:
    `SELECT *
       FROM kernel_equivalence_revoke_grant(
         $1::uuid, $2::text, $3::uuid, $4::text
       )`,
  transactionTimeout:
    `SELECT set_config('statement_timeout', $1, true)`,
  sharedLock:
    'SELECT pg_advisory_lock_shared($1::bigint)',
  sharedUnlock:
    'SELECT pg_advisory_unlock_shared($1::bigint) AS unlocked',
  exclusiveLock:
    'SELECT pg_advisory_lock($1::bigint)',
  exclusiveUnlock:
    'SELECT pg_advisory_unlock($1::bigint) AS unlocked',
  consumeNonce:
    `INSERT INTO kernel_equivalence_execution_nonces
       (grant_id, nonce, cell_id, run_id, attempt_id, expires_at)
     SELECT $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6::timestamptz
      WHERE $6::timestamptz > clock_timestamp()
        AND clock_timestamp()
          < to_timestamp($7::double precision / 1000.0)
     ON CONFLICT DO NOTHING
     RETURNING grant_id`,
  readNonceConflict:
    `SELECT grant_id, nonce, cell_id, run_id, attempt_id, expires_at
       FROM kernel_equivalence_execution_nonces
      WHERE grant_id = $1::uuid OR nonce = $2::uuid`,
});

export class GrantExecutionAuthorityError extends Error {
  constructor(code, {
    cause = undefined,
    disposition = undefined,
    effectPossible = undefined,
    safeNoEffect = undefined,
  } = {}) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'GrantExecutionAuthorityError';
    this.code = code;
    if (disposition !== undefined) this.disposition = disposition;
    if (effectPossible !== undefined) this.effect_possible = effectPossible;
    if (safeNoEffect !== undefined) this.safe_no_effect = safeNoEffect;
  }
}

function fail(code, cause = undefined) {
  throw new GrantExecutionAuthorityError(code, { cause });
}

function failUnknown(code, cause = undefined) {
  throw new GrantExecutionAuthorityError(code, {
    cause,
    disposition: 'effect_unknown',
    effectPossible: true,
    safeNoEffect: false,
  });
}

function failAbortedBeforeEffect(cause = undefined) {
  throw new GrantExecutionAuthorityError(
    'grant_effect_aborted_before_effect',
    {
      cause,
      disposition: 'aborted_before_effect',
      effectPossible: false,
      safeNoEffect: true,
    },
  );
}

function exactFields(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length
    && actual.every((field, index) => field === sortedExpected[index])
  );
}

function validGrantRegistration(input) {
  return (
    exactFields(input, ['case_id', 'grant', 'grant_sha256'])
    && UUID_PATTERN.test(input.case_id ?? '')
    && validExecutionGrant(input.grant)
    && SHA256_PATTERN.test(input.grant_sha256 ?? '')
  );
}

function validAuthorityInput(input, fields) {
  return (
    exactFields(input, fields)
    && UUID_PATTERN.test(input.grant_id ?? '')
    && SHA256_PATTERN.test(input.grant_sha256 ?? '')
  );
}

function validResolutionInput(input) {
  return (
    validAuthorityInput(input, ['grant_id', 'grant_sha256', 'cell_id'])
    && CELL_PATTERN.test(input.cell_id ?? '')
  );
}

function validExecutionGrant(grant) {
  const issuedAt = Date.parse(grant?.issued_at);
  const expiresAt = Date.parse(grant?.expires_at);
  return (
    exactFields(grant, GRANT_FIELDS)
    && grant.schema_version === 'kernel-equivalence-execution-grant/v1'
    && UUID_PATTERN.test(grant.grant_id ?? '')
    && UUID_PATTERN.test(grant.nonce ?? '')
    && UUID_PATTERN.test(grant.run_id ?? '')
    && UUID_PATTERN.test(grant.attempt_id ?? '')
    && CELL_PATTERN.test(grant.cell_id ?? '')
    && SHA_PATTERN.test(grant.artifact_sha ?? '')
    && VERSION_PATTERN.test(grant.brain_version ?? '')
    && VERSION_PATTERN.test(grant.engine_version ?? '')
    && ['claude', 'codex', 'grok'].includes(grant.provider)
    && ['normal', 'violation', 'recovery'].includes(grant.scenario)
    && grant.environment === 'isolated'
    && typeof grant.issued_at === 'string'
    && typeof grant.expires_at === 'string'
    && Number.isFinite(issuedAt)
    && Number.isFinite(expiresAt)
    && new Date(issuedAt).toISOString() === grant.issued_at
    && new Date(expiresAt).toISOString() === grant.expires_at
    && expiresAt > issuedAt
    && [
      grant.adapter_id,
      grant.behavior_id,
      grant.key_id,
      grant.resource_id,
      grant.resource_prefix,
      grant.resource_ref,
      grant.seam_id,
      grant.signature,
    ].every((value) => (
      typeof value === 'string'
      && value.length > 0
      && value.length <= 4_096
      && !/[\0\r\n]/.test(value)
    ))
    && Array.isArray(grant.scopes)
    && grant.scopes.length === 1
    && grant.scopes[0] === 'isolated_effect'
  );
}

function hashCanonicalBytes(encoded) {
  return createHash('sha256').update(encoded, 'utf8').digest('hex');
}

function cloneInput(value, code) {
  try {
    return structuredClone(value);
  } catch (error) {
    fail(code, error);
  }
}

function snapshotGrant(grant, code = 'grant_authority_request_invalid') {
  const cloned = cloneInput(grant, code);
  if (!validExecutionGrant(cloned)) fail(code);
  let encoded;
  try {
    encoded = canonicalJson(cloned);
  } catch (error) {
    fail(code, error);
  }
  return Object.freeze({
    grant: deepFreeze(cloned),
    encoded,
    grant_sha256: hashCanonicalBytes(encoded),
  });
}

function snapshotRegistration(input) {
  const cloned = cloneInput(input, 'grant_registration_invalid');
  if (!validGrantRegistration(cloned)) {
    fail('grant_registration_invalid');
  }
  let encoded;
  try {
    encoded = canonicalJson(cloned.grant);
  } catch (error) {
    fail('grant_registration_invalid', error);
  }
  if (hashCanonicalBytes(encoded) !== cloned.grant_sha256) {
    fail('grant_registration_invalid');
  }
  return deepFreeze({
    case_id: cloned.case_id,
    grant: cloned.grant,
    grant_json: encoded,
    grant_sha256: cloned.grant_sha256,
  });
}

function authorityInputForGrant(grantSnapshot) {
  return Object.freeze({
    grant_id: grantSnapshot.grant.grant_id,
    grant_sha256: grantSnapshot.grant_sha256,
    cell_id: grantSnapshot.grant.cell_id,
  });
}

function snapshotAuthorityInput(input, fields) {
  if (!exactFields(input, fields)) {
    fail('grant_authority_request_invalid');
  }
  const snapshot = Object.freeze(Object.fromEntries(
    fields.map((field) => [field, input[field]]),
  ));
  if (!validAuthorityInput(snapshot, fields)) {
    fail('grant_authority_request_invalid');
  }
  return snapshot;
}

function validTimeout(value) {
  return (
    Number.isInteger(value)
    && value >= 1
    && value <= MAXIMUM_TIMEOUT_MS
  );
}

function validSignal(signal) {
  return (
    signal == null
    || (
      typeof signal === 'object'
      && typeof signal.aborted === 'boolean'
      && typeof signal.addEventListener === 'function'
      && typeof signal.removeEventListener === 'function'
    )
  );
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function grantRef(grantId) {
  return `kernel-equivalence-grant:${grantId}`;
}

function advisoryKey(grantId) {
  return createHash('sha256')
    .update(grantId, 'utf8')
    .digest()
    .readBigInt64BE(0)
    .toString();
}

function activeGrant(result, expected) {
  const row = result?.rowCount === 1 ? result.rows?.[0] : null;
  if (
    !row
    || row.grant_id !== expected.grant_id
    || row.grant_ref !== grantRef(expected.grant_id)
    || row.grant_sha256 !== expected.grant_sha256
    || row.cell_id !== expected.cell_id
    || row.active !== true
    || !row.grant
    || typeof row.grant !== 'object'
    || Array.isArray(row.grant)
    || row.grant.grant_id !== expected.grant_id
    || row.grant.cell_id !== expected.cell_id
    || Date.parse(row.expires_at) !== Date.parse(row.grant.expires_at)
    || sha256Canonical(row.grant) !== expected.grant_sha256
  ) {
    fail('grant_authority_revalidation_failed');
  }
  return deepFreeze(structuredClone(row));
}

function appendResult(
  result,
  actorInstanceId,
  expectedGrantId,
  expectedState,
) {
  const row = result?.rowCount === 1 ? result.rows?.[0] : null;
  const expectedActorKind = expectedState === 'published'
    ? 'controller'
    : 'runtime';
  if (
    !row
    || Object.keys(row).sort().join(',') !== [
      'actor_instance_id',
      'actor_kind',
      'generation',
      'grant_id',
      'occurred_at',
      'state',
    ].join(',')
    || row.grant_id !== expectedGrantId
    || !Number.isSafeInteger(Number(row.generation))
    || Number(row.generation) < 1
    || row.state !== expectedState
    || row.actor_instance_id !== actorInstanceId
    || row.actor_kind !== expectedActorKind
    || !Number.isFinite(Date.parse(row.occurred_at))
  ) {
    fail('grant_event_append_failed');
  }
  return deepFreeze(structuredClone(row));
}

function revocationResult(result, expectedGrantId) {
  const row = result?.rowCount === 1 ? result.rows?.[0] : null;
  if (
    !row
    || Object.keys(row).sort().join(',') !== [
      'disposition',
      'effect_possible',
      'grant_id',
      'revoked_at',
      'safe_no_effect',
    ].join(',')
    || row.grant_id !== expectedGrantId
    || typeof row.safe_no_effect !== 'boolean'
    || typeof row.effect_possible !== 'boolean'
    || typeof row.disposition !== 'string'
    || !REVOCATION_DISPOSITIONS.has(row.disposition)
    || !Number.isFinite(Date.parse(row.revoked_at))
    || row.safe_no_effect
      !== (row.disposition === 'safe_no_effect')
    || row.effect_possible
      !== (row.disposition === 'effect_possible')
  ) {
    fail('grant_revocation_result_invalid');
  }
  return Object.freeze({
    grant_ref: grantRef(expectedGrantId),
    revoked: true,
    safe_no_effect: row.safe_no_effect,
    effect_possible: row.effect_possible,
    disposition: row.disposition,
  });
}

function registrationResult(result, input) {
  const row = result?.rowCount === 1 ? result.rows?.[0] : null;
  if (
    !row
    || row.grant_id !== input.grant.grant_id
    || row.grant_ref !== grantRef(input.grant.grant_id)
    || row.grant_sha256 !== input.grant_sha256
    || row.cell_id !== input.grant.cell_id
    || Date.parse(row.expires_at) !== Date.parse(input.grant.expires_at)
  ) {
    fail('grant_registration_failed');
  }
  return deepFreeze(structuredClone(row));
}

function exactNonceConflict(result, grant) {
  const row = result?.rowCount === 1 ? result.rows?.[0] : null;
  return (
    row?.grant_id === grant.grant_id
    && row.nonce === grant.nonce
    && row.cell_id === grant.cell_id
    && row.run_id === grant.run_id
    && row.attempt_id === grant.attempt_id
    && Date.parse(row.expires_at) === Date.parse(grant.expires_at)
  );
}

async function inTransaction(pool, operation) {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    fail('grant_authority_connection_failed', error);
  }
  let began = false;
  let commitStarted = false;
  let released = false;
  try {
    await client.query('BEGIN');
    began = true;
    const result = await operation(client);
    commitStarted = true;
    await client.query('COMMIT');
    began = false;
    return result;
  } catch (error) {
    if (commitStarted) {
      released = true;
      client.release(true);
      failUnknown('grant_transaction_outcome_unknown', error);
    }
    if (began) {
      try {
        await client.query('ROLLBACK');
        began = false;
      } catch (rollbackError) {
        released = true;
        client.release(true);
        failUnknown('grant_rollback_outcome_unknown', rollbackError);
      }
    }
    if (error instanceof GrantExecutionAuthorityError) throw error;
    fail('grant_authority_database_failed', error);
  } finally {
    if (!released) client.release();
  }
}

async function setTransactionTimeout(client, timeoutMs) {
  await client.query(SQL.transactionTimeout, [`${timeoutMs}ms`]);
}

async function beginTransaction(session, timeoutMs) {
  await session.client.query('BEGIN');
  session.inTransaction = true;
  await setTransactionTimeout(session.client, timeoutMs);
}

function destroyLockedSession(session) {
  session.destroyed = true;
  session.inTransaction = false;
  if (session.released) return;
  session.released = true;
  try {
    session.client.release(true);
  } catch (error) {
    session.releaseError = error;
  }
}

function releaseLockedSession(session) {
  if (session.released) return;
  session.released = true;
  try {
    session.client.release();
  } catch (error) {
    failUnknown('grant_release_outcome_unknown', error);
  }
}

async function commitTransaction(session) {
  try {
    await session.client.query('COMMIT');
    session.inTransaction = false;
  } catch (error) {
    destroyLockedSession(session);
    failUnknown('grant_transaction_outcome_unknown', error);
  }
}

async function rollbackTransaction(session) {
  if (!session.inTransaction || session.destroyed) return;
  try {
    await session.client.query('ROLLBACK');
    session.inTransaction = false;
  } catch (error) {
    destroyLockedSession(session);
    failUnknown('grant_rollback_outcome_unknown', error);
  }
}

async function openLockedSession({
  pool,
  grantId,
  shared,
  signal = null,
  abortCode = null,
  timeoutMs,
}) {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    failUnknown('grant_lock_outcome_unknown', error);
  }
  const session = {
    client,
    destroyed: false,
    inTransaction: false,
    key: advisoryKey(grantId),
    lockSql: shared ? SQL.sharedLock : SQL.exclusiveLock,
    locked: false,
    released: false,
    signal,
    unlockSql: shared ? SQL.sharedUnlock : SQL.exclusiveUnlock,
  };
  session.abortHandler = () => {
    session.aborted = true;
    destroyLockedSession(session);
  };
  signal?.addEventListener('abort', session.abortHandler, { once: true });
  if (signal?.aborted) session.abortHandler();
  try {
    if (session.aborted) fail(abortCode);
    await beginTransaction(session, timeoutMs);
    await client.query(session.lockSql, [session.key]);
    session.locked = true;
    return session;
  } catch (error) {
    let rollbackError;
    try {
      await rollbackTransaction(session);
    } catch (caught) {
      rollbackError = caught;
    }
    destroyLockedSession(session);
    signal?.removeEventListener('abort', session.abortHandler);
    if (rollbackError) throw rollbackError;
    if (session.aborted && abortCode) {
      fail(abortCode, error);
    }
    failUnknown('grant_lock_outcome_unknown', error);
  }
}

async function closeLockedSession(session) {
  try {
    await rollbackTransaction(session);
    if (session.destroyed) return;
    if (session.locked) {
      try {
        const result = await session.client.query(
          session.unlockSql,
          [session.key],
        );
        if (session.destroyed) return;
        if (
          result?.rowCount !== 1
          || result.rows?.[0]?.unlocked !== true
        ) {
          throw new Error('grant advisory unlock was not confirmed');
        }
        session.locked = false;
      } catch (error) {
        destroyLockedSession(session);
        failUnknown('grant_unlock_outcome_unknown', error);
      }
    }
    releaseLockedSession(session);
  } finally {
    session.signal?.removeEventListener(
      'abort',
      session.abortHandler,
    );
  }
}

async function appendEvent(
  client,
  actorInstanceId,
  {
    grant_id: grantId,
    grant_sha256: grantSha256,
  },
  state,
  details,
) {
  return client.query(SQL.append, [
    grantId,
    grantSha256,
    state,
    actorInstanceId,
    JSON.stringify(details),
  ]);
}

async function resolveActive(client, input) {
  return activeGrant(
    await client.query(SQL.resolve, [
      input.grant_id,
      input.grant_sha256,
      input.cell_id,
    ]),
    input,
  );
}

export function createPostgresGrantExecutionAuthority({
  pool,
  actorInstanceId,
  lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
} = {}) {
  if (
    !pool
    || typeof pool.connect !== 'function'
    || !UUID_PATTERN.test(actorInstanceId ?? '')
    || !validTimeout(lockTimeoutMs)
  ) {
    fail('grant_authority_configuration_invalid');
  }

  async function registerPendingGrant(input = {}) {
    const snapshot = snapshotRegistration(input);
    return inTransaction(pool, async (client) => {
      const result = await client.query(SQL.register, [
        snapshot.case_id,
        snapshot.grant_json,
        snapshot.grant_sha256,
      ]);
      return registrationResult(result, snapshot);
    });
  }

  async function markGrantPublished(input = {}) {
    const snapshot = snapshotAuthorityInput(
      input,
      ['grant_id', 'grant_sha256'],
    );
    return inTransaction(pool, async (client) => appendResult(
      await appendEvent(
        client,
        actorInstanceId,
        snapshot,
        'published',
        {},
      ),
      actorInstanceId,
      snapshot.grant_id,
      'published',
    ));
  }

  async function resolveActiveGrant(input = {}) {
    const snapshot = snapshotAuthorityInput(
      input,
      ['grant_id', 'grant_sha256', 'cell_id'],
    );
    if (!validResolutionInput(snapshot)) {
      fail('grant_authority_request_invalid');
    }
    return inTransaction(
      pool,
      (client) => resolveActive(client, snapshot),
    );
  }

  async function consumeNonceIfActive(request = {}) {
    const signal = request?.signal ?? null;
    const timeoutMs = request?.timeoutMs === undefined
      ? lockTimeoutMs
      : request.timeoutMs;
    const grantSnapshot = snapshotGrant(request?.grant);
    if (
      !validSignal(signal)
      || !validTimeout(timeoutMs)
    ) {
      fail('grant_authority_request_invalid');
    }
    if (signal?.aborted) {
      fail('grant_nonce_consumption_aborted');
    }
    const input = authorityInputForGrant(grantSnapshot);
    const session = await openLockedSession({
      pool,
      grantId: input.grant_id,
      shared: true,
      signal,
      abortCode: 'grant_nonce_consumption_aborted',
      timeoutMs,
    });
    let committed = false;
    let outcome;
    let operationError;
    try {
      const resolved = await resolveActive(session.client, input);
      if (signal?.aborted) {
        fail('grant_nonce_consumption_aborted');
      }
      const result = await session.client.query(SQL.consumeNonce, [
        resolved.grant.grant_id,
        resolved.grant.nonce,
        resolved.grant.cell_id,
        resolved.grant.run_id,
        resolved.grant.attempt_id,
        resolved.grant.expires_at,
        Date.now() + timeoutMs,
      ]);
      if (signal?.aborted) {
        fail('grant_nonce_consumption_aborted');
      }
      if (result?.rowCount === 1) {
        outcome = Object.freeze({ consumed: true });
      } else if (result?.rowCount === 0) {
        const conflict = await session.client.query(
          SQL.readNonceConflict,
          [resolved.grant.grant_id, resolved.grant.nonce],
        );
        if (!exactNonceConflict(conflict, resolved.grant)) {
          fail('grant_nonce_consumption_failed');
        }
        outcome = Object.freeze({ consumed: false });
      } else {
        fail('grant_nonce_consumption_failed');
      }
      if (signal?.aborted) {
        fail('grant_nonce_consumption_aborted');
      }
      await commitTransaction(session);
      committed = true;
      if (signal?.aborted || session.aborted || session.destroyed) {
        failUnknown('grant_nonce_cancellation_unconfirmed');
      }
    } catch (error) {
      try {
        await rollbackTransaction(session);
      } catch (rollbackError) {
        operationError = rollbackError;
      }
      if (!operationError) {
        operationError = error instanceof GrantExecutionAuthorityError
          ? error
          : new GrantExecutionAuthorityError(
            'grant_nonce_consumption_failed',
            { cause: error },
          );
      }
    }
    let closeError;
    try {
      await closeLockedSession(session);
    } catch (error) {
      closeError = error;
    }
    if (
      committed
      && (signal?.aborted || session.aborted || session.destroyed)
    ) {
      operationError = new GrantExecutionAuthorityError(
        'grant_nonce_cancellation_unconfirmed',
        {
          disposition: 'effect_unknown',
          effectPossible: true,
          safeNoEffect: false,
        },
      );
    }
    if (closeError) throw closeError;
    if (operationError) throw operationError;
    return outcome;
  }

  async function appendTerminal(
    session,
    input,
    state,
    intentGeneration,
    timeoutMs,
  ) {
    try {
      await beginTransaction(session, timeoutMs);
      const result = await appendEvent(
        session.client,
        actorInstanceId,
        input,
        state,
        { intent_generation: intentGeneration },
      );
      appendResult(
        result,
        actorInstanceId,
        input.grant_id,
        state,
      );
      await commitTransaction(session);
    } catch (error) {
      await rollbackTransaction(session);
      failUnknown('grant_effect_unknown', error);
    }
  }

  async function invokeWhileActive(request = {}) {
    const invoke = request?.invoke;
    const signal = request?.signal ?? null;
    const timeoutMs = request?.timeoutMs === undefined
      ? lockTimeoutMs
      : request.timeoutMs;
    const grantSnapshot = snapshotGrant(request?.grant);
    if (
      typeof invoke !== 'function'
      || !validSignal(signal)
      || !validTimeout(timeoutMs)
    ) {
      fail('grant_authority_request_invalid');
    }
    const input = authorityInputForGrant(grantSnapshot);
    const session = await openLockedSession({
      pool,
      grantId: input.grant_id,
      shared: true,
      timeoutMs,
    });
    let outcome;
    let operationError;
    try {
      await resolveActive(session.client, input);
      const intent = appendResult(
        await appendEvent(
          session.client,
          actorInstanceId,
          input,
          'execution_intent',
          {},
        ),
        actorInstanceId,
        input.grant_id,
        'execution_intent',
      );
      if (
        !Number.isSafeInteger(Number(intent.generation))
        || Number(intent.generation) < 1
      ) {
        fail('grant_effect_intent_invalid');
      }
      await commitTransaction(session);

      let value;
      try {
        value = await invoke(signal);
      } catch (error) {
        if (error?.effectStarted === false) {
          await appendTerminal(
            session,
            input,
            'aborted_before_effect',
            Number(intent.generation),
            timeoutMs,
          );
          failAbortedBeforeEffect(error);
        }
        await appendTerminal(
          session,
          input,
          'effect_unknown',
          Number(intent.generation),
          timeoutMs,
        );
        failUnknown('grant_effect_unknown', error);
      }
      await appendTerminal(
        session,
        input,
        'effect_completed',
        Number(intent.generation),
        timeoutMs,
      );
      outcome = Object.freeze({
        grant_ref: grantRef(input.grant_id),
        disposition: 'effect_completed',
        result: value,
      });
    } catch (error) {
      try {
        await rollbackTransaction(session);
      } catch (rollbackError) {
        operationError = rollbackError;
      }
      if (!operationError) {
        operationError = error instanceof GrantExecutionAuthorityError
          ? error
          : new GrantExecutionAuthorityError('grant_effect_unknown', {
            cause: error,
            disposition: 'effect_unknown',
            effectPossible: true,
            safeNoEffect: false,
          });
      }
    }
    let closeError;
    try {
      await closeLockedSession(session);
    } catch (error) {
      closeError = error;
    }
    if (closeError) throw closeError;
    if (operationError) throw operationError;
    return outcome;
  }

  async function revokeGrant(input = {}) {
    const hasTimeout = Object.hasOwn(input ?? {}, 'timeoutMs');
    const expectedFields = hasTimeout
      ? ['grant_id', 'grant_sha256', 'reason', 'timeoutMs']
      : ['grant_id', 'grant_sha256', 'reason'];
    const snapshot = snapshotAuthorityInput(input, expectedFields);
    const timeoutMs = hasTimeout ? snapshot.timeoutMs : lockTimeoutMs;
    if (
      !REASON_PATTERN.test(snapshot.reason ?? '')
      || !validTimeout(timeoutMs)
    ) {
      fail('grant_authority_request_invalid');
    }
    const session = await openLockedSession({
      pool,
      grantId: snapshot.grant_id,
      shared: false,
      timeoutMs,
    });
    let outcome;
    let operationError;
    try {
      outcome = revocationResult(
        await session.client.query(SQL.revoke, [
          snapshot.grant_id,
          snapshot.grant_sha256,
          actorInstanceId,
          snapshot.reason,
        ]),
        snapshot.grant_id,
      );
      await commitTransaction(session);
    } catch (error) {
      try {
        await rollbackTransaction(session);
      } catch (rollbackError) {
        operationError = rollbackError;
      }
      if (!operationError) {
        operationError = error instanceof GrantExecutionAuthorityError
          ? error
          : new GrantExecutionAuthorityError(
            'grant_revocation_outcome_unknown',
            {
              cause: error,
              disposition: 'effect_unknown',
              effectPossible: true,
              safeNoEffect: false,
            },
          );
      }
    }
    let closeError;
    try {
      await closeLockedSession(session);
    } catch (error) {
      closeError = error;
    }
    if (closeError) throw closeError;
    if (operationError) throw operationError;
    return outcome;
  }

  return Object.freeze({
    registerPendingGrant,
    markGrantPublished,
    resolveActiveGrant,
    consumeNonceIfActive,
    invokeWhileActive,
    revokeGrant,
  });
}
