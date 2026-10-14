import { it, expect, vi } from 'vitest';
import { commanderCases } from './fixtures/commander-contract-v1.js';
import { reconcileCommanderTask } from '../commander-v2-control.js';
import { validateDelivery } from '../commander-v2-contract.js';
function setup() {
  const f = commanderCases(), control = { phase: 'awaiting_verify', envelope: f.envelope, delivery: f.delivery, execution_stopped: true, verify_task_id: 'verify' };
  const task = { ...f.task, status: 'in_progress', result: { workflow_control: control } };
  const verifier = { id: 'verify', status: 'completed', result: { workflow_verification: f.verification } };
  const db = { release() {}, query: vi.fn(async (sql, args = []) => {
    if (sql.startsWith('SELECT * FROM tasks')) return { rows: [args[0] === 'verify' ? verifier : task] };
    if (sql.includes("jsonb_build_object('workflow_control'")) task.result.workflow_control = JSON.parse(args[1]);
    if (sql.startsWith('UPDATE tasks SET status')) { task.status = 'completed'; return { rows: [task] }; }
    return { rows: [] };
  }) };
  return { ...f, control, current: task, verifier, pool: { connect: async () => db, query: db.query },
    deps: { readEvidence: async () => f.reconciliation, releaseLock: vi.fn(), afterTerminal: vi.fn() } };
}
it('同attempt Code fail与Skill pass保留两原件；独立核验救场后只完成业务任务', async () => {
  const f = setup(); expect(() => validateDelivery(f.delivery, f.envelope)).not.toThrow();
  await reconcileCommanderTask(f.pool, f.task.id, f.deps);
  expect(f.current.status).toBe('completed');
  expect(f.current.result.workflow_control.execution_outcome).toBe('commander_rescue_success');
  expect(f.current.result.workflow_control.reconciliation.business_outcome).toBe('fail');
  expect(f.current.result.workflow_control.reconciliation.spans.map(s => s.outcome)).toEqual(['fail', 'pass']);
});
it.each(['missing_proof', 'wrong_implementation', 'wrong_environment', 'old_attempt'])('救场%s不能替原Code洗绿或完成任务', async kind => {
  const f = setup();
  if (kind === 'missing_proof') f.verifier.result.workflow_verification = f.negative.missing_proof;
  if (kind === 'wrong_implementation') f.reconciliation.spans[1].evidence.implementation.digest = 'f'.repeat(64);
  if (kind === 'wrong_environment') f.reconciliation.spans[1].evidence.environment.fingerprint = 'f'.repeat(64);
  if (kind === 'old_attempt') f.reconciliation.spans[1].attempt_key = 'old';
  await reconcileCommanderTask(f.pool, f.task.id, f.deps);
  expect(f.current.status).toBe('in_progress'); expect(f.current.result.workflow_control.verification.verdict).not.toBe('PASS');
});
it('原unknown后有同冻结实现的机械读回pass和独立证明，仅完成业务不写Code独立成功', async () => {
  const f = setup(), original = f.reconciliation.spans[0], code = f.implementations.code.implementation;
  original.outcome = 'unknown';
  f.reconciliation.spans[1] = { ...structuredClone(original), id: 'readback-span', outcome: 'pass', occurrence_key: 'readback:2' };
  f.reconciliation.business_outcome = 'unknown'; f.reconciliation.gaps = [{ code: 'SPAN_OUTCOME_UNKNOWN', span_id: original.id }];
  f.verifier.result.workflow_verification.assertions[1] = { name: `readback:${original.reference_id}:activity`, pass: true,
    implementation: code, environment: f.contract.environment, evidence: ['independent:source-readback'] };
  await reconcileCommanderTask(f.pool, f.task.id, f.deps);
  expect(f.current.status).toBe('completed'); expect(f.current.result.workflow_control.execution_outcome).toBe('independent_readback_success');
  expect(f.current.result.workflow_control.reconciliation.spans.map(s => s.outcome)).toEqual(['unknown', 'pass']);
});
