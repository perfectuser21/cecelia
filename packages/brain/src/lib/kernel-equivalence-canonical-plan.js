import {
  sha256Canonical,
} from './kernel-equivalence-receipts.js';

// Pinned from regression-contract.yaml contract_version
// kernel-equivalence-2026-07-28. Updating the behavior contract requires an
// explicit server release; a caller-provided digest cannot redefine it.
const CANONICAL_DESCRIPTOR_DIGEST =
  '123e5041d9c19fc74c1f206388cd7ee5dd2148772879b5273ba07d8b706320b5';

function descriptorProjection(plan) {
  return {
    schema_version: 'kernel-equivalence-canonical-descriptor/v1',
    cells: plan.cells.map((cell) => ({
      cell_id: cell.cell_id,
      behavior_id: cell.behavior_id,
      provider: cell.provider,
      scenario: cell.scenario,
      seam_id: cell.seam_id,
      adapter_id: cell.adapter_id,
      isolation: cell.isolation,
      expected: cell.expected,
    })),
  };
}

export function isCanonicalTrustedExecutionPlan(plan) {
  try {
    return (
      plan?.schema_version === 'kernel-equivalence-drill-plan/v1'
      && Array.isArray(plan.cells)
      && plan.cells.length === 99
      && sha256Canonical(descriptorProjection(plan))
        === CANONICAL_DESCRIPTOR_DIGEST
    );
  } catch {
    return false;
  }
}

export const TRUSTED_EXECUTION_CANONICAL_DESCRIPTOR_DIGEST =
  CANONICAL_DESCRIPTOR_DIGEST;
