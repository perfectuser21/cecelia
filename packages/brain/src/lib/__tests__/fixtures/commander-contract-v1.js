import sharedSample from './commander-contract-v1.json' with { type: 'json' };
import { makeEnvelope, digest } from '../../commander-v2-contract.js';
import { activityBindings } from '../../commander-v2-store.js';
export const sample = structuredClone(sharedSample);
export function commanderCases() {
  const fixture = structuredClone(sample), { task, definition, contract, release } = fixture;
  const envelope = makeEnvelope(task, definition, contract, null);
  envelope.activity_bindings = activityBindings(definition, release);
  const path = definition.expected_path[0], started_at = new Date().toISOString();
  const event = (seq, role, kind, outcome) => ({ protocol: envelope.protocol, run_id: envelope.run_id,
    attempt: envelope.attempt, owner_epoch: envelope.owner_epoch, seq, type: 'activity_completed', data: {
      ...path, started_at, ended_at: started_at, outcome, evidence: { implementation: fixture.implementations[kind].implementation,
        execution_role: role, environment: contract.environment, observed: { value: outcome === 'pass' ? 1 : 0 } } } });
  const events = [event(1, 'primary', 'code', 'fail'), event(2, 'fallback', 'skill', 'pass')];
  const delivery = { protocol: envelope.protocol, task_id: task.id, run_id: envelope.run_id, attempt: envelope.attempt,
    owner_epoch: envelope.owner_epoch, input_sha256: envelope.input_sha256, input: envelope.input, definition: envelope.definition,
    status: 'completed', outputs: { work_ref: 'fixture:private-work' }, evidence: ['fixture:independent-work-readback'],
    effects: [{ key: `${task.id}:publish:${envelope.input.content_ref}`, status: 'committed', receipt: 'fixture:private-work' }],
    cleanup: { completed: true, evidence: ['fixture:device-cleanup'] } };
  const verification = { task_id: task.id, run_id: envelope.run_id, attempt: envelope.attempt, definition_sha256: definition.snapshot_sha256,
    verdict: 'PASS', assertions: [{ name: 'cleanup', pass: true }, { name: `rescue:${path.reference_id}:activity`, pass: true,
      implementation: fixture.implementations.skill.implementation, environment: contract.environment, evidence: ['fixture:independent-skill-and-work-readback'] }],
    evidence: ['fixture:independent-readback'] };
  const spans = events.map((e, i) => ({ ...e.data, id: `span-${i}`, run_id: envelope.run_id, run_binding_id: 'binding',
    identity_protocol: 2, workflow_definition_version_id: definition.workflow_definition_version_id,
    attempt_key: envelope.definition.attempt_key, occurrence_key: `commander:${envelope.attempt}:${e.seq}` }));
  const reconciliation = { run_id: envelope.run_id, run_binding_id: 'binding', evidence_status: 'incomplete', business_outcome: 'fail',
    gaps: [{ code: 'LIFECYCLE_OUTCOME_CONFLICT', lifecycle_status: 'success' }], missing: [], unexpected: [], spans };
  return JSON.parse(JSON.stringify({ ...fixture, envelope, events, delivery, verification, reconciliation,
    negative: { old_epoch: { ...events[0], owner_epoch: 0 }, wrong_account: { ...task.payload.workflow_input,
      authorization: { ...task.payload.workflow_input.authorization, object: { task_id: task.id, account_ref: 'wrong' } } },
    missing_proof: { ...verification, assertions: verification.assertions.filter(a => a.name === 'cleanup') } }, input_sha256: digest(envelope.input) }));
}
export function skillFirstCases() {
  const f = commanderCases(), source = f.release.payload.activities[0].payload;
  delete source.commander_implementations;
  source.commander_implementation = f.skill_first.primary_implementation;
  source.implementation_bindings = source.implementation_bindings.filter(b => b.kind === 'skill');
  f.envelope.activity_bindings = activityBindings(f.definition, f.release);
  f.events = [{ ...f.events[1], seq: 1, data: { ...f.events[1].data, evidence: { ...f.events[1].data.evidence, execution_role: 'primary' } } }];
  f.verification.implementation = f.skill_first.primary_implementation.implementation;
  f.verification.environment = f.contract.environment; f.verification.execution_role = 'primary';
  return JSON.parse(JSON.stringify(f));
}
