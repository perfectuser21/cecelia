import { afterEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createWorkflowRecorder } from '../workflow-recorder.js';
import { runActivityContract } from '../activity-runtime.js';
import { validateWorkflow } from '../workflow-validator.js';
import { reconcileRunEvidence } from '../../lib/run-reconciliation.js';

const dirs = [];
const hash = value => createHash('sha256').update(value).digest('hex');
afterEach(() => dirs.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function fixture(fatal = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-retry-')); dirs.push(root);
  const runId = randomUUID(), taskId = randomUUID(), activityId = randomUUID();
  const identity = { identity_protocol: 2, workflow_id: randomUUID(), run_binding_id: randomUUID(), reference_id: randomUUID(),
    workflow_definition_version_id: randomUUID(), activity_definition_version_id: randomUUID(), attempt_key: 'a1', enabler_call_id: null };
  const source = `import fs from 'node:fs';let t='';for await(const c of process.stdin)t+=c;const x=JSON.parse(t);fs.appendFileSync('attempts',String(x.attempt));const ok=x.attempt===2&&!${fatal};console.log(JSON.stringify({schema_version:1,run_tag:x.run_tag,status:ok?'completed':'failed',...(ok?{}:{failure_class:${fatal ? "'fatal'" : "'retryable'"},reason_code:'transient'}),outputs:ok?{answer:42}:{},metrics:{},evidence:[{attempt:x.attempt}]}));`;
  const validator = `import fs from 'node:fs';let t='';for await(const c of process.stdin)t+=c;const x=JSON.parse(t);const actual=fs.readFileSync('attempts','utf8');console.log(JSON.stringify({verdict:actual==='12'&&x.receipt.outputs.answer===42?'pass':'unknown',acceptance_ref:x.acceptance.ref,evidence:[{actual}]}));`;
  fs.writeFileSync(path.join(root, 'attempt.mjs'), source); fs.writeFileSync(path.join(root, 'check.mjs'), validator);
  const questions = Object.fromEntries(['A1','A2','A3','A4','A5','A6','B1','C1','C2','C3'].map(q => [q, { ref: `ref:${q}`, version: '1', declared: q }]));
  const metadata = { work: { activity_id: activityId, executor_kind: 'code', identity, questions } };
  const contract = { workflow: 'retry-proof', activities: [{ key: 'work', order: 1, budget: { max_duration_s: 2, heartbeat_s: 1 },
    failure: { empty_ok: [], retryable: ['transient'], fatal: ['transient'], needs_human: { cases: [] } },
    runtime: { entry: 'attempt.mjs', phase: 'source', protocol: 'json-stdio-v1', max_attempts: 2 } }] };
  const recorder = createWorkflowRecorder({ root: path.join(root, 'record'), runId, taskId, machineId: 'test', profileDigest: hash(source), mode: 'formal', metadata });
  const profile = { cwd: root, contract, metadata, files: { 'check.mjs': hash(validator) },
    validators: { work: { entry: 'check.mjs', acceptance: { ref: 'ref:A4' } } } };
  const context = { binding: { id: identity.run_binding_id, run_id: runId, release_id: randomUUID(), expected_path: [{
    reference_id: identity.reference_id, activity_id: activityId, activity_definition_version_id: identity.activity_definition_version_id, required: true }] } };
  return { root, recorder, contract, profile, context, runId };
}

test('真实retry第一次失败第二次成功，独立验收pass可业务收口且失败事实不变', async () => {
  const f = fixture();
  const receipt = await runActivityContract(f.contract, { run_tag: 'retry-proof' }, { cwd: f.root, onEvent: f.recorder.onEvent });
  expect(receipt.status).toBe('completed'); expect(fs.readFileSync(path.join(f.root, 'attempts'), 'utf8')).toBe('12');
  const verdict = await validateWorkflow(f.profile, receipt);
  expect(verdict.activities.work.verdict).toBe('pass'); await f.recorder.recordValidation(verdict); await f.recorder.finalize(receipt, verdict);
  const spans = f.recorder.inspect().spans, executions = spans.filter(s => s.evidence.kind === 'execution');
  expect(executions.map(s => s.outcome)).toEqual(['unknown', 'unknown']);
  expect(executions[0].evidence.execution_status).toBe('failed');
  expect(executions[0].evidence.raw_result.reason_code).toBe('transient');
  expect(executions[0].evidence.questions.A6.actual.status).toBe('failed');
  expect(executions[1].evidence.questions.A6.actual.retries_observed).toBe(1);
  const reconciled = reconcileRunEvidence({ run_id: f.runId, context: f.context, spans });
  expect(reconciled.business_outcome).toBe('pass'); expect(reconciled.evidence_status).toBe('verified');
});

test('真实fatal失败没有独立pass仍unknown，不因更改Span语义变成功', async () => {
  const f = fixture(true);
  const receipt = await runActivityContract(f.contract, { run_tag: 'fatal-proof' }, { cwd: f.root, onEvent: f.recorder.onEvent });
  expect(receipt.status).toBe('failed'); expect(fs.readFileSync(path.join(f.root, 'attempts'), 'utf8')).toBe('1');
  const verdict = await validateWorkflow(f.profile, receipt); await f.recorder.recordValidation(verdict);
  const spans = f.recorder.inspect().spans;
  expect(spans[0].evidence.execution_status).toBe('failed');
  expect(reconcileRunEvidence({ run_id: f.runId, context: f.context, spans }).business_outcome).toBe('unknown');
});
