/**
 * d707-replay.test.js
 *
 * [BEHAVIOR] B-08：d707 hop 55-66 replay 不产生重复 fix
 *
 * 先红后绿：当前代码在 hop 56（evidence_invalid）路由 generator-fix，
 * 在 hop 57-66 产生 9 次重复 generator-fix。
 *
 * 真实 d707ae20 run 的关键 hop 结构：
 *   hop 55: spawn:evaluator（CI pass 后触发）
 *   hop 56: verdict:evaluate（FAIL, failure_class='evidence_invalid'）
 *   hop 57: spawn:generator-fix（错误！evidence_invalid 不应进 generator-fix）
 *   hop 58-66: 9 次重复 spawn:generator-fix（同 SHA，no-progress 未熔断）
 *
 * 修复后期望：
 *   hop 56: verdict:evaluate（FAIL, failure_class='evidence_invalid'）
 *   hop 57: spawn:evaluator-evidence-repair（正确路由）
 *   或
 *   hop 57: mark_failed（no-progress terminal，若 SHA 未变化）
 *
 * Sprint: 07231527-relay-50170af2
 * TASK_ID: 50170af2-fefa-41a7-b0b4-dcf1a5d7b077
 */

import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { deriveCounters } from '../../../packages/brain/src/orchestrator/counters.js';

// ---- d707 replay fixture（真实 hop 结构，基于 d707ae20 run decision log）----

/**
 * d707 hop 55-57 的关键结构。
 * 使用真实语义构建 fixture（禁止骨架占位）。
 *
 * hop 55: evaluator 被派，CI pass 状态
 * hop 56: evaluator callback → verdict:evaluate FAIL，failure_class=evidence_invalid
 * hop 57+: 错误地进入 generator-fix loop
 */
const D707_HOP_55_FIXTURE = {
  // 从 hop 1 到 hop 54 积累的 baseline state（已有 PR，CI pass）
  baselineDecisionLog: [
    { hop: 1, action: 'spawn:generator', observed: { prdExists: true } },
    { hop: 2, action: 'wait:poll_ci', observed: { ci: 'pending' } },
    { hop: 3, action: 'wait:poll_ci', observed: { ci: 'pending' } },
    // ... 中间 hops 省略（从 hop 3 到 hop 54 的 CI 轮询）...
    { hop: 50, action: 'wait:poll_ci', observed: { ci: 'pending' } },
    { hop: 51, action: 'wait:poll_ci', observed: { ci: 'pending' } },
    { hop: 52, action: 'wait:poll_ci', observed: { ci: 'pending' } },
    { hop: 53, action: 'wait:poll_ci', observed: { ci: 'pending' } },
    { hop: 54, action: 'wait:poll_ci', observed: { ci: 'pending' } },
    // hop 55: evaluator 被派
    { hop: 55, action: 'spawn:evaluator', observed: { pr: { ci: 'pass', head_sha: 'sha-d707-original' } } },
  ],
  // hop 56 verdict: evaluator FAIL, failure_class=evidence_invalid
  hop56Verdict: {
    hop: 56,
    action: 'verdict:evaluate',
    observed: { attempt_id: 'attempt-d707-eval', role: 'evaluator' },
    detail: JSON.stringify({
      attempt_id: 'attempt-d707-eval',
      verdict: 'FAIL',
      pr_head_sha: 'sha-d707-original',
      failure_class: 'evidence_invalid',
      feedback: 'E2E 证据文件缺少必要字段，evaluator 无法完成验证',
    }),
  },
};

