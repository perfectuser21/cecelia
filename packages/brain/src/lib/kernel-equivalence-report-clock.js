import {
  compileDrillPlan,
  EquivalenceDrillError,
} from './kernel-equivalence-drills.js';

export function compileReportDrillPlan(contract) {
  const now = Date.parse(contract?.behavior_equivalence?.report_as_of);
  if (!Number.isFinite(now)) {
    throw new EquivalenceDrillError('report_as_of_invalid');
  }
  return Object.freeze({
    now,
    plan: compileDrillPlan(contract, { now }),
  });
}
