import {
  PROOF_PROVIDERS,
  PROOF_SCENARIOS,
} from './kernel-behavior-equivalence.js';
import {
  verifyEffectReceipt,
  verifyExecutionGrant,
  verifyReceiptBundle,
} from './kernel-equivalence-receipts.js';

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
const SAFE_PREFIX = /^(?:refs\/heads\/)?equivalence-drill\/[a-z0-9_{}./:-]+$/;
const FORBIDDEN_RESOURCE = /(?:^|[/_.:-])(?:main|master|production|prod|release)(?:$|[/_.:-])/i;

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

function activeEffectKey(registry, keyId, seamId) {
  return Array.isArray(registry?.keys)
    && registry.keys.some((key) => (
      key?.key_id === keyId
      && key?.purpose === 'effect_receipt'
      && key?.service_id === seamId
      && key?.revoked_at == null
    ));
}

function validateIsolation(isolation, behaviorId) {
  if (
    !SAFE_ENVIRONMENTS.has(isolation.environment)
    || !SAFE_RESOURCE_TYPES.has(isolation.resource_type)
    || !nonEmpty(isolation.resource_prefix)
    || !SAFE_PREFIX.test(isolation.resource_prefix)
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

export function compileDrillPlan(contract) {
  const section = asObject(contract?.behavior_equivalence);
  const behaviors = Array.isArray(section.behaviors) ? section.behaviors : [];
  if (
    section.required_behavior_count !== REQUIRED_BEHAVIOR_COUNT
    || behaviors.length !== REQUIRED_BEHAVIOR_COUNT
  ) {
    fail('drill_behavior_count_invalid');
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
      )
    ) {
      fail('drill_effect_signer_key_missing', behaviorId);
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
        expected: structuredClone(descriptor.scenarios[scenario]),
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
    run_id: grant?.run_id ?? null,
    attempt_id: grant?.attempt_id ?? null,
  });
}

async function blocked({
  cell,
  grant,
  code,
  stage,
  now,
  auditSink,
}) {
  const audit = denialAudit(cell, grant, code, stage, now);
  if (typeof auditSink === 'function') {
    try {
      await auditSink(audit);
    } catch {
      // A denial audit sink cannot turn a denied execution into an allowed one.
    }
  }
  return Object.freeze({
    status: 'blocked',
    code,
    bundle: null,
    audit,
  });
}

function errorCode(error, fallback) {
  return nonEmpty(error?.code) ? error.code : fallback;
}

