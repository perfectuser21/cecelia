import {
  randomUUID as nodeRandomUUID,
} from 'node:crypto';
import {
  sha256Canonical,
} from './kernel-equivalence-receipts.js';

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const CELL_PATTERN = /^KERNEL-P[01]-[0-9A-Z-]+::(claude|codex|grok)::(normal|violation|recovery)$/;
const CODE_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;
const CHAIN_ID = 'kernel-equivalence-v1';
const DEFAULT_TRANSACTION_TIMEOUT_MS = 30_000;
const MAXIMUM_TRANSACTION_TIMEOUT_MS = 300_000;
const POSTGRES_TIMEOUT_CODES = new Set(['25P03', '55P03', '57014']);
const NONCE_FIELDS = Object.freeze([
  'attempt_id',
  'cell_id',
  'expires_at',
  'grant_id',
  'nonce',
  'run_id',
]);
const AUDIT_FIELDS = Object.freeze([
  'attempt_id',
  'behavior_id',
  'cell_id',
  'code',
  'late_effect_risk',
  'occurred_at',
  'provider',
  'run_id',
  'scenario',
  'schema_version',
  'stage',
  'status',
]);
const PREDECESSOR_FIELDS = Object.freeze([
  'adapter_id',
  'artifact_sha',
  'attempt_id',
  'behavior_id',
  'cell_id',
  'provider',
  'resource_id',
  'resource_ref',
  'run_id',
  'scenario',
  'seam_id',
]);

export class EquivalencePostgresRuntimeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'EquivalencePostgresRuntimeError';
    this.code = code;
  }
}

function fail(code) {
  throw new EquivalencePostgresRuntimeError(code);
}

function exactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length
    && actual.every((field, index) => field === expected[index]);
}

function bounded(value, maximum = 512) {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !/[\0\r\n]/.test(value)
  );
}

function requireQueryPool(pool) {
  if (!pool || typeof pool.query !== 'function') {
    fail('postgres_runtime_pool_invalid');
  }
}

function requireTransactionPool(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    fail('postgres_runtime_pool_invalid');
  }
}

function validNonceInput(input) {
  return (
    exactFields(input, NONCE_FIELDS)
    && UUID_PATTERN.test(input.grant_id ?? '')
    && UUID_PATTERN.test(input.nonce ?? '')
    && UUID_PATTERN.test(input.run_id ?? '')
    && UUID_PATTERN.test(input.attempt_id ?? '')
    && CELL_PATTERN.test(input.cell_id ?? '')
    && Number.isFinite(Date.parse(input.expires_at))
  );
}

export function createPostgresNonceConsumer({ pool } = {}) {
  requireQueryPool(pool);
  return async function consumeNonce(input) {
    if (!validNonceInput(input)) fail('nonce_record_invalid');
    try {
      const result = await pool.query(
        `INSERT INTO kernel_equivalence_execution_nonces
           (grant_id, nonce, cell_id, run_id, attempt_id, expires_at)
         SELECT $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6::timestamptz
          WHERE $6::timestamptz > clock_timestamp()
         ON CONFLICT DO NOTHING
         RETURNING grant_id`,
        [
          input.grant_id,
          input.nonce,
          input.cell_id,
          input.run_id,
          input.attempt_id,
          input.expires_at,
        ],
      );
      return Object.freeze({ consumed: result.rowCount === 1 });
    } catch (error) {
      if (error instanceof EquivalencePostgresRuntimeError) throw error;
      fail('nonce_consumer_failed');
    }
  };
}

function validNullableUuid(value) {
  return value === null || UUID_PATTERN.test(value ?? '');
}

function validNullableBounded(value) {
  return value === null || bounded(value);
}

function validAudit(record) {
  return (
    exactFields(record, AUDIT_FIELDS)
    && record.schema_version === 'kernel-equivalence-denial-audit/v1'
    && record.status === 'blocked'
    && Number.isFinite(Date.parse(record.occurred_at))
    && CODE_PATTERN.test(record.code ?? '')
    && CODE_PATTERN.test(record.stage ?? '')
    && validNullableBounded(record.cell_id)
    && validNullableBounded(record.behavior_id)
    && (
      record.provider === null
      || ['claude', 'codex', 'grok'].includes(record.provider)
    )
    && (
      record.scenario === null
      || ['normal', 'violation', 'recovery'].includes(record.scenario)
    )
    && validNullableUuid(record.run_id)
    && validNullableUuid(record.attempt_id)
    && typeof record.late_effect_risk === 'boolean'
  );
}

