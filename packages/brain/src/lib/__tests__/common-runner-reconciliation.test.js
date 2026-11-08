import { describe, expect, it } from 'vitest';
import { reconcileRunEvidence } from '../run-reconciliation.js';

const identity = { run_id: 'run-1', run_binding_id: 'binding-1', identity_protocol: 2, reference_id: 'ref-1', activity_id: 'activity-1',
  activity_definition_version_id: 'av-1', workflow_definition_version_id: 'wv-1', attempt_key: 'a1', step_id: null, enabler_id: null };
const start = '2026-11-02T00:00:00.000Z', end = '2026-11-02T00:00:01.000Z';
function fixture() {
  const evidence = { profile_digest: 'profile-hash', task_id: 'task-1', machine_id: 'node-1' };
  const execution = { ...identity, id: 'execution-id', occurrence_key: 'execution:1', started_at: start, ended_at: end,
    outcome: 'unknown', evidence: { ...evidence, kind: 'execution' } };
  const validation = { ...identity, id: 'validation-id', occurrence_key: 'validation:1', started_at: start, ended_at: end, outcome: 'pass',
    evidence: { ...evidence, kind: 'validation', execution_occurrences: ['execution:1'],
      questions: { A4: { source: 'independent_validator', status: 'observed', ref: 'dod-v1', actual: { verdict: 'pass', evidence: ['readback'] } } },
      validation: { verdict: 'pass', acceptance_ref: 'dod-v1', evidence: ['readback'] } } };
  const context = { binding: { id: 'binding-1', expected_path: [{ reference_id: 'ref-1', activity_id: 'activity-1', activity_definition_version_id: 'av-1', step_id: null }] } };
  return { execution, validation, context };
}
describe('common runner observation and independent validation pairing', () => {
  it('derives a verified result without overwriting execution unknown facts', () => {
    const f = fixture();
    const result = reconcileRunEvidence({ run_id: 'run-1', context: f.context, spans: [f.execution, f.validation] });
    expect(result.business_outcome).toBe('pass'); expect(result.evidence_status).toBe('verified');
    expect(f.execution.outcome).toBe('unknown');
  });
  it.each(['version', 'occurrence', 'machine', 'source', 'unfinished'])('does not pair unrelated or incomplete evidence (%s)', changed => {
    const f = fixture();
    if (changed === 'version') f.validation.activity_definition_version_id = 'av-other';
    if (changed === 'occurrence') f.validation.evidence.execution_occurrences = [];
    if (changed === 'machine') f.validation.evidence.machine_id = 'node-other';
    if (changed === 'source') f.validation.evidence.questions.A4.source = 'executor_reported';
    if (changed === 'unfinished') f.validation.ended_at = null;
    const result = reconcileRunEvidence({ run_id: 'run-1', context: f.context, spans: [f.execution, f.validation] });
    expect(result.evidence_status).toBe('incomplete'); expect(result.business_outcome).not.toBe('pass');
  });
  it('never invents an expected Step span from an Activity verdict', () => {
    const f = fixture(); f.context.binding.expected_path.push({ ...f.context.binding.expected_path[0], step_id: 'step-1' });
    const result = reconcileRunEvidence({ run_id: 'run-1', context: f.context, spans: [f.execution, f.validation] });
    expect(result.gaps.some(gap => gap.code === 'EXPECTED_SPAN_MISSING')).toBe(true); expect(result.business_outcome).toBe('unknown');
  });
  it('does not let validator pass cover an execution failure', () => {
    const f = fixture(); f.execution.outcome = 'fail';
    expect(reconcileRunEvidence({ run_id: 'run-1', context: f.context, spans: [f.execution, f.validation] }).business_outcome).toBe('fail');
  });
});
it('COMMANDER_RECONNECTED是观察事实，不能阻挡已独立验证的业务正式归位',()=>{
 const f=fixture(),commander={...f.execution,id:'commander-reconnected',occurrence_key:'commander:1',evidence:{kind:'commander',event:{event_type:'COMMANDER_RECONNECTED'}}};
 const result=reconcileRunEvidence({run_id:'run-1',context:f.context,spans:[f.execution,f.validation,commander]});expect(result.evidence_status).toBe('verified');expect(result.business_outcome).toBe('pass');expect(commander.outcome).toBe('unknown');
});