async function withTimeout(operation, timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    fail('adapter_timeout_invalid');
  }
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new EquivalenceDrillError('adapter_timeout')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function resolveAdapter(adapters, adapterId) {
  if (adapters instanceof Map) return adapters.get(adapterId);
  if (adapters && typeof adapters === 'object') return adapters[adapterId];
  return null;
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

async function confirmCleanup(adapter, context, timeoutMs) {
  try {
    const cleanup = await withTimeout(
      () => adapter.cleanup(context),
      timeoutMs,
    );
    return cleanup?.confirmed === true
      ? null
      : 'adapter_cleanup_unconfirmed';
  } catch (error) {
    return errorCode(error, 'adapter_cleanup_failed') === 'adapter_timeout'
      ? 'adapter_cleanup_timeout'
      : 'adapter_cleanup_failed';
  }
}

export async function executeDrillCell({
  cell,
  grant,
  trustRegistry,
  nonceConsumer,
  adapters,
  collector,
  predecessorResolver = null,
  auditSink = null,
  now = Date.now(),
  timeoutMs = 30_000,
} = {}) {
  const deny = (code, stage) => blocked({
    cell,
    grant,
    code,
    stage,
    now,
    auditSink,
  });

  if (
    cell?.effect_signer_status !== 'available'
    || cell?.blocked_by === 'seam_receipt_signer_missing'
  ) {
    return deny(
      cell?.blocked_by ?? 'seam_receipt_signer_missing',
      'signer_preflight',
    );
  }

  let verifiedGrant;
  try {
    verifiedGrant = verifyExecutionGrant(
      grant,
      trustRegistry,
      expectedFromGrant(cell, grant),
      { now },
    );
  } catch (error) {
    return deny(errorCode(error, 'grant_invalid'), 'grant_verification');
  }

  const adapter = resolveAdapter(adapters, cell.adapter_id);
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
    try {
      const predecessor = await predecessorResolver({
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
      });
      const violationCell = violationCellFor(cell);
      predecessorGrant = verifyExecutionGrant(
        predecessor?.grant,
        trustRegistry,
        expectedFromGrant(violationCell, predecessor?.grant),
        { now },
      );
      if (!sameRecoveryBoundary(predecessorGrant, verifiedGrant)) {
        return deny(
          'recovery_predecessor_axis_mismatch',
          'recovery_predecessor',
        );
      }
      predecessorReceipt = verifyEffectReceipt(
        predecessor?.receipt,
        trustRegistry,
        expectedFromGrant(violationCell, predecessorGrant),
        { now },
      );
    } catch (error) {
      return deny(
        errorCode(error, 'recovery_predecessor_unavailable'),
        'recovery_predecessor',
      );
    }
  }

  if (typeof nonceConsumer !== 'function') {
    return deny('nonce_consumer_unavailable', 'nonce_consumption');
  }
  try {
    const nonceResult = await nonceConsumer({
      grant_id: verifiedGrant.grant_id,
      nonce: verifiedGrant.nonce,
      cell_id: verifiedGrant.cell_id,
      run_id: verifiedGrant.run_id,
      attempt_id: verifiedGrant.attempt_id,
      expires_at: verifiedGrant.expires_at,
    });
    if (nonceResult?.consumed !== true) {
      return deny('grant_nonce_replay', 'nonce_consumption');
    }
  } catch {
    return deny('grant_nonce_replay', 'nonce_consumption');
  }

  const context = Object.freeze({
    cell,
    grant: verifiedGrant,
  });
  let prepared;
  try {
    prepared = await withTimeout(
      () => adapter.prepare(context),
      timeoutMs,
    );
  } catch (error) {
    return deny(errorCode(error, 'adapter_prepare_failed'), 'adapter_prepare');
  }

  let receipt;
  let executionError = null;
  try {
    const seamOutput = await withTimeout(
      () => adapter.invokeActualSeam({ ...context, prepared }),
      timeoutMs,
    );
    receipt = await withTimeout(
      () => adapter.observe(seamOutput, { ...context, prepared }),
      timeoutMs,
    );
    receipt = verifyEffectReceipt(
      receipt,
      trustRegistry,
      {
        ...expectedFromGrant(cell, verifiedGrant),
        predecessor: predecessorReceipt,
      },
      { now },
    );
  } catch (error) {
    executionError = errorCode(error, 'adapter_execution_failed');
  }

  const cleanupError = await confirmCleanup(
    adapter,
    { ...context, prepared },
    timeoutMs,
  );
  if (cleanupError) return deny(cleanupError, 'adapter_cleanup');
  if (executionError) return deny(executionError, 'seam_execution');

  if (typeof collector !== 'function') {
    return deny('collector_unavailable', 'collector');
  }
  let bundle;
  try {
    const executionGrants = predecessorGrant
      ? [predecessorGrant, verifiedGrant]
      : [verifiedGrant];
    const receipts = predecessorReceipt
      ? [predecessorReceipt, receipt]
      : [receipt];
    bundle = await collector({
      cell,
      grant: verifiedGrant,
      executionGrants,
      receipts,
    });
    const verifiedBundle = verifyReceiptBundle(
      bundle,
      trustRegistry,
      expectedFromGrant(cell, verifiedGrant),
      { now },
    );
    return Object.freeze({
      status: 'collected',
      code: 'drill_receipt_collected',
      bundle: verifiedBundle,
      audit: null,
    });
  } catch (error) {
    return deny(errorCode(error, 'collector_failed'), 'collector');
  }
}
