import { describe, expect, it } from 'vitest';

import { __test__ } from '../dispatcher.js';

const {
  buildInputs,
  buildBundle,
  enforceBundleSizeLimit,
  ACTION_SPECS,
} = __test__;

const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
const prHeadSha = 'b'.repeat(40);

const attemptMetadata = Object.freeze({
  logicalCycleId: 'lc-1',
  attemptKind: 'initial',
  workstreamKey: 'ws1',
});

const fakeSkill = Object.freeze({
  name: 'harness-evaluator',
  version: '1.0.0',
  digest: `sha256:${'a'.repeat(64)}`,
  content: 'harness-evaluator instructions',
});

function baseObserved(overrides = {}) {
  return {
    task: {
      id: taskId,
      title: 'fix loop 反馈断链',
      payload: { sprint_dir: 'sprints/x', worktree_path: '/tmp/wt' },
      metadata: {},
    },
    run: { phase: 'evaluate' },
    contract: null,
    pr: { number: 42, head_ref: 'cp-fix', head_sha: prHeadSha },
    decisionLog: [],
    ...overrides,
  };
}

function evalInputs(observed, action = 'spawn:evaluator', hop = 7) {
  return buildInputs(
    action,
    ACTION_SPECS[action],
    { taskId, runId, hop, observed },
    attemptMetadata,
  );
}

describe('dispatcher judge_feedback 回填（fix loop 反馈断链修复）', () => {
  it('run 存在 judge FAIL verdict 时，evaluator bundle inputs 注入 judge_feedback 含 summary 与 failure_class', () => {
    const observed = baseObserved({
      judgeVerdict: {
        verdict: 'FAIL',
        failure_class: 'evidence_insufficient',
        feedback: '缺少 root-cause 证据与 Red→Green 时序：请补齐 exit_code=0 的实跑输出。',
        pr_head_sha: prHeadSha,
      },
      decisionLog: [{ action: 'verdict:judge', hop: 6, detail: {} }],
    });

    const inputs = evalInputs(observed);

    expect(inputs.judge_feedback).toBeTruthy();
    expect(inputs.judge_feedback.verdict).toBe('FAIL');
    expect(inputs.judge_feedback.summary).toContain('缺少 root-cause 证据');
    expect(inputs.judge_feedback.failure_class).toBe('evidence_insufficient');
    expect(Number.isInteger(inputs.judge_feedback.round)).toBe(true);
    expect(inputs.judge_feedback.round).toBeGreaterThanOrEqual(1);
  });

  it('本 run 无 judge verdict（首轮）时，evaluator bundle inputs 不含 judge_feedback', () => {
    const inputs = evalInputs(baseObserved());
    expect(inputs).not.toHaveProperty('judge_feedback');
  });

  it('judge PASS verdict 时不注入 judge_feedback（仅 FAIL 回填）', () => {
    const observed = baseObserved({
      judgeVerdict: { verdict: 'PASS', feedback: 'ok', pr_head_sha: prHeadSha },
    });
    expect(evalInputs(observed)).not.toHaveProperty('judge_feedback');
  });

  it('超长 judge summary 注入后被截断，且完整 evaluator bundle ≤ 256KB（256KB 传输闸回归）', () => {
    const observed = baseObserved({
      judgeVerdict: {
        verdict: 'FAIL',
        failure_class: 'evidence_insufficient',
        feedback: '证'.repeat(300000),
        pr_head_sha: prHeadSha,
      },
      decisionLog: [{ action: 'verdict:judge', hop: 6, detail: {} }],
    });

    const inputs = evalInputs(observed);
    expect(inputs.judge_feedback.summary.length).toBeLessThanOrEqual(2000);

    const bundle = buildBundle(
      'spawn:evaluator',
      ACTION_SPECS['spawn:evaluator'],
      { taskId, runId, hop: 7, observed, decision: { phase: 'evaluate' } },
      attemptId,
      fakeSkill,
      attemptMetadata,
    );
    const gated = enforceBundleSizeLimit(bundle);
    expect(Buffer.byteLength(JSON.stringify(gated))).toBeLessThanOrEqual(256 * 1024);
  });

  it('非 evaluator 角色（judge）的 bundle 不注入 judge_feedback', () => {
    const observed = baseObserved({
      judgeVerdict: {
        verdict: 'FAIL',
        failure_class: 'evidence_insufficient',
        feedback: '缺证据',
        pr_head_sha: prHeadSha,
      },
    });
    const judgeInputs = buildInputs(
      'spawn:judge',
      ACTION_SPECS['spawn:judge'],
      { taskId, runId, hop: 8, observed },
      attemptMetadata,
    );
    expect(judgeInputs).not.toHaveProperty('judge_feedback');
  });

  it('同 run 多条 judge verdict 时只注入最近一次，且 summary 脱敏、round 记为最新轮次', () => {
    const observed = baseObserved({
      judgeVerdict: {
        verdict: 'FAIL',
        failure_class: 'evidence_insufficient',
        feedback: 'token=secret-xyz 缺少最新一轮证据',
        pr_head_sha: prHeadSha,
      },
      decisionLog: [
        { action: 'verdict:judge', hop: 4, detail: {} },
        { action: 'verdict:judge', hop: 6, detail: {} },
      ],
    });

    const inputs = evalInputs(observed);
    expect(inputs.judge_feedback.summary).not.toContain('secret-xyz');
    expect(inputs.judge_feedback.round).toBe(2);
  });
});
