import { describe, it, expect } from 'vitest';
// TDD Red proof (GAN). The generator must land the permanent regression copy at
// packages/brain/src/orchestrator/dispatcher-judge-feedback.test.js (brain-unit CI
// include glob src/**/*.test.js, no Postgres). Imports the REAL buildInputs — the
// changed edge (decisionLog -> buildInputs -> TaskBundle.inputs) is NOT mocked.
import { __test__ } from '../../../packages/brain/src/orchestrator/dispatcher.js';

const { buildInputs, buildBundle, ACTION_SPECS, enforceBundleSizeLimit } = __test__;
const SPEC = ACTION_SPECS['spawn:evaluator'];
const META = { logicalCycleId: 'lc', attemptKind: 'initial', workstreamKey: 'ws1' };
const MAX = 256 * 1024;

function ctxWith(decisionLog: any[]) {
  return {
    runId: 'run-1', hop: 9, taskId: 'task-1', worktreePath: '/tmp/wt',
    decision: { phase: 'evaluate' },
    observed: {
      task: { id: 'task-1', title: 't', description: 'd', payload: {}, metadata: {} },
      decisionLog,
      pr: { head_sha: 'abcdef1234567890abcdef1234567890abcdef12', head_ref: 'feat' },
    },
  } as any;
}
const judgeFail = (hop: number, detail: any) => ({ action: 'verdict:judge', hop, detail: { verdict: 'FAIL', ...detail } });

describe('buildInputs judge_feedback injection [BEHAVIOR]', () => {
  it('injects judge_feedback with summary + failure_class + round on judge FAIL', () => {
    const inputs = buildInputs('spawn:evaluator', SPEC, ctxWith([
      judgeFail(5, { failure_class: 'evidence_insufficient', feedback: 'missing: ffprobe stream output; DB row count' }),
    ]), META);
    expect(inputs.judge_feedback).toBeTruthy();
    expect(inputs.judge_feedback.summary).toContain('ffprobe');
    expect(inputs.judge_feedback.failure_class).toBe('evidence_insufficient');
    expect(inputs.judge_feedback.round).toBe(5);
  });

  it('does not inject judge_feedback when run has no judge verdict', () => {
    const inputs = buildInputs('spawn:evaluator', SPEC, ctxWith([]), META);
    expect('judge_feedback' in inputs).toBe(false);
  });

  it('does not inject judge_feedback when latest judge verdict is PASS', () => {
    const inputs = buildInputs('spawn:evaluator', SPEC, ctxWith([
      { action: 'verdict:judge', hop: 6, detail: { verdict: 'PASS', feedback: 'ok' } },
    ]), META);
    expect('judge_feedback' in inputs).toBe(false);
  });

  it('truncates an over-long summary so the whole bundle stays <= 256KB', () => {
    const bundle = buildBundle('spawn:evaluator', SPEC, ctxWith([
      judgeFail(5, { failure_class: 'evidence_insufficient', feedback: 'HEAD '.repeat(120000) }),
    ]), 'att-1', 'harness-evaluator', META, { deferWorkspaceValidation: true });
    const enforced = enforceBundleSizeLimit(bundle);
    expect(Buffer.byteLength(JSON.stringify(enforced))).toBeLessThanOrEqual(MAX);
    expect(enforced.inputs.judge_feedback.summary.length).toBeLessThanOrEqual(4096);
  });

  it('redacts credential patterns from the summary before it lands in the bundle', () => {
    const secret = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const inputs = buildInputs('spawn:evaluator', SPEC, ctxWith([
      judgeFail(5, { failure_class: 'evidence_insufficient', feedback: `token ${secret} end` }),
    ]), META);
    expect(inputs.judge_feedback.summary).not.toContain(secret);
    expect(inputs.judge_feedback.summary).toContain('[REDACTED]');
  });

  it('injects only the latest judge FAIL by hop', () => {
    const inputs = buildInputs('spawn:evaluator', SPEC, ctxWith([
      judgeFail(3, { failure_class: 'product_failure', feedback: 'older' }),
      judgeFail(7, { failure_class: 'evidence_insufficient', feedback: 'newest: missing latest evidence' }),
      judgeFail(5, { failure_class: 'evidence_invalid', feedback: 'middle' }),
    ]), META);
    expect(inputs.judge_feedback.round).toBe(7);
    expect(inputs.judge_feedback.failure_class).toBe('evidence_insufficient');
    expect(inputs.judge_feedback.summary).toContain('newest');
  });
});
