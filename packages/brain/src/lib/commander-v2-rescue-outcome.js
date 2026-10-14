/** 原Code失败保留；仅同attempt冻结配套及独立救场读回可完成业务目标。 */
import { digest } from './commander-v2-contract.js';
const pathKey = p => JSON.stringify([p.reference_id, p.activity_id, p.activity_definition_version_id, p.step_id ?? null]);
const same = (a, b) => a != null && b != null && digest(a) === digest(b);
function validSpan(s, e, r) {
  return s.run_id === e.run_id && s.identity_protocol === 2 && s.run_binding_id === r.run_binding_id
    && s.workflow_definition_version_id === e.definition.workflow_definition_version_id && s.attempt_key === e.definition.attempt_key
    && e.definition.expected_path.some(p => pathKey(p) === pathKey(s)) && s.occurrence_key
    && Number.isFinite(Date.parse(s.started_at)) && Number.isFinite(Date.parse(s.ended_at)) && Date.parse(s.ended_at) >= Date.parse(s.started_at);
}
export function commanderRescueOutcome(e, reconciliation, verification) {
  const spans = reconciliation.spans ?? [], failures = spans.filter(s => s.outcome === 'fail');
  if (verification.verdict !== 'PASS' || reconciliation.run_id !== e.run_id || !failures.length
    || reconciliation.missing?.length || reconciliation.unexpected?.length
    || (reconciliation.gaps ?? []).some(g => !['LIFECYCLE_OUTCOME_CONFLICT', 'SPAN_OUTCOME_UNKNOWN'].includes(g.code))) return null;
  const valid = s => validSpan(s, e, reconciliation) && ['unknown', 'fail', 'pass'].includes(s.outcome);
  if (!spans.every(valid)) return null;
  const rescued = [];
  for (const failed of failures) {
    const pairs = e.activity_bindings?.find(b => b.reference_id === failed.reference_id)?.implementations;
    if (!pairs?.code?.implementation || !pairs?.skill?.implementation || !failed.evidence?.implementation || !failed.evidence?.environment
      || failed.evidence.execution_role !== 'primary' || digest(failed.evidence.implementation) !== digest(pairs.code.implementation)
      || digest(failed.evidence?.environment) !== digest(e.contract.environment)) return null;
    const passed = spans.find(s => pathKey(s) === pathKey(failed) && s.outcome === 'pass'
      && ['fallback', 'rescue'].includes(s.evidence?.execution_role) && same(s.evidence?.implementation, pairs.skill.implementation)
      && same(s.evidence?.environment, e.contract.environment));
    const assertion = verification.assertions.find(a => a.name === `rescue:${failed.reference_id}:${failed.step_id ?? 'activity'}`
      && a.pass === true && Array.isArray(a.evidence) && a.evidence.length && same(a.implementation, pairs.skill.implementation)
      && same(a.environment, e.contract.environment));
    if (!passed || !assertion) return null;
    rescued.push({ code_failed_span_id: failed.id, skill_passed_span_id: passed.id, reference_id: failed.reference_id, step_id: failed.step_id ?? null,
      verification_assertion: assertion.name });
  }
  for (const unknown of spans.filter(s => s.outcome === 'unknown')) {
    const determined = failures.find(s => pathKey(s) === pathKey(unknown) && s.occurrence_key !== unknown.occurrence_key
      && Date.parse(s.started_at) >= Date.parse(unknown.ended_at) && unknown.evidence?.execution_role === 'primary'
      && same(s.evidence?.implementation, unknown.evidence?.implementation) && same(s.evidence?.environment, unknown.evidence?.environment));
    if (!determined || !verification.assertions.some(a => a.name === `rescue:${unknown.reference_id}:${unknown.step_id ?? 'activity'}` && a.pass === true && a.code_outcome === 'fail')) return null;
  }
  return { kind: 'commander_rescue_success', rescued };
}
export function commanderReadbackOutcome(e, r, v) {
  const spans = r.spans ?? [], unknown = spans.filter(s => s.outcome === 'unknown');
  if (v.verdict !== 'PASS' || r.run_id !== e.run_id || !unknown.length || r.missing?.length || r.unexpected?.length
    || (r.gaps ?? []).some(g => !['SPAN_OUTCOME_UNKNOWN', 'LIFECYCLE_OUTCOME_CONFLICT'].includes(g.code))
    || spans.some(s => !validSpan(s, e, r) || !['unknown', 'pass'].includes(s.outcome))) return null;
  const readbacks = [];
  for (const original of unknown) {
    const binding = e.activity_bindings?.find(b => b.reference_id === original.reference_id);
    const identity = binding?.primary_implementation?.implementation ?? binding?.implementations?.code?.implementation;
    if (!identity || original.evidence?.execution_role !== 'primary' || !same(original.evidence?.implementation, identity)
      || !same(original.evidence?.environment, e.contract.environment)) return null;
    const passed = spans.find(s => pathKey(s) === pathKey(original) && s.outcome === 'pass' && s.occurrence_key !== original.occurrence_key
      && Date.parse(s.started_at) >= Date.parse(original.ended_at) && s.evidence?.execution_role === 'primary'
      && same(s.evidence?.implementation, identity) && same(s.evidence?.environment, e.contract.environment));
    const assertion = v.assertions.find(a => a.name === `readback:${original.reference_id}:${original.step_id ?? 'activity'}` && a.pass === true
      && Array.isArray(a.evidence) && a.evidence.length && same(a.implementation, identity) && same(a.environment, e.contract.environment));
    if (!passed || !assertion) return null;
    readbacks.push({ unknown_span_id: original.id, readback_span_id: passed.id, verification_assertion: assertion.name });
  }
  return { kind: 'independent_readback_success', readbacks };
}
