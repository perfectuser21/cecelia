import { redactSecrets } from './failure-persistence.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANONICAL_UINT_PATTERN = /^(0|[1-9][0-9]*)$/;
const MAX_BIGINT = 9_223_372_036_854_775_807n;
const MAX_CLAIM_OWNER_LENGTH = 200;
const MAX_ERROR_CODE_LENGTH = 200;
const MAX_ERROR_MESSAGE_LENGTH = 2_000;
const MAX_LEASE_SECONDS = 86_400;
const MAX_RETRY_SECONDS = 86_400;
const MAX_BATCH_LIMIT = 100;

function requirePool(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('pool.query is required');
  }
}

function requireNonblankString(value, name, maxLength) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) {
    throw new TypeError(`${name} must be a nonblank string of at most ${maxLength} characters`);
  }
  return value;
}

function requireIntegerInRange(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function requireId(id) {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    throw new TypeError('id must be a UUID');
  }
  return id;
}

function requireClaimGeneration(value) {
  if (typeof value !== 'string'
      || !CANONICAL_UINT_PATTERN.test(value)
      || value.length > 19
      || BigInt(value) > MAX_BIGINT) {
    throw new TypeError('claimGeneration must be a canonical PostgreSQL BIGINT decimal string');
  }
  return value;
}

function normalizeReturnedGeneration(value) {
  if (typeof value === 'bigint') return requireClaimGeneration(value.toString());
  if (Number.isSafeInteger(value) && value >= 0) return requireClaimGeneration(String(value));
  return requireClaimGeneration(value);
}

function requireReceipt(receipt) {
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new TypeError('receipt must be an object');
  }
  const prototype = Object.getPrototypeOf(receipt);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('receipt must be a plain object');
  }
  let serialized;
  try {
    serialized = JSON.stringify(receipt);
  } catch (error) {
    throw new TypeError('receipt must be a JSON-serializable object', { cause: error });
  }
  if (typeof serialized !== 'string') {
    throw new TypeError('receipt must be a JSON-serializable object');
  }
  const canonical = JSON.parse(serialized);
  if (canonical === null || typeof canonical !== 'object' || Array.isArray(canonical)) {
    throw new TypeError('receipt JSON value must be an object');
  }
  return canonical;
}

function sanitizeError(errorCode, errorMessage) {
  const code = requireNonblankString(errorCode, 'errorCode', MAX_ERROR_CODE_LENGTH).trim();
  if (typeof errorMessage !== 'string' || errorMessage.trim() === '') {
    throw new TypeError('errorMessage must be a nonblank string');
  }
  return {
    errorCode: code,
    errorMessage: redactSecrets(errorMessage).slice(0, MAX_ERROR_MESSAGE_LENGTH),
  };
}

function normalizedRow(row) {
  if (!row) return null;
  return {
    ...row,
    claim_generation: normalizeReturnedGeneration(row.claim_generation),
  };
}

function validateAuthority(id, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('claim authority input is required');
  }
  return {
    id: requireId(id),
    claimOwner: requireNonblankString(
      input.claimOwner,
      'claimOwner',
      MAX_CLAIM_OWNER_LENGTH,
    ),
    claimGeneration: requireClaimGeneration(input.claimGeneration),
  };
}

export function createAttemptCleanupOutboxStore(pool) {
  requirePool(pool);

  return {
    async claimBatch({ claimOwner, leaseSeconds, limit } = {}) {
      const owner = requireNonblankString(
        claimOwner,
        'claimOwner',
        MAX_CLAIM_OWNER_LENGTH,
      );
      const lease = requireIntegerInRange(
        leaseSeconds,
        'leaseSeconds',
        1,
        MAX_LEASE_SECONDS,
      );
      const batchLimit = requireIntegerInRange(limit, 'limit', 1, MAX_BATCH_LIMIT);
      const { rows } = await pool.query(
        `WITH claimable AS (
           SELECT id
             FROM harness_attempt_cleanup_outbox
            WHERE (status = 'pending' AND available_at <= NOW())
               OR (status = 'leased' AND claim_expires_at <= NOW())
            ORDER BY created_at, id
            LIMIT $3
            FOR UPDATE SKIP LOCKED
         )
         UPDATE harness_attempt_cleanup_outbox AS outbox
            SET status = 'leased',
                claim_owner = $1,
                claim_generation = outbox.claim_generation + 1,
                claim_expires_at = NOW() + ($2 * INTERVAL '1 second'),
                delivery_attempts = outbox.delivery_attempts + 1,
                updated_at = NOW()
           FROM claimable
          WHERE outbox.id = claimable.id
         RETURNING outbox.*`,
        [owner, lease, batchLimit],
      );
      return rows.map(normalizedRow);
    },

    async confirm(id, input) {
      const authority = validateAuthority(id, input);
      const receipt = requireReceipt(input.receipt);
      const { rows } = await pool.query(
        `UPDATE harness_attempt_cleanup_outbox AS outbox
            SET status = 'confirmed',
                receipt = $4::jsonb,
                confirmed_at = NOW(),
                updated_at = NOW()
          WHERE id = $1::uuid
            AND status = 'leased'
            AND claim_owner = $2
            AND claim_generation = $3::bigint
         RETURNING outbox.*`,
        [authority.id, authority.claimOwner, authority.claimGeneration, receipt],
      );
      return normalizedRow(rows[0]);
    },

    async retry(id, input) {
      const authority = validateAuthority(id, input);
      const error = sanitizeError(input.errorCode, input.errorMessage);
      const retryAfterSeconds = requireIntegerInRange(
        input.retryAfterSeconds,
        'retryAfterSeconds',
        0,
        MAX_RETRY_SECONDS,
      );
      const { rows } = await pool.query(
        `UPDATE harness_attempt_cleanup_outbox AS outbox
            SET status = 'pending',
                claim_owner = NULL,
                claim_expires_at = NULL,
                available_at = NOW() + ($6 * INTERVAL '1 second'),
                last_error_code = $4,
                last_error_message = $5,
                last_error_at = NOW(),
                updated_at = NOW()
          WHERE id = $1::uuid
            AND status = 'leased'
            AND claim_owner = $2
            AND claim_generation = $3::bigint
         RETURNING outbox.*`,
        [
          authority.id,
          authority.claimOwner,
          authority.claimGeneration,
          error.errorCode,
          error.errorMessage,
          retryAfterSeconds,
        ],
      );
      return normalizedRow(rows[0]);
    },

    async block(id, input) {
      const authority = validateAuthority(id, input);
      const error = sanitizeError(input.errorCode, input.errorMessage);
      const { rows } = await pool.query(
        `UPDATE harness_attempt_cleanup_outbox AS outbox
            SET status = 'blocked',
                claim_owner = NULL,
                claim_expires_at = NULL,
                last_error_code = $4,
                last_error_message = $5,
                last_error_at = NOW(),
                blocked_at = NOW(),
                updated_at = NOW()
          WHERE id = $1::uuid
            AND status = 'leased'
            AND claim_owner = $2
            AND claim_generation = $3::bigint
         RETURNING outbox.*`,
        [
          authority.id,
          authority.claimOwner,
          authority.claimGeneration,
          error.errorCode,
          error.errorMessage,
        ],
      );
      return normalizedRow(rows[0]);
    },
  };
}
