import {
  PROOF_PROVIDERS,
  PROOF_SCENARIOS,
} from './kernel-equivalence-axes.js';
import {
  preloadReceiptBundleAncestry,
  sha256Canonical,
  verifyEffectReceipt,
  verifyExecutionGrant,
  verifyReceiptBundle,
  validateTrustRegistry,
} from './kernel-equivalence-receipts.js';
import {
  verifyCleanupEvidence,
} from './kernel-equivalence-runtime-registry.js';

const REQUIRED_BEHAVIOR_COUNT = 11;
const SAFE_ENVIRONMENTS = new Set(['isolated', 'ephemeral']);
const SAFE_RESOURCE_TYPES = new Set([
  'ephemeral_branch',
  'ephemeral_credential_lease',
  'ephemeral_database_record',
  'ephemeral_run',
  'ephemeral_staging',
  'ephemeral_workspace',
]);
const SAFE_PREFIX_TEMPLATE =
  /^(?:refs\/heads\/)?equivalence-drill\/\{run_id\}\/\{attempt_id\}\/(?:[a-z0-9][a-z0-9_-]{0,127}\/)*$/;
const FORBIDDEN_RESOURCE = /(?:^|[/_.:-])(?:main|master|production|prod|release)(?:$|[/_.:-])/i;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const TRUSTED_VERIFICATION_ERROR_CODES = new Set([
  'bundle_axis_mismatch',
  'bundle_expired',
  'bundle_fields_invalid',
  'bundle_freshness_invalid',
  'bundle_grant_count_invalid',
  'bundle_hash_chain_invalid',
  'bundle_identity_invalid',
  'bundle_key_invalid',
  'bundle_not_yet_valid',
  'bundle_previous_unresolved',
  'bundle_receipt_count_invalid',
  'bundle_recovery_grants_invalid',
  'bundle_recovery_receipts_invalid',
  'bundle_signature_invalid',
  'bundle_time_invalid',
  'effect_axis_mismatch',
  'effect_expired',
  'effect_fields_invalid',
  'effect_freshness_invalid',
  'effect_identity_invalid',
  'effect_key_invalid',
  'effect_not_yet_valid',
  'effect_outcome_invalid',
  'effect_signature_invalid',
  'effect_time_invalid',
  'grant_axis_mismatch',
  'grant_environment_unsafe',
  'grant_expired',
  'grant_fields_invalid',
  'grant_freshness_invalid',
  'grant_identity_invalid',
  'grant_key_invalid',
  'grant_not_yet_valid',
  'grant_signature_invalid',
  'grant_time_invalid',
  'recovery_lineage_invalid',
  'trust_key_fields_invalid',
  'trust_key_time_invalid',
  'trust_registry_invalid',
  'verification_time_invalid',
]);
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export class EquivalenceDrillError extends Error {
  constructor(code, detail = null) {
    super(code);
    this.name = 'EquivalenceDrillError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, detail = null) {
  throw new EquivalenceDrillError(code, detail);
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function activeEffectKey(registry, keyId, seamId, now) {
  return Array.isArray(registry?.keys)
    && registry.keys.some((key) => (
      key?.key_id === keyId
      && key?.purpose === 'effect_receipt'
      && key?.service_id === seamId
      && key?.revoked_at == null
      && Date.parse(key.not_before) <= now
      && now < Date.parse(key.not_after)
    ));
}

function validateIsolation(isolation, behaviorId) {
  if (
    !SAFE_ENVIRONMENTS.has(isolation.environment)
    || !SAFE_RESOURCE_TYPES.has(isolation.resource_type)
    || !nonEmpty(isolation.resource_prefix)
    || isolation.resource_prefix.length > 512
    || !SAFE_PREFIX_TEMPLATE.test(isolation.resource_prefix)
    || FORBIDDEN_RESOURCE.test(isolation.resource_prefix)
  ) {
    fail('drill_isolation_unsafe', behaviorId);
  }
}

function validateScenarios(scenarios, behaviorId) {
  const keys = Object.keys(scenarios).sort();
  const expected = [...PROOF_SCENARIOS].sort();
  if (
    keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])
  ) {
    fail('drill_scenario_catalog_invalid', behaviorId);
  }
  for (const scenario of PROOF_SCENARIOS) {
    const descriptor = asObject(scenarios[scenario]);
    if (!nonEmpty(descriptor.expected_outcome) || !nonEmpty(descriptor.effect_code)) {
      fail('drill_scenario_contract_invalid', `${behaviorId}:${scenario}`);
    }
    if (
      scenario === 'recovery'
      && descriptor.predecessor_scenario !== 'violation'
    ) {
      fail('drill_recovery_predecessor_invalid', behaviorId);
    }
  }
}

