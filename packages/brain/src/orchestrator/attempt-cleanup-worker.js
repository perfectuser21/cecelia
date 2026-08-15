import { createAttemptCleanupOutboxStore } from './attempt-cleanup-outbox-store.js';
import { LOG_ACTION } from './constants.js';
import { createProductionExecutionTransport } from './production-transport.js';

const CONFIRMED_STATUSES = new Set(['cleaned', 'already_clean']);
const RETRY_STATUSES = new Set(['missing', 'unavailable']);

function nonblank(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requirePositiveInteger(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${name} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

function requireWorkerConfiguration({ pool, transport, storeFactory, claimOwner }) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError('pool.query and pool.connect are required');
  }
  if (!transport || typeof transport.cancel !== 'function') {
    throw new TypeError('transport.cancel is required');
  }
  if (typeof storeFactory !== 'function') {
    throw new TypeError('storeFactory is required');
  }
  if (!nonblank(claimOwner) || claimOwner.length > 200) {
    throw new TypeError('claimOwner must be a nonblank string of at most 200 characters');
  }
}

function canonicalReceipt(row, status) {
  return {
    contract_version: 'attempt-cleanup-confirmation/v1',
    status,
    attempt_id: row.attempt_id,
    run_id: row.run_id,
    target_machine_id: row.target_machine_id,
    execution_transport: row.execution_transport,
    remote_job_id: row.remote_job_id,
    lease_owner: row.lease_owner,
    lease_generation: row.lease_generation,
  };
}

function claimAuthority(row) {
  return {
    claimOwner: row.claim_owner,
    claimGeneration: row.claim_generation,
  };
}

function blockDecision(errorCode, errorMessage) {
  return { disposition: 'blocked', errorCode, errorMessage };
}

function retryDecision(errorCode, errorMessage) {
  return { disposition: 'retried', errorCode, errorMessage };
}

function classifyResult(result, row) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return blockDecision('cleanup_cancel_identity_missing', 'cleanup cancel response is missing');
  }
  if (CONFIRMED_STATUSES.has(result.status)) {
    if (!nonblank(result.attempt_id)) {
      return blockDecision(
        'cleanup_cancel_identity_missing',
        'cleanup cancel response is missing attempt_id',
      );
    }
    if (result.attempt_id !== row.attempt_id) {
      return blockDecision(
        'cleanup_cancel_attempt_mismatch',
        `cleanup cancel attempt mismatch: ${result.attempt_id}`,
      );
    }
    return { disposition: 'confirmed', status: result.status };
  }
  if (result.status === 'quarantined') {
    return blockDecision('cleanup_cancel_quarantined', 'cleanup target was quarantined');
  }
  if (result.status === 'rejected') {
    return blockDecision('cleanup_cancel_rejected', 'cleanup cancellation was rejected');
  }
  if (RETRY_STATUSES.has(result.status) || result.httpStatus === 404) {
    return retryDecision(
      result.httpStatus === 404 ? 'cleanup_cancel_not_found' : 'cleanup_cancel_unavailable',
      `cleanup cancellation is recoverable: ${result.status}`,
    );
  }
  if (result.status === 'unsupported') {
    return blockDecision('cleanup_cancel_unsupported', 'cleanup cancellation is unsupported');
  }
  return blockDecision(
    'cleanup_cancel_invalid_response',
    `cleanup cancellation returned unsupported status: ${String(result.status)}`,
  );
}

function classifyError(error) {
  const message = String(error?.message ?? error ?? 'cleanup cancellation failed');
  if (/remote_bridge_cancel_http_404/.test(message)) {
    return retryDecision('cleanup_cancel_not_found', message);
  }
  if (
    /remote_bridge_cancel_(?:timeout|request_failed)/.test(message)
    || /remote_bridge_cancel_http_5\d\d/.test(message)
    || /execution_transport_unavailable(?::|$)/.test(message)
    || /(?:^|_)unavailable(?:$|[_:])/.test(message)
  ) {
    return retryDecision('cleanup_cancel_unavailable', message);
  }
  if (/attempt_mismatch/.test(message)) {
    return blockDecision('cleanup_cancel_attempt_mismatch', message);
  }
  if (/invalid_attempt_id/.test(message)) {
    return blockDecision('cleanup_cancel_identity_missing', message);
  }
  return blockDecision('cleanup_cancel_unsupported', message);
}