export function createPostgresAuditSink({
  pool,
  randomUUID = nodeRandomUUID,
} = {}) {
  requireQueryPool(pool);
  if (typeof randomUUID !== 'function') fail('audit_uuid_source_invalid');
  return async function persistAudit(record) {
    if (!validAudit(record)) fail('audit_record_invalid');
    const auditId = randomUUID();
    if (!UUID_PATTERN.test(auditId ?? '')) fail('audit_uuid_source_invalid');
    try {
      const result = await pool.query(
        `INSERT INTO kernel_equivalence_denial_audits
           (audit_id, occurred_at, status, code, stage, cell_id, behavior_id,
            provider, scenario, run_id, attempt_id, late_effect_risk,
            schema_version)
         VALUES
           ($1::uuid, $2::timestamptz, $3, $4, $5, $6, $7,
            $8, $9, $10::uuid, $11::uuid, $12, $13)
         RETURNING audit_id`,
        [
          auditId,
          record.occurred_at,
          record.status,
          record.code,
          record.stage,
          record.cell_id,
          record.behavior_id,
          record.provider,
          record.scenario,
          record.run_id,
          record.attempt_id,
          record.late_effect_risk,
          record.schema_version,
        ],
      );
      if (result.rowCount !== 1 || result.rows[0]?.audit_id !== auditId) {
        fail('audit_persist_failed');
      }
      return Object.freeze({ persisted: true, audit_id: auditId });
    } catch (error) {
      if (error instanceof EquivalencePostgresRuntimeError) throw error;
      fail('audit_persist_failed');
    }
  };
}

function checkpoint(row) {
  const genesis = row?.genesis_hash ?? null;
  const head = row?.head_hash ?? null;
  if (
    !(
      (genesis === null && head === null)
      || (HASH_PATTERN.test(genesis) && HASH_PATTERN.test(head))
    )
  ) {
    fail('bundle_chain_checkpoint_invalid');
  }
  return Object.freeze({
    schema_version: 'kernel-equivalence-bundle-chain/v1',
    genesis_hash: genesis,
    head_hash: head,
  });
}

function parseBundle(value) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      fail('bundle_chain_readback_invalid');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('bundle_chain_readback_invalid');
  }
  return value;
}

function validBundleCommit(bundle, hash, previousHead) {
  return (
    bundle
    && typeof bundle === 'object'
    && !Array.isArray(bundle)
    && HASH_PATTERN.test(hash ?? '')
    && sha256Canonical(bundle) === hash
    && (
      previousHead === null
      || HASH_PATTERN.test(previousHead ?? '')
    )
    && bundle.previous_bundle_hash === previousHead
    && bounded(bundle.bundle_id)
    && CELL_PATTERN.test(bundle.cell_id ?? '')
    && bounded(bundle.behavior_id)
    && ['claude', 'codex', 'grok'].includes(bundle.provider)
    && ['normal', 'violation', 'recovery'].includes(bundle.scenario)
    && UUID_PATTERN.test(bundle.run_id ?? '')
    && UUID_PATTERN.test(bundle.attempt_id ?? '')
    && UUID_PATTERN.test(bundle.grant_id ?? '')
    && SHA_PATTERN.test(bundle.artifact_sha ?? '')
    && bounded(bundle.resource_id)
    && bounded(bundle.resource_ref, 2_048)
    && bounded(bundle.seam_id)
    && bounded(bundle.adapter_id)
  );
}

function validTransactionTimeout(value) {
  return (
    Number.isInteger(value)
    && value >= 1
    && value <= MAXIMUM_TRANSACTION_TIMEOUT_MS
  );
}

