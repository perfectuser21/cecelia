// TDD red — fix loop 反馈断链：judge FAIL 裁决注入下轮 evaluator TaskBundle。
// 本 sprint 修 packages/brain/src/orchestrator/dispatcher.js buildInputs 的 evaluator 分支：
//   同 run 已存在 judge FAIL(observed.judgeVerdict.verdict==='FAIL') 时，注入
//   inputs.judge_feedback = { summary(脱敏截断), failure_class, round }。
// 无 judge verdict / PASS judge → 不注入该字段。
// 注入后整包字节数不得越过 HARNESS_BUNDLE_MAX_BYTES(256KB)，超长 summary 必须截断。
//
// 禁 mock 被改的边：本测试直调真实 buildInputs/buildBundle（不 stub 被测函数），
// observed.judgeVerdict/observed.decisionLog 按 ground-truth.js 真实 shape
// （asJson(judgeRow.detail)）构造。buildInputs 为纯函数，无 DB 写路径。
import { describe, expect, it } from 'vitest';

import {
  resolveAction,
  __test__,
} from '../../../packages/brain/src/orchestrator/dispatcher.js';
import { HARNESS_BUNDLE_MAX_BYTES } from '../../../packages/brain/src/orchestrator/constants.js';

const { buildInputs, buildBundle, enforceBundleSizeLimit } = __test__;

const taskId = '7cb93de9-332d-40c0-824b-148d32941760';
const runId = '9a39c017-4c5b-4570-ad96-b9d34158d858';
const attemptId = '9198d766-36d0-40ea-890e-dbda3ece9e5c';
const prHeadSha = 'a'.repeat(40);

function judgeRow(hop, detail) {
  return { hop, action: 'verdict:judge', detail };
}

function baseObserved(overrides = {}) {
  return {
    task: {
      id: taskId,
      title: 'fix loop judge feedback',
      description: 'inject judge feedback into evaluator bundle',
      payload: { sprint_dir: 'sprints/08131646-kernel-7cb93de9', worktree_path: '/tmp/wt' },
    },
    run: { id: runId, phase: 'evaluate' },
    contract: null,
    pr: { head_ref: 'cp-fix-loop', head_sha: prHeadSha },
    decisionLog: [],
    judgeVerdict: null,
    ...overrides,
  };
}

const attemptMetadata = Object.freeze({
  logicalCycleId: `intent:${runId}:26`,
  attemptKind: 'initial',
  workstreamKey: 'ws1',
});

function evaluatorInputs(observed) {
  const spec = resolveAction('spawn:evaluator');
  const ctx = { observed, taskId, runId, hop: 26, worktreePath: '/tmp/wt' };
  return buildInputs('spawn:evaluator', spec, ctx, attemptMetadata);
}

describe('dispatcher buildInputs — judge_feedback 注入 [BEHAVIOR]', () => {
  it('同 run 存在 judge FAIL 时注入 judge_feedback 含 summary 与 failure_class', () => {
    const observed = baseObserved({
      judgeVerdict: {
        verdict: 'FAIL',
        pr_head_sha: prHeadSha,
        feedback: '缺失证据: (1) L2 迁移执行日志; (2) 空库建表回执。请优先补齐。',
        failure_class: 'evidence_insufficient',
      },
      decisionLog: [
        judgeRow(20, {
          verdict: 'FAIL',
          feedback: '缺失证据: (1) L2 迁移执行日志; (2) 空库建表回执。请优先补齐。',
          failure_class: 'evidence_insufficient',
        }),
      ],
    });
    const inputs = evaluatorInputs(observed);
    expect(inputs.judge_feedback).toBeDefined();
    expect(inputs.judge_feedback.summary).toContain('缺失证据');
    expect(inputs.judge_feedback.failure_class).toBe('evidence_insufficient');
    expect(inputs.judge_feedback.round).toBe(1);
  });

  it('本 run 无任何 judge verdict 时不注入 judge_feedback 字段', () => {
    const inputs = evaluatorInputs(baseObserved());
    expect(inputs).not.toHaveProperty('judge_feedback');
  });

  it('最近 judge verdict 为 PASS 时不注入 judge_feedback 字段', () => {
    const observed = baseObserved({
      judgeVerdict: { verdict: 'PASS', pr_head_sha: prHeadSha, feedback: 'ok', failure_class: null },
      decisionLog: [judgeRow(20, { verdict: 'PASS', feedback: 'ok', failure_class: null })],
    });
    const inputs = evaluatorInputs(observed);
    expect(inputs).not.toHaveProperty('judge_feedback');
  });

  it('超长 judge summary 截断后整包 bundle 不越过 256KB 传输闸', () => {
    const observed = baseObserved({
      judgeVerdict: {
        verdict: 'FAIL',
        pr_head_sha: prHeadSha,
        feedback: 'x'.repeat(1_000_000),
        failure_class: 'evidence_insufficient',
      },
      decisionLog: [judgeRow(20, {
        verdict: 'FAIL', feedback: 'x'.repeat(1_000_000), failure_class: 'evidence_insufficient',
      })],
    });
    const inputs = evaluatorInputs(observed);
    // summary 必须被截断（远小于原始 1e6，复用 sanitizeDiagnostic 的 2000 字符上限）
    expect(inputs.judge_feedback.summary.length).toBeLessThanOrEqual(2000);

    const spec = resolveAction('spawn:evaluator');
    const ctx = {
      observed, taskId, runId, hop: 26, worktreePath: '/tmp/wt',
      decision: { phase: 'evaluate' },
    };
    const skill = { name: 'harness-evaluator', version: '1.0.0', digest: `sha256:${'a'.repeat(64)}`, content: 's' };
    const bundle = buildBundle('spawn:evaluator', spec, ctx, attemptId, skill, attemptMetadata);
    expect(() => enforceBundleSizeLimit(bundle)).not.toThrow();
    expect(Buffer.byteLength(JSON.stringify(bundle), 'utf8')).toBeLessThanOrEqual(HARNESS_BUNDLE_MAX_BYTES);
  });
});