function validateClaimIdentity(row) {
  if (row.execution_transport !== 'fleet-worker') {
    return blockDecision(
      'cleanup_transport_unsupported',
      `unsupported cleanup transport: ${String(row.execution_transport)}`,
    );
  }
  if (
    !nonblank(row.attempt_id)
    || !nonblank(row.run_id)
    || !nonblank(row.target_machine_id)
    || !nonblank(row.lease_owner)
    || !Number.isInteger(row.lease_generation)
    || row.lease_generation < 0
  ) {
    return blockDecision('cleanup_identity_missing', 'cleanup claim identity is incomplete');
  }
  return null;
}

async function confirmWithDecision({ pool, storeFactory, row, receipt }) {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1::text))',
      [row.run_id],
    );
    const confirmed = await storeFactory(client).confirm(row.id, {
      ...claimAuthority(row),
      receipt,
    });
    if (!confirmed) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return null;
    }
    const decision = await client.query(
      `WITH next_hop AS (
         SELECT COALESCE(MAX(hop), 0) + 1 AS hop
           FROM orchestrator_decision_log
          WHERE run_id=$1::uuid
       )
       INSERT INTO orchestrator_decision_log
         (run_id,hop,observed,derived_phase,gate_verdict,action,detail)
       SELECT $1::uuid,next_hop.hop,$2::jsonb,run.phase,'allow',
              '${LOG_ACTION.ATTEMPT_CLEANUP_CONFIRMED}',
              jsonb_build_object(
                'receipt',$2::jsonb,
                'outbox_id',$3::text,
                'claim_owner',$4::text,
                'claim_generation',$5::text
              )
         FROM next_hop
         JOIN initiative_runs run ON run.id=$1::uuid
       RETURNING hop`,
      [
        row.run_id,
        JSON.stringify(receipt),
        row.id,
        row.claim_owner,
        row.claim_generation,
      ],
    );
    if (decision.rows.length !== 1) {
      throw new Error('cleanup_confirmation_decision_not_persisted');
    }
    await client.query('COMMIT');
    transactionOpen = false;
    return confirmed;
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function createAttemptCleanupWorker({
  pool,
  env = process.env,
  transport = createProductionExecutionTransport({ env }),
  storeFactory = createAttemptCleanupOutboxStore,
  claimOwner,
  leaseSeconds = 30,
  limit = 10,
  retryAfterSeconds = 60,
} = {}) {
  requireWorkerConfiguration({ pool, transport, storeFactory, claimOwner });
  requirePositiveInteger(leaseSeconds, 'leaseSeconds', 86_400);
  requirePositiveInteger(limit, 'limit', 100);
  requirePositiveInteger(retryAfterSeconds, 'retryAfterSeconds', 86_400);
  const outbox = storeFactory(pool);

  return Object.freeze({
    async runOnce() {
      const rows = await outbox.claimBatch({ claimOwner, leaseSeconds, limit });
      const summary = {
        claimed: rows.length,
        confirmed: 0,
        blocked: 0,
        retried: 0,
        stale: 0,
      };
      for (const row of rows) {
        let decision = validateClaimIdentity(row);
        if (!decision) {
          try {
            const result = await transport.cancel({
              attempt: {
                id: row.attempt_id,
                run_id: row.run_id,
                lease_owner: row.lease_owner,
                lease_generation: row.lease_generation,
              },
              target: { machine: row.target_machine_id },
            });
            decision = classifyResult(result, row);
          } catch (error) {
            decision = classifyError(error);
          }
        }

        if (decision.disposition === 'confirmed') {
          const receipt = canonicalReceipt(row, decision.status);
          const confirmed = await confirmWithDecision({ pool, storeFactory, row, receipt });
          if (confirmed) summary.confirmed += 1;
          else summary.stale += 1;
          continue;
        }

        const authority = claimAuthority(row);
        const persisted = decision.disposition === 'retried'
          ? await outbox.retry(row.id, {
              ...authority,
              errorCode: decision.errorCode,
              errorMessage: decision.errorMessage,
              retryAfterSeconds,
            })
          : await outbox.block(row.id, {
              ...authority,
              errorCode: decision.errorCode,
              errorMessage: decision.errorMessage,
            });
        if (!persisted) summary.stale += 1;
        else summary[decision.disposition] += 1;
      }
      return summary;
    },
  });
}
