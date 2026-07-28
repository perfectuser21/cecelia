import {
  isAbsolute,
  parse,
  resolve,
} from 'node:path';
import {
  PROOF_PROVIDERS,
  PROOF_SCENARIOS,
} from './kernel-equivalence-axes.js';

const REQUEST_FIELDS = Object.freeze(['cell_id', 'grant_ref']);
const GRANT_AUTHORITY_FIELDS = Object.freeze([
  'capability_id',
  'owner_service',
  'resolveProtectedGrant',
]);
const GRANT_RESOLUTION_FIELDS = Object.freeze([
  'cell_id',
  'grant_path',
  'grant_ref',
]);
const GRANT_REF_PATTERN =
  /^kernel-equivalence-grant:[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

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

function pinPlan(plan) {
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

function validGrantPath(value) {
  return (
    nonEmpty(value)
    && isAbsolute(value)
    && resolve(value) === value
    && value !== parse(value).root
  );
}

export function createBrainTrustedExecutionService({
  plan,
  runtime,
  grantAuthority,
} = {}) {
  const pinnedPlan = pinPlan(plan);
  validateRuntime(runtime);
  validateGrantAuthority(grantAuthority);
  const cellsById = new Map(pinnedPlan.cells.map((cell) => [
    cell.cell_id,
    cell,
  ]));

  const execute = async (request) => {
    if (!validRequest(request)) {
      fail('trusted_execution_request_invalid');
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
      || !validGrantPath(resolution.grant_path)
    ) {
      fail('trusted_execution_grant_resolution_invalid');
    }
    return runtime.executeCell({
      cell,
      grantPath: resolution.grant_path,
    });
  };

  return Object.freeze({
    schema_version:
      'kernel-equivalence-trusted-execution-service/v1',
    cell_count: cellsById.size,
    adapter_count: runtime.adapter_count,
    execute,
  });
}