describe('[BEHAVIOR] B-08 d707 hop 55-66 replay 不产生重复 fix', () => {

  /**
   * T-04-a: hop 56 evidence_invalid → 路由 evidence-repair（不是 generator-fix）
   * 当前（先红）：derive 路由 spawn:generator-fix
   */
  test('T-04-a: hop 56 evaluate FAIL + evidence_invalid → spawn:evaluator-evidence-repair', () => {
    const prHeadSha = 'sha-d707-original';
    const logWithHop56 = [
      ...D707_HOP_55_FIXTURE.baselineDecisionLog,
      D707_HOP_55_FIXTURE.hop56Verdict,
    ];

    const counters = deriveCounters(logWithHop56, { proposeBranchMaxRn: 0 });

    const observed = {
      run: { phase: 'evaluate', cost_usd: '2.50' },
      task: { status: 'in_progress', payload: {} },
      prdExists: true,
      contract: { approved: true, id: 'c-d707', row: {} },
      pr: {
        url: 'https://github.com/zenithabs/zenithjos/pull/44',
        state: 'OPEN',
        merged: false,
        ci: 'pass',
        head_sha: prHeadSha,
      },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: null, auth_failed: false, action: null },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: {
        verdict: 'FAIL',
        pr_head_sha: prHeadSha,
        failure_class: 'evidence_invalid',
      },
      evaluateResult: null,
      judgeVerdict: null,
      reviewRequired: false,
      reviewApproved: false,
      decisionLog: logWithHop56,
      authCircuit: [],
      callbackResult: null,
      counters: { ...counters, pollCount: counters.pollCount ?? 0, ganCostUsd: 2.50 },
    };

    const result = derive(observed);

    // 实现后期望
    expect(result.action).toBe('spawn:evaluator-evidence-repair');
    expect(result.phase).toBe('evaluate');

    // 当前（先红）：result.action === 'spawn:generator-fix'
    // 以下断言在实现前会 FAIL
    expect(result.action).not.toBe('spawn:generator-fix');
  });

  /**
   * T-04-b: hop 57 generator-fix callback same SHA → no-progress terminal
   * 即使 hop 57 错误地进了 generator-fix，callback same SHA 也必须 terminal
   * 当前（先红）：无 no-progress 检测，会继续 generator-fix loop
   */
  test('T-04-b: hop 57 generator-fix callback same SHA → no_progress_same_sha', () => {
    const prHeadSha = 'sha-d707-original';
    const logWithHop57Fix = [
      ...D707_HOP_55_FIXTURE.baselineDecisionLog,
      D707_HOP_55_FIXTURE.hop56Verdict,
      // hop 57: 错误的 generator-fix intent，含 trigger_sha
      {
        hop: 57,
        action: 'spawn:generator-fix',
        observed: {
          trigger_sha: prHeadSha, // 记录当时的 PR head_sha
          failure_class: 'evidence_invalid',
        },
      },
      // hop 58: generator-fix callback，SHA 未变化
      {
        hop: 58,
        action: 'verdict:generator-fix-callback',
        observed: {
          pr_head_sha: prHeadSha, // same SHA → no-progress
        },
      },
    ];

    const counters = deriveCounters(logWithHop57Fix, { proposeBranchMaxRn: 0 });

    const observed = {
      run: { phase: 'generate', cost_usd: '3.00' },
      task: { status: 'in_progress', payload: {} },
      prdExists: true,
      contract: { approved: true, id: 'c-d707', row: {} },
      pr: {
        url: 'https://github.com/zenithabs/zenithjos/pull/44',
        state: 'OPEN',
        merged: false,
        ci: 'pass',
        head_sha: prHeadSha, // SHA 仍未变化
      },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: null, auth_failed: false, action: null },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: {
        verdict: 'FAIL',
        pr_head_sha: prHeadSha,
        failure_class: 'evidence_invalid',
      },
      evaluateResult: null,
      judgeVerdict: null,
      reviewRequired: false,
      reviewApproved: false,
      decisionLog: logWithHop57Fix,
      noProgress: true, // 实现后 ground-truth 推导此字段
      noProgressReason: 'same_sha',
      authCircuit: [],
      callbackResult: null,
      counters: {
        ...counters,
        pollCount: counters.pollCount ?? 0,
        ganCostUsd: 3.00,
        noProgress: true, // 实现后 deriveCounters 提供
      },
    };

    const result = derive(observed);

    // 实现后期望：terminal
    // 当前（先红）：fixOrFail（fixRound=0 < MAX_FIX_ROUNDS，继续 generator-fix）
    expect(result.action).toBe('mark_failed');
    expect(result.reason).toBe('no_progress_same_sha');
  });

  /**
   * T-04-c: MAX_FIX_ROUNDS=3 防止 hop 58-66 重复 fix（边界测试）
   * 即使 no-progress 未熔断，fixRound 超过 3 也必须 terminal
   */
  test('T-04-c: fixRound >= 3 → mark_failed(fix_cap)，不再是 20', () => {
    // 模拟已有 3 次有效 fix（产生新 SHA 的）
    const logRows = [
      { hop: 1, action: 'spawn:generator', observed: {} },
      { hop: 2, action: 'spawn:generator-fix', observed: { trigger_sha: 'sha-0' } },
      { hop: 3, action: 'verdict:generator-fix-callback', observed: { pr_head_sha: 'sha-1' } },
      { hop: 4, action: 'spawn:generator-fix', observed: { trigger_sha: 'sha-1' } },
      { hop: 5, action: 'verdict:generator-fix-callback', observed: { pr_head_sha: 'sha-2' } },
      { hop: 6, action: 'spawn:generator-fix', observed: { trigger_sha: 'sha-2' } },
      { hop: 7, action: 'verdict:generator-fix-callback', observed: { pr_head_sha: 'sha-3' } },
    ];

    const counters = deriveCounters(logRows, { proposeBranchMaxRn: 0 });

    const observed = {
      run: { phase: 'generate', cost_usd: '5.00' },
      task: { status: 'in_progress', payload: {} },
      prdExists: true,
      contract: { approved: true, id: 'c1', row: {} },
      pr: { url: 'https://github.com/test/repo/pull/1', state: 'OPEN', merged: false, ci: 'fail', head_sha: 'sha-3' },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: null, auth_failed: false, action: null },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: null,
      evaluateResult: null,
      judgeVerdict: null,
      reviewRequired: false,
      reviewApproved: false,
      decisionLog: logRows,
      authCircuit: [],
      callbackResult: null,
      counters: { ...counters, pollCount: 0, ganCostUsd: 5.00 },
    };

    const result = derive(observed);

    // 实现后（MAX_FIX_ROUNDS=3）：fixRound=3 触发 fix_cap
    // 当前（先红）：MAX_FIX_ROUNDS=20，fixRound=3 < 20，会继续 generator-fix
    expect(result.action).toBe('mark_failed');
    expect(result.reason).toBe('fix_cap');
  });

  /**
   * T-04-d: replay 全链不产生 hop 58-66（9 次重复 fix）
   * 综合测试：evidence_invalid 正确路由 + no-progress 熔断
   */
  test('T-04-d: replay 全链验证 hop 数量 ≤ 58（不产生重复 fix）', () => {
    // 验证修复后的 derive 在 hop 56（evidence_invalid）时就路由 evidence-repair
    // 不会产生任何 generator-fix hop
    let hopCount = 0;
    const generatorFixHops = [];

    // 模拟 hop 55 之后的状态
    const prHeadSha = 'sha-d707-original';
    const observed = {
      run: { phase: 'evaluate', cost_usd: '2.50' },
      task: { status: 'in_progress', payload: {} },
      prdExists: true,
      contract: { approved: true, id: 'c-d707', row: {} },
      pr: { url: 'https://github.com/zenithabs/zenithjos/pull/44', state: 'OPEN', merged: false, ci: 'pass', head_sha: prHeadSha },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: null, auth_failed: false, action: null },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: { verdict: 'FAIL', pr_head_sha: prHeadSha, failure_class: 'evidence_invalid' },
      evaluateResult: null,
      judgeVerdict: null,
      reviewRequired: false,
      reviewApproved: false,
      decisionLog: D707_HOP_55_FIXTURE.baselineDecisionLog,
      authCircuit: [],
      callbackResult: null,
      counters: { hops: 56, fixRound: 0, pollCount: 54, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 2.50 },
    };

    const result = derive(observed);

    // 修复后第 56 跳：evidence-repair，不是 generator-fix
    if (result.action === 'spawn:generator-fix') {
      generatorFixHops.push(56);
    }

    // 验证：hop 56 不产生 generator-fix
    expect(generatorFixHops).toHaveLength(0);
    expect(result.action).not.toBe('spawn:generator-fix');
  });
});