export function createPostgresBundleChainStore({
  pool,
  chainId = CHAIN_ID,
} = {}) {
  requireTransactionPool(pool);
  requireQueryPool(pool);
  if (chainId !== CHAIN_ID) fail('bundle_chain_id_invalid');
  let observedHead;
  let observedRevision;

  return Object.freeze({
    async getCheckpoint() {
      let result;
      try {
        result = await pool.query(
          `SELECT genesis_hash, head_hash, revision
             FROM kernel_equivalence_bundle_chain_heads
            WHERE chain_id = $1`,
          [chainId],
        );
      } catch {
        fail('bundle_chain_checkpoint_unavailable');
      }
      if (result.rowCount !== 1 || !Array.isArray(result.rows)) {
        fail('bundle_chain_checkpoint_unavailable');
      }
      const row = result.rows[0];
      const revision = Number(row.revision);
      if (!Number.isSafeInteger(revision) || revision < 0) {
        fail('bundle_chain_checkpoint_invalid');
      }
      const value = checkpoint(row);
      observedHead = value.head_hash;
      observedRevision = revision;
      return value;
    },

    async readBundle(hash) {
      if (!HASH_PATTERN.test(hash ?? '')) {
        fail('bundle_chain_read_unavailable');
      }
      let result;
      try {
        result = await pool.query(
          `SELECT bundle
             FROM kernel_equivalence_receipt_bundles
            WHERE chain_id = $1 AND bundle_hash = $2`,
          [chainId, hash],
        );
      } catch {
        fail('bundle_chain_read_unavailable');
      }
      if (result.rowCount !== 1 || !Array.isArray(result.rows)) {
        fail('bundle_chain_read_unavailable');
      }
      const bundle = parseBundle(result.rows[0].bundle);
      if (sha256Canonical(bundle) !== hash) {
        fail('bundle_chain_readback_invalid');
      }
      return structuredClone(bundle);
    },

    async commit({
      bundle,
      bundle_hash: bundleHash,
      previous_head_hash: previousHead,
      timeout_ms: timeoutMs = DEFAULT_TRANSACTION_TIMEOUT_MS,
    } = {}) {
      if (
        !validBundleCommit(bundle, bundleHash, previousHead)
        || !validTransactionTimeout(timeoutMs)
      ) {
        fail('bundle_chain_commit_invalid');
      }
      if (
        observedRevision === undefined
        || observedHead === undefined
        || observedHead !== previousHead
      ) {
        fail('bundle_chain_checkpoint_stale');
      }
      const client = await pool.connect().catch(() => {
        fail('bundle_chain_commit_failed');
      });
      let began = false;
      try {
        await client.query('BEGIN');
        began = true;
        await client.query(
          `SELECT
             set_config('statement_timeout', $1, true),
             set_config('lock_timeout', $1, true),
             set_config('idle_in_transaction_session_timeout', $1, true)`,
          [`${timeoutMs}ms`],
        );
        await client.query(
          `INSERT INTO kernel_equivalence_receipt_bundles
             (chain_id, bundle_hash, previous_bundle_hash, bundle_id, cell_id,
              behavior_id, provider, scenario, run_id, attempt_id,
              artifact_sha, resource_id, resource_ref, seam_id, adapter_id,
              grant_id, bundle)
           VALUES
             ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid, $10::uuid,
              $11, $12, $13, $14, $15, $16::uuid, $17::jsonb)
           ON CONFLICT (bundle_hash) DO NOTHING
           RETURNING bundle_hash`,
          [
            chainId,
            bundleHash,
            previousHead,
            bundle.bundle_id,
            bundle.cell_id,
            bundle.behavior_id,
            bundle.provider,
            bundle.scenario,
            bundle.run_id,
            bundle.attempt_id,
            bundle.artifact_sha,
            bundle.resource_id,
            bundle.resource_ref,
            bundle.seam_id,
            bundle.adapter_id,
            bundle.grant_id,
            JSON.stringify(bundle),
          ],
        );
        const advanced = await client.query(
          `UPDATE kernel_equivalence_bundle_chain_heads
              SET genesis_hash = COALESCE(genesis_hash, $2),
                  head_hash = $2,
                  revision = revision + 1,
                  updated_at = clock_timestamp()
            WHERE chain_id = $1
              AND head_hash IS NOT DISTINCT FROM $3
              AND revision = $4
          RETURNING genesis_hash, head_hash, revision`,
          [chainId, bundleHash, previousHead, observedRevision],
        );
        if (advanced.rowCount !== 1) {
          await client.query('ROLLBACK');
          began = false;
          return Object.freeze({ committed: false, checkpoint: null });
        }
        const readback = await client.query(
          `SELECT bundle
             FROM kernel_equivalence_receipt_bundles
            WHERE chain_id = $1 AND bundle_hash = $2`,
          [chainId, bundleHash],
        );
        if (readback.rowCount !== 1) fail('bundle_chain_readback_invalid');
        const durableBundle = parseBundle(readback.rows[0].bundle);
        if (
          sha256Canonical(durableBundle) !== bundleHash
          || sha256Canonical(durableBundle) !== sha256Canonical(bundle)
        ) {
          fail('bundle_chain_readback_invalid');
        }
        await client.query('COMMIT');
        began = false;
        observedHead = advanced.rows[0].head_hash;
        observedRevision = Number(advanced.rows[0].revision);
        return Object.freeze({
          committed: true,
          checkpoint: checkpoint(advanced.rows[0]),
        });
      } catch (error) {
        if (began) await client.query('ROLLBACK').catch(() => {});
        if (error instanceof EquivalencePostgresRuntimeError) throw error;
        if (POSTGRES_TIMEOUT_CODES.has(error?.code)) {
          fail('bundle_chain_commit_timeout');
        }
        fail('bundle_chain_commit_failed');
      } finally {
        client.release();
      }
    },
  });
}

