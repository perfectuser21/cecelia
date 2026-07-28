import { createHash } from 'node:crypto';

import {
  sha256Canonical,
} from './kernel-equivalence-receipts.js';

const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CELL_PATTERN =
  /^KERNEL-P[01]-[0-9]{2}-[A-Z0-9-]+::(?:claude|codex|grok)::(?:normal|violation|recovery)$/;
const REASON_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;
const DEFAULT_LOCK_TIMEOUT_MS = 2_000;
const MAXIMUM_TIMEOUT_MS = 300_000;

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
    && sha256Canonical(input.grant) === input.grant_sha256
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
  return (
    grant
    && typeof grant === 'object'
    && !Array.isArray(grant)
    && UUID_PATTERN.test(grant.grant_id ?? '')
    && UUID_PATTERN.test(grant.nonce ?? '')
    && UUID_PATTERN.test(grant.run_id ?? '')
    && UUID_PATTERN.test(grant.attempt_id ?? '')
    && CELL_PATTERN.test(grant.cell_id ?? '')
    && Number.isFinite(Date.parse(grant.expires_at))
  );
}

function authorityInputForGrant(grant) {
  return {
    grant_id: grant.grant_id,
    grant_sha256: sha256Canonical(grant),
    cell_id: grant.cell_id,
  };
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
      'safe_no_effect',
    ].join(',')
    || typeof row.safe_no_effect !== 'boolean'
    || typeof row.effect_possible !== 'boolean'
    || typeof row.disposition !== 'string'
    || row.disposition.length === 0
    || row.safe_no_effect === row.effect_possible
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