export function compileDrillPlan(
  contract,
  { now = Date.now() } = {},
) {
  if (!Number.isFinite(now)) fail('verification_time_invalid');
  const section = asObject(contract?.behavior_equivalence);
  const behaviors = Array.isArray(section.behaviors) ? section.behaviors : [];
  if (
    section.required_behavior_count !== REQUIRED_BEHAVIOR_COUNT
    || behaviors.length !== REQUIRED_BEHAVIOR_COUNT
  ) {
    fail('drill_behavior_count_invalid');
  }
  validateTrustRegistry(section.drill_trust_registry);
  const bundleChain = asObject(section.drill_bundle_chain);
  const bundleChainFields = Object.keys(bundleChain).sort();
  if (
    bundleChainFields.join(',') !== 'genesis_hash,head_hash,schema_version'
    || bundleChain.schema_version !== 'kernel-equivalence-bundle-chain/v1'
    || !(
      (
        bundleChain.genesis_hash == null
        && bundleChain.head_hash == null
      )
      || (
        HASH_PATTERN.test(bundleChain.genesis_hash ?? '')
        && HASH_PATTERN.test(bundleChain.head_hash ?? '')
      )
    )
  ) {
    fail('drill_bundle_chain_invalid');
  }

  const ids = new Set();
  const descriptors = behaviors.map((behavior) => {
    const behaviorId = behavior?.behavior_id;
    if (!nonEmpty(behaviorId)) fail('drill_behavior_id_invalid');
    if (ids.has(behaviorId)) fail('drill_behavior_id_duplicate', behaviorId);
    ids.add(behaviorId);

    const drill = asObject(behavior.drill);
    const isolation = asObject(drill.isolation);
    const scenarios = asObject(drill.scenarios);
    if (
      !nonEmpty(drill.seam_id)
      || !nonEmpty(drill.seam_ref)
      || !nonEmpty(drill.adapter_id)
      || drill.effect_key_purpose !== 'effect_receipt'
      || !['available', 'missing'].includes(drill.effect_signer_status)
    ) {
      fail('drill_descriptor_invalid', behaviorId);
    }
    validateIsolation(isolation, behaviorId);
    validateScenarios(scenarios, behaviorId);

    if (drill.effect_signer_status === 'missing') {
      if (drill.blocked_by !== 'seam_receipt_signer_missing') {
        fail('drill_missing_signer_blocker_invalid', behaviorId);
      }
    } else if (
      !nonEmpty(drill.effect_key_id)
      || !activeEffectKey(
        section.drill_trust_registry,
        drill.effect_key_id,
        drill.seam_id,
        now,
      )
    ) {
      const exists = section.drill_trust_registry.keys.some(
        (key) => key?.key_id === drill.effect_key_id,
      );
      fail(
        exists
          ? 'drill_effect_signer_key_inactive'
          : 'drill_effect_signer_key_missing',
        behaviorId,
      );
    }

    return {
      behavior_id: behaviorId,
      priority: behavior.priority,
      owner: behavior.owner,
      seam_id: drill.seam_id,
      seam_ref: drill.seam_ref,
      adapter_id: drill.adapter_id,
      effect_signer_status: drill.effect_signer_status,
      effect_key_id: drill.effect_key_id ?? null,
      blocked_by: drill.blocked_by ?? null,
      isolation,
      scenarios,
    };
  });

  const cells = descriptors.flatMap((descriptor) => (
    PROOF_PROVIDERS.flatMap((provider) => (
      PROOF_SCENARIOS.map((scenario) => ({
        cell_id: `${descriptor.behavior_id}::${provider}::${scenario}`,
        behavior_id: descriptor.behavior_id,
        priority: descriptor.priority,
        owner: descriptor.owner,
        provider,
        scenario,
        seam_id: descriptor.seam_id,
        seam_ref: descriptor.seam_ref,
        adapter_id: descriptor.adapter_id,
        effect_signer_status: descriptor.effect_signer_status,
        effect_key_id: descriptor.effect_key_id,
        blocked_by: descriptor.blocked_by,
        isolation: structuredClone(descriptor.isolation),
        expected: {
          ...structuredClone(descriptor.scenarios[scenario]),
          ...(scenario === 'recovery'
            ? {
              predecessor_expected:
                structuredClone(descriptor.scenarios.violation),
            }
            : {}),
        },
      }))
    ))
  )).sort((left, right) => left.cell_id.localeCompare(right.cell_id));

  if (
    cells.length !== REQUIRED_BEHAVIOR_COUNT
      * PROOF_PROVIDERS.length
      * PROOF_SCENARIOS.length
    || new Set(cells.map((cell) => cell.cell_id)).size !== cells.length
  ) {
    fail('drill_cell_matrix_invalid');
  }

  return Object.freeze({
    schema_version: 'kernel-equivalence-drill-plan/v1',
    contract_version: section.contract_version ?? null,
    behavior_count: descriptors.length,
    cells,
  });
}

