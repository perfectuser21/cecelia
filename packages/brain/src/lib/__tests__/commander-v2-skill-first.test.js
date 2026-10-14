import { it, expect } from 'vitest';
import { commanderCases } from './fixtures/commander-contract-v1.js';
import { activityBindings } from '../commander-v2-store.js';
import { validateExecutionEvidence } from '../commander-v2-implementation.js';
function skillFirst() {
  const f = commanderCases(), activity = f.release.payload.activities[0].payload;
  activity.commander_implementation = { ...f.implementations.skill, business_requirement_sha256: f.implementations.business_requirement_sha256 };
  delete activity.commander_implementation.verification_ref;
  delete activity.commander_implementations; activity.implementation_bindings = activity.implementation_bindings.filter(b => b.kind === 'skill');
  f.envelope.activity_bindings = activityBindings(f.definition, f.release);
  return f;
}
it('独立Skill可先验证，不强制依赖Code；primary身份仍来自冻结来源', () => {
  const f = skillFirst(), chosen = f.release.payload.activities[0].payload.commander_implementation;
  expect(f.envelope.activity_bindings[0].primary_implementation).toEqual(chosen);
  expect(validateExecutionEvidence(f.envelope, f.definition.expected_path[0], { ...f.events[1].data.evidence, execution_role: 'primary' })).toMatchObject({ executor_kind: 'agent', executor_id: chosen.implementation.id });
});
it.each(['source', 'business_hash'])('独立Skill的%s不符在起跑前拒绝', kind => {
  const f = skillFirst(), p = f.release.payload.activities[0].payload.commander_implementation;
  if (kind === 'source') p.implementation.digest = 'f'.repeat(64);
  else p.business_requirement_sha256 = 'f'.repeat(64);
  expect(() => activityBindings(f.definition, f.release)).toThrow('实现');
});
it('独立Skill不得把fallback角色或错环境当primary证据', () => {
  const f = skillFirst();
  expect(() => validateExecutionEvidence(f.envelope, f.definition.expected_path[0], f.events[1].data.evidence)).toThrow('归属');
  expect(() => validateExecutionEvidence(f.envelope, f.definition.expected_path[0], { ...f.events[1].data.evidence, execution_role: 'primary', environment: { id: 'wrong', fingerprint: 'f'.repeat(64) } })).toThrow('环境');
});