async function inTransaction(pool, operation) {
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    fail('grant_authority_connection_failed', error);
  }
  let began = false;
  try {
    await client.query('BEGIN');
    began = true;
    const result = await operation(client);
    await client.query('COMMIT');
    began = false;
    return result;
  } catch (error) {
    if (began) await client.query('ROLLBACK').catch(() => {});
    if (error instanceof GrantExecutionAuthorityError) throw error;
    fail('grant_authority_database_failed', error);
  } finally {
    client.release();
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

async function commitTransaction(session) {
  try {
    await session.client.query('COMMIT');
    session.inTransaction = false;
  } catch (error) {
    session.inTransaction = false;
    session.destroyed = true;
    session.client.release(true);
    failUnknown('grant_transaction_outcome_unknown', error);
  }
}

async function rollbackTransaction(session) {
  if (!session.inTransaction) return;
  await session.client.query('ROLLBACK').catch(() => {});
  session.inTransaction = false;
}

async function openLockedSession({
  pool,
  grantId,
  shared,
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
    unlockSql: shared ? SQL.sharedUnlock : SQL.exclusiveUnlock,
  };
  try {
    await beginTransaction(session, timeoutMs);
    await client.query(session.lockSql, [session.key]);
    session.locked = true;
    return session;
  } catch (error) {
    await rollbackTransaction(session);
    session.destroyed = true;
    client.release(true);
    failUnknown('grant_lock_outcome_unknown', error);
  }
}

async function closeLockedSession(session) {
  await rollbackTransaction(session);
  if (session.destroyed) return;
  if (session.locked) {
    try {
      const result = await session.client.query(
        session.unlockSql,
        [session.key],
      );
      if (
        result?.rowCount !== 1
        || result.rows?.[0]?.unlocked !== true
      ) {
        throw new Error('grant advisory unlock was not confirmed');
      }
      session.locked = false;
    } catch (error) {
      session.destroyed = true;
      session.client.release(true);
      failUnknown('grant_unlock_outcome_unknown', error);
    }
  }
  session.client.release();
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
    || !Number.isInteger(lockTimeoutMs)
    || lockTimeoutMs < 1
  ) {
    fail('grant_authority_configuration_invalid');
  }

  async function registerPendingGrant(input = {}) {
    if (!validGrantRegistration(input)) {
      fail('grant_registration_invalid');
    }
    return inTransaction(pool, async (client) => {
      const result = await client.query(SQL.register, [
        input.case_id,
        JSON.stringify(input.grant),
        input.grant_sha256,
      ]);
      return registrationResult(result, input);
    });
  }

  async function markGrantPublished(input = {}) {
    if (!validAuthorityInput(input, ['grant_id', 'grant_sha256'])) {
      fail('grant_authority_request_invalid');
    }
    return inTransaction(pool, async (client) => appendResult(
      await appendEvent(client, actorInstanceId, input, 'published', {}),
      actorInstanceId,
      input.grant_id,
      'published',
    ));
  }

  async function resolveActiveGrant(input = {}) {
    if (!validResolutionInput(input)) {
      fail('grant_authority_request_invalid');
    }
    return inTransaction(pool, (client) => resolveActive(client, input));
  }

  async function consumeNonceIfActive({
    grant,
    signal = null,
    timeoutMs = lockTimeoutMs,
  } = {}) {
    if (
      !validExecutionGrant(grant)
      || !validSignal(signal)
      || !validTimeout(timeoutMs)
    ) {
      fail('grant_authority_request_invalid');
    }
    if (signal?.aborted) {
      fail('grant_nonce_consumption_aborted');
    }
    const input = authorityInputForGrant(grant);
    const session = await openLockedSession({
      pool,
      grantId: input.grant_id,
      shared: true,
      timeoutMs,
    });
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
      await commitTransaction(session);
      outcome = Object.freeze({ consumed: result?.rowCount === 1 });
    } catch (error) {
      await rollbackTransaction(session);
      operationError = error instanceof GrantExecutionAuthorityError
        ? error
        : new GrantExecutionAuthorityError(
          'grant_nonce_consumption_failed',
          { cause: error },
        );
    }
    let closeError;
    try {
      await closeLockedSession(session);
    } catch (error) {
      closeError = error;
    }
    if (operationError) throw operationError;
    if (closeError) throw closeError;
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

  async function invokeWhileActive({
    grant: callerGrant,
    invoke,
    signal = null,
    timeoutMs = lockTimeoutMs,
  } = {}) {
    if (
      !validExecutionGrant(callerGrant)
      || typeof invoke !== 'function'
      || !validSignal(signal)
      || !validTimeout(timeoutMs)
    ) {
      fail('grant_authority_request_invalid');
    }
    const input = authorityInputForGrant(callerGrant);
    const session = await openLockedSession({
      pool,
      grantId: input.grant_id,
      shared: true,
      timeoutMs,
    });
    let outcome;
    let operationError;
    try {
      const grant = await resolveActive(session.client, input);
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

      if (signal?.aborted) {
        await appendTerminal(
          session,
          input,
          'aborted_before_effect',
          Number(intent.generation),
          timeoutMs,
        );
        outcome = Object.freeze({
          grant_ref: grantRef(input.grant_id),
          disposition: 'aborted_before_effect',
        });
      } else {
        let value;
        try {
          value = await invoke(Object.freeze({
            grant: grant.grant,
            intent_generation: Number(intent.generation),
          }));
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
      }
    } catch (error) {
      await rollbackTransaction(session);
      operationError = error instanceof GrantExecutionAuthorityError
        ? error
        : new GrantExecutionAuthorityError('grant_effect_unknown', {
          cause: error,
          disposition: 'effect_unknown',
          effectPossible: true,
          safeNoEffect: false,
        });
    }
    let closeError;
    try {
      await closeLockedSession(session);
    } catch (error) {
      closeError = error;
    }
    if (operationError) throw operationError;
    if (closeError) throw closeError;
    return outcome;
  }

  async function revokeGrant(input = {}, {
    timeoutMs = lockTimeoutMs,
  } = {}) {
    if (
      !validAuthorityInput(
        input,
        ['grant_id', 'grant_sha256', 'reason'],
      )
      || !REASON_PATTERN.test(input.reason ?? '')
      || !validTimeout(timeoutMs)
    ) {
      fail('grant_authority_request_invalid');
    }
    const session = await openLockedSession({
      pool,
      grantId: input.grant_id,
      shared: false,
      timeoutMs,
    });
    let outcome;
    let operationError;
    try {
      outcome = revocationResult(
        await session.client.query(SQL.revoke, [
          input.grant_id,
          input.grant_sha256,
          actorInstanceId,
          input.reason,
        ]),
        input.grant_id,
      );
      await commitTransaction(session);
    } catch (error) {
      await rollbackTransaction(session);
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
    let closeError;
    try {
      await closeLockedSession(session);
    } catch (error) {
      closeError = error;
    }
    if (operationError) throw operationError;
    if (closeError) throw closeError;
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