function denialAudit(cell, grant, code, stage, now) {
  return Object.freeze({
    schema_version: 'kernel-equivalence-denial-audit/v1',
    occurred_at: new Date(now).toISOString(),
    status: 'blocked',
    code,
    stage,
    cell_id: cell?.cell_id ?? null,
    behavior_id: cell?.behavior_id ?? null,
    provider: cell?.provider ?? null,
    scenario: cell?.scenario ?? null,
    run_id: UUID_PATTERN.test(grant?.run_id ?? '') ? grant.run_id : null,
    attempt_id: UUID_PATTERN.test(grant?.attempt_id ?? '') ? grant.attempt_id : null,
    late_effect_risk: code === 'adapter_cancellation_unconfirmed',
  });
}

async function blocked({
  cell,
  grant,
  code,
  stage,
  now,
  auditSink,
  timeoutMs,
}) {
  const audit = denialAudit(cell, grant, code, stage, now);
  let auditDelivery = typeof auditSink === 'function'
    ? 'failed'
    : 'not_configured';
  if (typeof auditSink === 'function') {
    try {
      await withTimeout(
        () => auditSink(audit),
        timeoutMs,
        'audit_sink_timeout',
      );
      auditDelivery = 'delivered';
    } catch (error) {
      auditDelivery = error?.code === 'audit_sink_timeout'
        ? 'timed_out'
        : 'failed';
      // A denial audit sink cannot turn a denied execution into an allowed one.
    }
  }
  return Object.freeze({
    status: 'blocked',
    code,
    bundle: null,
    audit,
    audit_delivery: auditDelivery,
  });
}

function errorCode(error, fallback, { trusted = false } = {}) {
  return trusted
    && nonEmpty(error?.code)
    && TRUSTED_VERIFICATION_ERROR_CODES.has(error.code)
    ? error.code
    : fallback;
}

function isInternalTimeout(error, code) {
  return error instanceof EquivalenceDrillError && error.code === code;
}

