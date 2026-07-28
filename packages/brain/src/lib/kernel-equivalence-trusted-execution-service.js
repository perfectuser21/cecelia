import {
  PROOF_PROVIDERS,
  PROOF_SCENARIOS,
} from './kernel-equivalence-axes.js';
import {
  sha256Canonical,
} from './kernel-equivalence-receipts.js';

const REQUEST_FIELDS = Object.freeze(['cell_id', 'grant_ref']);
const GRANT_AUTHORITY_FIELDS = Object.freeze([
  'capability_id',
  'owner_service',
  'resolveProtectedGrant',
]);
const GRANT_RESOLUTION_FIELDS = Object.freeze([
  'cell_id',
  'grant',
  'grant_ref',
]);
const GRANT_REF_PATTERN =
  /^kernel-equivalence-grant:([a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAXIMUM_EXECUTION_TIMEOUT_MS = 30_000;

export class KernelTrustedExecutionServiceError extends Error {
  constructor(code) {
    super(code);
    this.name = 'KernelTrustedExecutionServiceError';
    this.code = code;
  }
}

function fail(code) {
  throw new KernelTrustedExecutionServiceError(code);
}

function nonEmpty(value, maximum = 2_048) {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !/[\0\r\n]/.test(value)
  );
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length
    && actual.every((field, index) => field === expected[index])
  );
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function digestTrustedExecutionPlan(plan) {
  try {
    return sha256Canonical(plan);
  } catch {
    fail('trusted_execution_plan_invalid');
  }
}

function pinPlan(plan, expectedPlanDigest) {
  let pinned;
  try {
    pinned = structuredClone(plan);
  } catch {
    fail('trusted_execution_plan_invalid');
  }
  if (
    pinned?.schema_version !== 'kernel-equivalence-drill-plan/v1'
    || pinned?.behavior_count !== 11
    || !Array.isArray(pinned.cells)
    || pinned.cells.length !== 99
  ) {
    fail('trusted_execution_plan_invalid');
  }
  if (!HASH_PATTERN.test(expectedPlanDigest ?? '')) {
    fail('trusted_execution_plan_digest_invalid');
  }
  if (digestTrustedExecutionPlan(pinned) !== expectedPlanDigest) {
    fail('trusted_execution_plan_digest_mismatch');
  }
  const cellIds = new Set();
  const axesByBehavior = new Map();
  for (const cell of pinned.cells) {
    const expectedCellId = (
      `${cell?.behavior_id}::${cell?.provider}::${cell?.scenario}`
    );
    if (
      !nonEmpty(cell?.behavior_id)
      || !PROOF_PROVIDERS.includes(cell?.provider)
      || !PROOF_SCENARIOS.includes(cell?.scenario)
      || cell?.cell_id !== expectedCellId
      || !nonEmpty(cell?.seam_id)
      || !nonEmpty(cell?.adapter_id)
      || cellIds.has(cell.cell_id)
    ) {
      fail('trusted_execution_plan_invalid');
    }
    cellIds.add(cell.cell_id);
    if (!axesByBehavior.has(cell.behavior_id)) {
      axesByBehavior.set(cell.behavior_id, new Set());
    }
    axesByBehavior.get(cell.behavior_id).add(
      `${cell.provider}:${cell.scenario}`,
    );
  }
  if (
    axesByBehavior.size !== 11
    || [...axesByBehavior.values()].some((axes) => axes.size !== 9)
  ) {
    fail('trusted_execution_plan_invalid');
  }
  return deepFreeze(pinned);
}

function validateRuntime(runtime) {
  if (
    !runtime
    || typeof runtime !== 'object'
    || runtime.schema_version
      !== 'kernel-equivalence-trusted-runtime/v1'
    || runtime.adapter_count !== 10
    || typeof runtime.executeCell !== 'function'
  ) {
    fail('trusted_execution_runtime_invalid');
  }
}

function validateGrantAuthority(grantAuthority) {
  if (
    !exactKeys(grantAuthority, [...GRANT_AUTHORITY_FIELDS].sort())
    || grantAuthority.owner_service
      !== 'brain.kernel_equivalence.grants'
    || !nonEmpty(grantAuthority.capability_id)
    || typeof grantAuthority.resolveProtectedGrant !== 'function'
  ) {
    fail('trusted_execution_grant_authority_invalid');
  }
}

function validRequest(request) {
  return (
    exactKeys(request, REQUEST_FIELDS)
    && nonEmpty(request.cell_id, 1_024)
    && typeof request.grant_ref === 'string'
    && GRANT_REF_PATTERN.test(request.grant_ref)
  );
}

function validGrant(value, request) {
  const grantId = request.grant_ref.match(GRANT_REF_PATTERN)?.[1];
  return (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.grant_id === grantId
    && value.cell_id === request.cell_id
  );
}

export function createBrainTrustedExecutionService({
  plan,
  expectedPlanDigest,
  runtime,
  grantAuthority,
  now = Date.now,
  maximumExecutionTimeoutMs = MAXIMUM_EXECUTION_TIMEOUT_MS,
} = {}) {
  if (
    typeof now !== 'function'
    || !Number.isInteger(maximumExecutionTimeoutMs)
    || maximumExecutionTimeoutMs < 1
    || maximumExecutionTimeoutMs > MAXIMUM_EXECUTION_TIMEOUT_MS
  ) {
    fail('trusted_execution_service_configuration_invalid');
  }
  const pinnedPlan = pinPlan(plan, expectedPlanDigest);
  validateRuntime(runtime);
  validateGrantAuthority(grantAuthority);
  const cellsById = new Map(pinnedPlan.cells.map((cell) => [
    cell.cell_id,
    cell,
  ]));

  const execute = async (
    request,
    {
      signal = null,
      deadlineMs = null,
    } = {},
  ) => {
    if (!validRequest(request)) {
      fail('trusted_execution_request_invalid');
    }
    if (
      signal != null
      && (
        typeof signal !== 'object'
        || typeof signal.aborted !== 'boolean'
        || typeof signal.addEventListener !== 'function'
      )
    ) {
      fail('trusted_execution_signal_invalid');
    }
    const sampledNow = now();
    const effectiveDeadline = deadlineMs == null
      ? sampledNow + maximumExecutionTimeoutMs
      : deadlineMs;
    if (
      !Number.isFinite(sampledNow)
      || !Number.isFinite(effectiveDeadline)
    ) {
      fail('trusted_execution_deadline_invalid');
    }
    const remainingMs = Math.min(
      maximumExecutionTimeoutMs,
      Math.floor(effectiveDeadline - sampledNow),
    );
    if (remainingMs < 1 || signal?.aborted) {
      fail('trusted_execution_request_aborted');
    }
    const cell = cellsById.get(request.cell_id);
    if (!cell) fail('trusted_execution_cell_not_found');
    let resolution;
    try {
      resolution = await grantAuthority.resolveProtectedGrant({
        cellId: request.cell_id,
        grantRef: request.grant_ref,
      });
    } catch (error) {
      if (error instanceof KernelTrustedExecutionServiceError) throw error;
      fail('trusted_execution_grant_resolution_failed');
    }
    if (
      !exactKeys(resolution, [...GRANT_RESOLUTION_FIELDS].sort())
      || resolution.cell_id !== request.cell_id
      || resolution.grant_ref !== request.grant_ref
      || !validGrant(resolution.grant, request)
    ) {
      fail('trusted_execution_grant_resolution_invalid');
    }
    const resolutionNow = now();
    if (!Number.isFinite(resolutionNow)) {
      fail('trusted_execution_deadline_invalid');
    }
    const remainingAfterResolution = Math.min(
      remainingMs,
      Math.floor(effectiveDeadline - resolutionNow),
    );
    if (signal?.aborted || remainingAfterResolution < 1) {
      fail('trusted_execution_request_aborted');
    }
    return runtime.executeCell({
      cell,
      grant: deepFreeze(structuredClone(resolution.grant)),
      signal,
      timeoutMs: remainingAfterResolution,
    });
  };

  return Object.freeze({
    schema_version:
      'kernel-equivalence-trusted-execution-service/v1',
    cell_count: cellsById.size,
    adapter_count: runtime.adapter_count,
    plan_digest: expectedPlanDigest,
    execute,
  });
}
