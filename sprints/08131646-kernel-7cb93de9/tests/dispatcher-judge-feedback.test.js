// TDD-red 契约测试 — fix loop 反馈断链：judge FAIL 裁决注入下轮 evaluator TaskBundle
//
// 本文件是 GAN 冻结合同测试原文。Generator 必须把同名文件永久落在
// packages/brain/src/orchestrator/__tests__/dispatcher-judge-feedback.test.js
// （进 brain-ci.yml 常驻回归）。二者内容逐字一致。
//
// 禁 mock 被改的边：本单改的边是「observed.decisionLog（数据）→ buildInputs →
// inputs.judge_feedback」。测试用真实构造的 decisionLog 数组喂真实 createDispatcher，
// 不 mock buildInputs / dispatcher 内部装配逻辑，只 mock 更外层的 attemptStore/
// launcher/registry 等无关 IO 依赖（与既有 dispatcher.test.js 同款 makeDeps）。
import { describe, expect, it, vi } from 'vitest';

import { createDispatcher } from '../../../packages/brain/src/orchestrator/dispatcher.js';

const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const runId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
const prHeadSha = 'b'.repeat(40);

const baseObserved = {
  task: {
    id: taskId,
    title: 'Provider-neutral Harness',
    description: 'Build the shared execution kernel.',
    payload: {
      executor: 'auto',
      sprint_dir: 'sprints/provider-neutral',
      worktree_path: '/tmp/worktree',
    },
  },
  run: { id: runId },
  contract: { approved: false, row: { propose_branch: 'cp-propose-r1' } },
  pr: { number: 42, head_ref: 'cp-evidence-target', head_sha: prHeadSha },
  prdExists: true,
};

function fakeSkill(name) {
  return Object.freeze({
    name,
    version: '1.0.0',
    digest: `sha256:${'a'.repeat(64)}`,
    content: `${name} instructions`,
  });
}

function makeDeps() {
  const leaseOwner = 'dispatcher-test:4242';
  const adapter = {
    name: 'codex',
    start: vi.fn(() => ({ provider: 'codex', command: 'codex', args: ['exec'], stdin: '{}' })),
  };
  return {
    attemptStore: {
      createAttempt: vi.fn(async (input) => ({ id: input.id, ...input, task_bundle: input.bundle })),
      markStarting: vi.fn(async (id) => ({ id, status: 'starting', lease_owner: leaseOwner, lease_generation: 0 })),
      recordLaunchReceipt: vi.fn(async (id, receipt) => ({ id, status: 'starting', ...receipt })),
      fail: vi.fn(),
      listFailedExecutionTargets: vi.fn(async () => []),
    },
    registry: { resolve: vi.fn(() => adapter) },
    launcher: {
      launch: vi.fn(async () => Object.freeze({
        actualMachineId: 'brain-1',
        executionTransport: 'local-docker',
        remoteJobId: null,
        attestationStatus: 'local',
        containerId: 'container-1',
        jobId: null,
      })),
      inspect: vi.fn(),
      cancel: vi.fn(async () => ({ status: 'missing' })),
    },
    loadSkill: vi.fn(fakeSkill),
    randomUUID: () => attemptId,
    createCallbackSecret: () => 'attempt-secret',
    machineId: 'brain-1',
    leaseOwner,
  };
}

async function dispatchEvaluator(observed) {
  const deps = makeDeps();
  await createDispatcher(deps)('spawn:evaluator', {
    taskId,
    runId,
    hop: 7,
    observed,
    decision: { phase: 'evaluate', reason: 'ci_pass' },
  });
  return deps.attemptStore.createAttempt.mock.calls[0][0].bundle;
}

describe('buildInputs(role=evaluator) judge_feedback 注入', () => {
  it('run 存在 judge FAIL verdict 时注入 judge_feedback 含 summary 与 failure_class 与轮次', async () => {
    const observed = {
      ...baseObserved,
      decisionLog: [
        { hop: 5, action: 'verdict:judge', detail: { verdict: 'FAIL', pr_head_sha: prHeadSha, failure_class: 'evidence_insufficient', feedback: '缺少失败路径直接执行的 stdout 与退出码' } },
      ],
    };
    const bundle = await dispatchEvaluator(observed);
    expect(bundle.inputs.judge_feedback).toEqual({
      hop: 5,
      verdict: 'FAIL',
      failure_class: 'evidence_insufficient',
      summary: '缺少失败路径直接执行的 stdout 与退出码',
    });
  });

  it('同 run 多条 judge FAIL 时只注入 hop 最大的最近一次', async () => {
    const observed = {
      ...baseObserved,
      decisionLog: [
        { hop: 3, action: 'verdict:judge', detail: { verdict: 'FAIL', pr_head_sha: prHeadSha, failure_class: 'product_failure', feedback: '旧的一轮反馈' } },
        { hop: 9, action: 'verdict:judge', detail: { verdict: 'FAIL', pr_head_sha: prHeadSha, failure_class: 'evidence_insufficient', feedback: '最新一轮点名缺失证据' } },
      ],
    };
    const bundle = await dispatchEvaluator(observed);
    expect(bundle.inputs.judge_feedback.hop).toBe(9);
    expect(bundle.inputs.judge_feedback.summary).toBe('最新一轮点名缺失证据');
    expect(bundle.inputs.judge_feedback.failure_class).toBe('evidence_insufficient');
  });

  it('judge FAIL 但 failure_class 非 evidence 类仍注入（消费侧自行区分）', async () => {
    const observed = {
      ...baseObserved,
      decisionLog: [
        { hop: 4, action: 'verdict:judge', detail: { verdict: 'FAIL', pr_head_sha: prHeadSha, failure_class: 'product_failure', feedback: '实现缺陷，不是证据不足' } },
      ],
    };
    const bundle = await dispatchEvaluator(observed);
    expect(bundle.inputs.judge_feedback.verdict).toBe('FAIL');
    expect(bundle.inputs.judge_feedback.failure_class).toBe('product_failure');
  });

  it('无 judge verdict（首轮 evaluator）时不注入 judge_feedback 字段', async () => {
    const observed = { ...baseObserved, decisionLog: [] };
    const bundle = await dispatchEvaluator(observed);
    expect(bundle.inputs).not.toHaveProperty('judge_feedback');
  });

  it('judge 判 PASS 时不注入 judge_feedback', async () => {
    const observed = {
      ...baseObserved,
      decisionLog: [
        { hop: 6, action: 'verdict:judge', detail: { verdict: 'PASS', pr_head_sha: prHeadSha, failure_class: null, feedback: null } },
      ],
    };
    const bundle = await dispatchEvaluator(observed);
    expect(bundle.inputs).not.toHaveProperty('judge_feedback');
  });

  it('超长 judge summary 截断后 bundle 不越 256KB 传输闸', async () => {
    const hugeFeedback = 'x'.repeat(500_000);
    const observed = {
      ...baseObserved,
      decisionLog: [
        { hop: 8, action: 'verdict:judge', detail: { verdict: 'FAIL', pr_head_sha: prHeadSha, failure_class: 'evidence_insufficient', feedback: hugeFeedback } },
      ],
    };
    const bundle = await dispatchEvaluator(observed);
    // 截断生效：summary 被 sanitizeDiagnostic 收窄（≤2000 字符）
    expect(bundle.inputs.judge_feedback.summary.length).toBeLessThanOrEqual(2000);
    // 256KB 传输闸回归：注入后整条 bundle 仍在闸内
    expect(Buffer.byteLength(JSON.stringify(bundle), 'utf8')).toBeLessThan(256 * 1024);
  });
});