function sampleTrustedClock(clock) {
  try {
    const value = typeof clock === 'function' ? clock() : clock;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

async function withTimeout(
  operation,
  timeoutMs,
  timeoutCode = 'adapter_timeout',
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    fail('adapter_timeout_invalid');
  }
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new EquivalenceDrillError(timeoutCode)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function withAbortableTimeout(operation, timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    fail('adapter_timeout_invalid');
  }
  const controller = new AbortController();
  const operationPromise = Promise.resolve().then(
    () => operation(controller.signal),
  );
  let timer;
  try {
    return await Promise.race([
      operationPromise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new EquivalenceDrillError('adapter_timeout');
          error.abortContext = {
            signal: controller.signal,
            operationPromise,
          };
          controller.abort();
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    operationPromise.catch(() => {});
  }
}

function resolveExecutionAuthorities(adapters, cell, cleanupVerifier) {
  if (typeof adapters?.resolveForCell === 'function') {
    const selected = adapters.resolveForCell(cell);
    if (selected?.adapter && typeof selected.verifyCleanup === 'function') {
      return {
        adapter: selected.adapter,
        cleanupVerifier: selected.verifyCleanup,
      };
    }
    return {
      adapter: selected,
      cleanupVerifier,
    };
  }
  const adapter = adapters instanceof Map
    ? adapters.get(cell?.adapter_id)
    : (
      adapters && typeof adapters === 'object'
        ? adapters[cell?.adapter_id]
        : null
    );
  return { adapter, cleanupVerifier };
}

function expectedFromGrant(cell, grant) {
  return {
    cell,
    run_id: grant?.run_id,
    attempt_id: grant?.attempt_id,
    artifact_sha: grant?.artifact_sha,
    brain_version: grant?.brain_version,
    engine_version: grant?.engine_version,
    grant_id: grant?.grant_id,
    nonce: grant?.nonce,
    resource_id: grant?.resource_id,
    resource_ref: grant?.resource_ref,
    resource_prefix: grant?.resource_prefix,
  };
}

function violationCellFor(recoveryCell) {
  return {
    ...recoveryCell,
    cell_id: recoveryCell.cell_id.replace(/::recovery$/, '::violation'),
    scenario: 'violation',
    expected: structuredClone(
      recoveryCell?.expected?.predecessor_expected ?? {},
    ),
  };
}

function sameRecoveryBoundary(violationGrant, recoveryGrant) {
  return (
    violationGrant.run_id === recoveryGrant.run_id
    && violationGrant.attempt_id === recoveryGrant.attempt_id
    && violationGrant.artifact_sha === recoveryGrant.artifact_sha
    && violationGrant.brain_version === recoveryGrant.brain_version
    && violationGrant.engine_version === recoveryGrant.engine_version
    && violationGrant.resource_id === recoveryGrant.resource_id
    && violationGrant.resource_ref === recoveryGrant.resource_ref
    && violationGrant.resource_prefix === recoveryGrant.resource_prefix
    && violationGrant.seam_id === recoveryGrant.seam_id
    && violationGrant.adapter_id === recoveryGrant.adapter_id
  );
}

function validChainCheckpoint(checkpoint) {
  const genesis = checkpoint?.genesis_hash;
  const head = checkpoint?.head_hash;
  return (
    checkpoint?.schema_version === 'kernel-equivalence-bundle-chain/v1'
    && (
      (genesis == null && head == null)
      || (HASH_PATTERN.test(genesis ?? '') && HASH_PATTERN.test(head ?? ''))
    )
  );
}

async function confirmCleanup(
  adapter,
  context,
  timeoutMs,
  cleanupVerifier,
) {
  if (typeof cleanupVerifier !== 'function') {
    return { error: 'cleanup_verifier_unavailable', evidence: null };
  }
  try {
    const cleanup = await withTimeout(
      () => adapter.cleanup(context),
      timeoutMs,
    );
    const verification = await withTimeout(
      () => cleanupVerifier({ ...context, cleanup }),
      timeoutMs,
      'cleanup_verifier_timeout',
    );
    if (verification?.confirmed !== true) {
      return { error: 'adapter_cleanup_unconfirmed', evidence: null };
    }
    return {
      error: null,
      evidence: verifyCleanupEvidence(
        verification.evidence,
        { ...context, cleanup },
      ),
    };
  } catch (error) {
    if (error?.code === 'cleanup_evidence_invalid') {
      return { error: 'cleanup_evidence_invalid', evidence: null };
    }
    if (error?.code === 'adapter_timeout') {
      return { error: 'adapter_cleanup_timeout', evidence: null };
    }
    if (error?.code === 'cleanup_verifier_timeout') {
      return { error: 'cleanup_verifier_timeout', evidence: null };
    }
    return { error: 'adapter_cleanup_failed', evidence: null };
  }
}

async function operationCancelled(operationPromise, timeoutMs) {
  try {
    const result = await withTimeout(
      () => operationPromise.then(
        () => ({ settled: 'resolved' }),
        () => ({ settled: 'rejected' }),
      ),
      timeoutMs,
      'adapter_cancellation_settlement_timeout',
    );
    return result.settled === 'rejected';
  } catch {
    return false;
  }
}

async function confirmCancellation(
  adapter,
  phase,
  context,
  timeoutError,
  timeoutMs,
) {
  if (
    timeoutError?.code !== 'adapter_timeout'
    || typeof adapter.cancel !== 'function'
  ) {
    return false;
  }
  try {
    const cancellation = await withTimeout(
      () => adapter.cancel({
        ...context,
        phase,
        signal: timeoutError.abortContext?.signal,
      }),
      timeoutMs,
    );
    if (cancellation?.confirmed !== true || phase === 'observe') return false;
    return operationCancelled(timeoutError.abortContext?.operationPromise, timeoutMs);
  } catch {
    return false;
  }
}

export async function executeDrillCell({
  cell,
  grant,
  trustRegistry,
  nonceConsumer,
  adapters,
  collector,
  bundleChainStore = null,
  cleanupVerifier = null,
  predecessorResolver = null,
  auditSink = null,
  now = Date.now,
  timeoutMs = 30_000,
} = {}) {
  const auditNow = sampleTrustedClock(now);
  const deny = (code, stage) => blocked({
    cell,
    grant,
    code,
    stage,
    now: auditNow ?? Date.now(),
    auditSink,
    timeoutMs,
  });
  if (auditNow == null) {
    return deny('verification_time_invalid', 'clock_validation');
  }

  if (
    cell?.effect_signer_status !== 'available'
    || cell?.blocked_by === 'seam_receipt_signer_missing'
  ) {
    return deny(
      cell?.blocked_by ?? 'seam_receipt_signer_missing',
      'signer_preflight',
    );
  }

  if (
    !bundleChainStore
    || typeof bundleChainStore.getCheckpoint !== 'function'
    || typeof bundleChainStore.readBundle !== 'function'
    || typeof bundleChainStore.commit !== 'function'
  ) {
    return deny('bundle_chain_store_unavailable', 'bundle_chain');
  }
  let chainCheckpoint;
  try {
    chainCheckpoint = await withTimeout(
      () => bundleChainStore.getCheckpoint(),
      timeoutMs,
      'bundle_chain_checkpoint_timeout',
    );
  } catch (error) {
    return deny(
      isInternalTimeout(error, 'bundle_chain_checkpoint_timeout')
        ? 'bundle_chain_checkpoint_timeout'
        : 'bundle_chain_checkpoint_invalid',
      'bundle_chain',
    );
  }
  if (!validChainCheckpoint(chainCheckpoint)) {
    return deny('bundle_chain_checkpoint_invalid', 'bundle_chain');
  }

  let verifiedGrant;
  const grantVerificationNow = sampleTrustedClock(now);
  if (grantVerificationNow == null) {
    return deny('verification_time_invalid', 'clock_validation');
  }
  try {
    verifiedGrant = verifyExecutionGrant(
      grant,
      trustRegistry,
      expectedFromGrant(cell, grant),
      { now: grantVerificationNow },
    );
  } catch (error) {
    return deny(
      errorCode(error, 'grant_invalid', { trusted: true }),
      'grant_verification',
    );
  }

  let executionAuthorities;
  try {
    executionAuthorities = resolveExecutionAuthorities(
      adapters,
      cell,
      cleanupVerifier,
    );
  } catch {
    return deny('drill_adapter_unavailable', 'adapter_preflight');
  }
  const {
    adapter,
    cleanupVerifier: selectedCleanupVerifier,
  } = executionAuthorities;
  if (
    !adapter
    || typeof adapter.prepare !== 'function'
    || typeof adapter.invokeActualSeam !== 'function'
    || typeof adapter.observe !== 'function'
    || typeof adapter.cleanup !== 'function'
  ) {
    return deny('drill_adapter_unavailable', 'adapter_preflight');
  }

  let predecessorGrant = null;
  let predecessorReceipt = null;
  if (cell.scenario === 'recovery') {
    if (typeof predecessorResolver !== 'function') {
      return deny(
        'recovery_predecessor_unavailable',
        'recovery_predecessor',
      );
    }
    let predecessor;
    try {
      const resolvedPredecessor = await withTimeout(() => predecessorResolver({
        cell_id: violationCellFor(cell).cell_id,
        behavior_id: cell.behavior_id,
        provider: cell.provider,
        scenario: 'violation',
        run_id: verifiedGrant.run_id,
        attempt_id: verifiedGrant.attempt_id,
        artifact_sha: verifiedGrant.artifact_sha,
        resource_id: verifiedGrant.resource_id,
        resource_ref: verifiedGrant.resource_ref,
        seam_id: cell.seam_id,
        adapter_id: cell.adapter_id,
      }), timeoutMs, 'recovery_predecessor_timeout');
      predecessor = structuredClone(resolvedPredecessor);
    } catch (error) {
      return deny(
        isInternalTimeout(error, 'recovery_predecessor_timeout')
          ? 'recovery_predecessor_timeout'
          : 'recovery_predecessor_unavailable',
        'recovery_predecessor',
      );
    }
    try {
      const ancestryVerificationNow = sampleTrustedClock(now);
      if (ancestryVerificationNow == null) {
        return deny('verification_time_invalid', 'clock_validation');
      }
      const violationCell = violationCellFor(cell);
      if (
        chainCheckpoint.head_hash == null
        || !HASH_PATTERN.test(predecessor?.bundle_hash ?? '')
        || sha256Canonical(predecessor?.bundle) !== predecessor.bundle_hash
      ) {
        return deny(
          'recovery_predecessor_unavailable',
          'recovery_predecessor',
        );
      }
      const ancestry = await withTimeout(
        () => preloadReceiptBundleAncestry({
          headHash: chainCheckpoint.head_hash,
          genesisHash: chainCheckpoint.genesis_hash,
          readBundle: bundleChainStore.readBundle,
          trustRegistry,
          now: ancestryVerificationNow,
        }),
        timeoutMs,
        'recovery_predecessor_timeout',
      );
      if (!ancestry.bundle_hashes.includes(predecessor.bundle_hash)) {
        return deny(
          'recovery_predecessor_unavailable',
          'recovery_predecessor',
        );
      }
      const trustedPredecessorBundle =
        ancestry.readBundle(predecessor.bundle_hash);
      if (
        sha256Canonical(trustedPredecessorBundle)
          !== sha256Canonical(predecessor.bundle)
      ) {
        return deny(
          'recovery_predecessor_unavailable',
          'recovery_predecessor',
        );
      }
      const predecessorVerificationNow =
        Date.parse(trustedPredecessorBundle.issued_at);
      predecessorGrant = verifyExecutionGrant(
        trustedPredecessorBundle.execution_grants?.[0],
        trustRegistry,
        expectedFromGrant(
          violationCell,
          trustedPredecessorBundle.execution_grants?.[0],
        ),
        { now: predecessorVerificationNow },
      );
      if (!sameRecoveryBoundary(predecessorGrant, verifiedGrant)) {
        return deny(
          'recovery_predecessor_axis_mismatch',
          'recovery_predecessor',
        );
      }
      predecessorReceipt = verifyEffectReceipt(
        trustedPredecessorBundle.effect_receipts?.[0],
        trustRegistry,
        expectedFromGrant(violationCell, predecessorGrant),
        { now: predecessorVerificationNow },
      );
      if (
        predecessorReceipt.observed_outcome
          !== violationCell.expected.expected_outcome
        || predecessorReceipt.effect_code
          !== violationCell.expected.effect_code
      ) {
        return deny(
          'recovery_predecessor_contract_mismatch',
          'recovery_predecessor',
        );
      }
    } catch (error) {
      return deny(
        errorCode(error, 'recovery_predecessor_unavailable', { trusted: true }),
        'recovery_predecessor',
      );
    }
  }

  if (typeof nonceConsumer !== 'function') {
    return deny('nonce_consumer_unavailable', 'nonce_consumption');
  }
  try {
    const nonceResult = await withTimeout(() => nonceConsumer({
      grant_id: verifiedGrant.grant_id,
      nonce: verifiedGrant.nonce,
      cell_id: verifiedGrant.cell_id,
      run_id: verifiedGrant.run_id,
      attempt_id: verifiedGrant.attempt_id,
      expires_at: verifiedGrant.expires_at,
    }), timeoutMs, 'nonce_consumer_timeout');
    if (nonceResult?.consumed !== true) {
      return deny('grant_nonce_replay', 'nonce_consumption');
    }
  } catch (error) {
    return deny(
      error?.code === 'nonce_consumer_timeout'
        ? 'nonce_consumer_timeout'
        : 'grant_nonce_replay',
      'nonce_consumption',
    );
  }

  const verifiedPredecessor = predecessorGrant == null
    ? null
    : Object.freeze({
      grant: predecessorGrant,
      receipt: predecessorReceipt,
    });
  const context = Object.freeze({
    cell,
    grant: verifiedGrant,
    predecessor: verifiedPredecessor,
  });
  const compensations = [];
  const registerCompensation = (compensation) => {
    if (compensation != null) compensations.push(compensation);
  };
  let prepared;
  try {
    prepared = await withAbortableTimeout(
      (signal) => adapter.prepare({
        ...context,
        signal,
        registerCompensation,
      }),
      timeoutMs,
    );
  } catch (error) {
    const code = isInternalTimeout(error, 'adapter_timeout')
      ? 'adapter_timeout'
      : 'adapter_prepare_failed';
    const cancellationConfirmed = code === 'adapter_timeout'
      ? await confirmCancellation(
        adapter,
        'prepare',
        { ...context, compensations },
        error,
        timeoutMs,
      )
      : true;
    const cleanupResult = await confirmCleanup(
      adapter,
      {
        ...context,
        prepared: null,
        compensations,
      },
      timeoutMs,
      selectedCleanupVerifier,
    );
    if (!cancellationConfirmed) {
      return deny(
        'adapter_cancellation_unconfirmed',
        'adapter_prepare_cancellation',
      );
    }
    if (cleanupResult.error) {
      return deny(cleanupResult.error, 'adapter_cleanup');
    }
    return deny(code, 'adapter_prepare');
  }

  let receipt;
  let executionError = null;
  let executionStage = 'invoke';
  let timeoutError = null;
  try {
    const seamOutput = await withAbortableTimeout(
      (signal) => adapter.invokeActualSeam({
        ...context,
        prepared,
        compensations,
        signal,
      }),
      timeoutMs,
    );
    executionStage = 'observe';
    receipt = await withAbortableTimeout(
      (signal) => adapter.observe(
        seamOutput,
        {
          ...context,
          prepared,
          compensations,
          signal,
        },
      ),
      timeoutMs,
    );
  } catch (error) {
    executionError = isInternalTimeout(error, 'adapter_timeout')
      ? 'adapter_timeout'
      : 'adapter_execution_failed';
    if (executionError === 'adapter_timeout') timeoutError = error;
  }

  if (timeoutError) {
    const cancellationConfirmed = await confirmCancellation(
      adapter,
      executionStage,
      { ...context, prepared, compensations },
      timeoutError,
      timeoutMs,
    );
    if (!cancellationConfirmed) {
      executionError = 'adapter_cancellation_unconfirmed';
    }
  }
  const cleanupResult = await confirmCleanup(
    adapter,
    { ...context, prepared, compensations },
    timeoutMs,
    selectedCleanupVerifier,
  );
  if (
    cleanupResult.error
    && executionError !== 'adapter_cancellation_unconfirmed'
  ) {
    return deny(cleanupResult.error, 'adapter_cleanup');
  }
  if (executionError) return deny(executionError, 'seam_execution');

  const effectVerificationNow = sampleTrustedClock(now);
  if (effectVerificationNow == null) {
    return deny('verification_time_invalid', 'clock_validation');
  }
  try {
    receipt = verifyEffectReceipt(
      receipt,
      trustRegistry,
      {
        ...expectedFromGrant(cell, verifiedGrant),
        predecessor: predecessorReceipt,
      },
      { now: effectVerificationNow },
    );
  } catch (error) {
    return deny(
      errorCode(error, 'effect_receipt_invalid', { trusted: true }),
      'effect_verification',
    );
  }

  if (
    !nonEmpty(cell?.expected?.expected_outcome)
    || !nonEmpty(cell?.expected?.effect_code)
    || receipt.observed_outcome !== cell.expected.expected_outcome
    || receipt.effect_code !== cell.expected.effect_code
  ) {
    return deny('effect_contract_mismatch', 'effect_contract');
  }

  if (typeof collector !== 'function') {
    return deny('collector_unavailable', 'collector');
  }
  let bundle;
  const executionGrants = predecessorGrant
    ? [predecessorGrant, verifiedGrant]
    : [verifiedGrant];
  const receipts = predecessorReceipt
    ? [predecessorReceipt, receipt]
    : [receipt];
  try {
    const collectedBundle = await withTimeout(() => collector({
      cell,
      grant: verifiedGrant,
      executionGrants,
      receipts,
      cleanupEvidence: cleanupResult.evidence,
      previousBundleHash: chainCheckpoint.head_hash,
    }), timeoutMs, 'collector_timeout');
    bundle = structuredClone(collectedBundle);
  } catch (error) {
    return deny(
      isInternalTimeout(error, 'collector_timeout')
        ? 'collector_timeout'
        : 'collector_failed',
      'collector',
    );
  }

  const bundleVerificationNow = sampleTrustedClock(now);
  if (bundleVerificationNow == null) {
    return deny('verification_time_invalid', 'clock_validation');
  }
  if (bundle.previous_bundle_hash !== chainCheckpoint.head_hash) {
    if (bundle?.previous_bundle_hash == null) {
      try {
        verifyReceiptBundle(
          bundle,
          trustRegistry,
          expectedFromGrant(cell, verifiedGrant),
          { now: bundleVerificationNow },
        );
      } catch (error) {
        return deny(
          errorCode(error, 'bundle_invalid', { trusted: true }),
          'collector',
        );
      }
    }
    return deny('bundle_previous_head_mismatch', 'collector');
  }
  let previousSnapshot = null;
  if (chainCheckpoint.head_hash != null) {
    try {
      previousSnapshot = await withTimeout(
        () => preloadReceiptBundleAncestry({
          headHash: chainCheckpoint.head_hash,
          genesisHash: chainCheckpoint.genesis_hash,
          readBundle: bundleChainStore.readBundle,
          trustRegistry,
          now: bundleVerificationNow,
        }),
        timeoutMs,
        'bundle_chain_read_timeout',
      );
    } catch (error) {
      return deny(
        isInternalTimeout(error, 'bundle_chain_read_timeout')
          ? 'bundle_chain_read_timeout'
          : errorCode(error, 'bundle_previous_unresolved', { trusted: true }),
        'bundle_chain',
      );
    }
  }

  let verifiedBundle;
  try {
    verifiedBundle = verifyReceiptBundle(
      bundle,
      trustRegistry,
      expectedFromGrant(cell, verifiedGrant),
      {
        now: bundleVerificationNow,
        resolvePreviousBundle: previousSnapshot?.readBundle ?? null,
      },
    );
  } catch (error) {
    return deny(
      errorCode(error, 'bundle_invalid', { trusted: true }),
      'collector',
    );
  }
  if (
    sha256Canonical(bundle.cleanup_evidence)
      !== sha256Canonical(cleanupResult.evidence)
  ) {
    return deny('cleanup_evidence_invalid', 'collector');
  }
  let committed;
  try {
    const commitResult = await bundleChainStore.commit({
      bundle,
      bundle_hash: verifiedBundle.bundle_hash,
      previous_head_hash: chainCheckpoint.head_hash,
      timeout_ms: timeoutMs,
    });
    committed = structuredClone(commitResult);
  } catch (error) {
    return deny(
      error?.code === 'bundle_chain_commit_timeout'
        ? 'bundle_chain_commit_timeout'
        : 'bundle_chain_commit_failed',
      'bundle_chain',
    );
  }
  const expectedGenesis =
    chainCheckpoint.genesis_hash ?? verifiedBundle.bundle_hash;
  if (
    committed?.committed !== true
    || !validChainCheckpoint(committed.checkpoint)
    || committed.checkpoint.genesis_hash !== expectedGenesis
    || committed.checkpoint.head_hash !== verifiedBundle.bundle_hash
  ) {
    return deny('bundle_chain_commit_failed', 'bundle_chain');
  }
  return Object.freeze({
    status: 'collected',
    code: 'drill_receipt_collected',
    bundle: verifiedBundle,
    audit: null,
  });
}