function validPredecessorRequest(request) {
  return (
    exactFields(request, PREDECESSOR_FIELDS)
    && CELL_PATTERN.test(request.cell_id ?? '')
    && request.cell_id.endsWith('::violation')
    && bounded(request.behavior_id)
    && ['claude', 'codex', 'grok'].includes(request.provider)
    && request.scenario === 'violation'
    && UUID_PATTERN.test(request.run_id ?? '')
    && UUID_PATTERN.test(request.attempt_id ?? '')
    && SHA_PATTERN.test(request.artifact_sha ?? '')
    && bounded(request.resource_id)
    && bounded(request.resource_ref, 2_048)
    && bounded(request.seam_id)
    && bounded(request.adapter_id)
  );
}

export function createPostgresPredecessorResolver({ pool } = {}) {
  requireQueryPool(pool);
  return async function resolvePredecessor(request) {
    if (!validPredecessorRequest(request)) {
      fail('recovery_predecessor_request_invalid');
    }
    let result;
    try {
      result = await pool.query(
        `WITH RECURSIVE trusted_chain AS (
           SELECT b.bundle_hash, b.previous_bundle_hash, b.bundle,
                  b.cell_id, b.behavior_id, b.provider, b.scenario,
                  b.run_id, b.attempt_id, b.artifact_sha, b.resource_id,
                  b.resource_ref, b.seam_id, b.adapter_id, b.committed_at
             FROM kernel_equivalence_bundle_chain_heads h
             JOIN kernel_equivalence_receipt_bundles b
               ON b.chain_id = h.chain_id
              AND b.bundle_hash = h.head_hash
            WHERE h.chain_id = $1
           UNION ALL
           SELECT parent.bundle_hash, parent.previous_bundle_hash,
                  parent.bundle, parent.cell_id, parent.behavior_id,
                  parent.provider, parent.scenario, parent.run_id,
                  parent.attempt_id, parent.artifact_sha,
                  parent.resource_id, parent.resource_ref, parent.seam_id,
                  parent.adapter_id, parent.committed_at
             FROM kernel_equivalence_receipt_bundles parent
             JOIN trusted_chain child
               ON parent.chain_id = $1
              AND parent.bundle_hash = child.previous_bundle_hash
         )
         SELECT bundle_hash, bundle
           FROM trusted_chain
          WHERE cell_id = $2
            AND behavior_id = $3
            AND provider = $4
            AND scenario = 'violation'
            AND run_id = $5::uuid
            AND attempt_id = $6::uuid
            AND artifact_sha = $7
            AND resource_id = $8
            AND resource_ref = $9
            AND seam_id = $10
            AND adapter_id = $11
          ORDER BY committed_at DESC
          LIMIT 2`,
        [
          CHAIN_ID,
          request.cell_id,
          request.behavior_id,
          request.provider,
          request.run_id,
          request.attempt_id,
          request.artifact_sha,
          request.resource_id,
          request.resource_ref,
          request.seam_id,
          request.adapter_id,
        ],
      );
    } catch {
      fail('recovery_predecessor_unavailable');
    }
    if (result.rows.length > 1) fail('recovery_predecessor_ambiguous');
    if (result.rows.length !== 1) fail('recovery_predecessor_unavailable');
    let bundle;
    try {
      bundle = parseBundle(result.rows[0].bundle);
    } catch {
      fail('recovery_predecessor_invalid');
    }
    if (
      !HASH_PATTERN.test(result.rows[0].bundle_hash ?? '')
      || sha256Canonical(bundle) !== result.rows[0].bundle_hash
      || !Array.isArray(bundle.execution_grants)
      || bundle.execution_grants.length !== 1
      || !Array.isArray(bundle.effect_receipts)
      || bundle.effect_receipts.length !== 1
      || bundle.cell_id !== request.cell_id
      || bundle.behavior_id !== request.behavior_id
      || bundle.provider !== request.provider
      || bundle.scenario !== 'violation'
      || bundle.run_id !== request.run_id
      || bundle.attempt_id !== request.attempt_id
      || bundle.artifact_sha !== request.artifact_sha
      || bundle.resource_id !== request.resource_id
      || bundle.resource_ref !== request.resource_ref
      || bundle.seam_id !== request.seam_id
      || bundle.adapter_id !== request.adapter_id
    ) {
      fail('recovery_predecessor_invalid');
    }
    return Object.freeze({
      grant: Object.freeze(structuredClone(bundle.execution_grants[0])),
      receipt: Object.freeze(structuredClone(bundle.effect_receipts[0])),
    });
  };
}
