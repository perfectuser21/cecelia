/**
 * kernel-no-progress.test.js
 *
 * [BEHAVIOR] B-02：同 SHA no-progress → terminal
 *
 * 先红后绿：当前代码 ground-truth.js 无 deriveNoProgress 接入，
 * generator-fix intent 未写 trigger_sha，callback 未写 verdict:generator-fix-callback。
 * 这些测试当前应该 FAIL，实现后应该 PASS。
 *
 * Sprint: 07231527-relay-50170af2
 * TASK_ID: 50170af2-fefa-41a7-b0b4-dcf1a5d7b077
 */

import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
import { deriveCounters } from '../../../packages/brain/src/orchestrator/counters.js';
import { ACTION } from '../../../packages/brain/src/orchestrator/constants.js';

// ---- helpers ----

function makeObserved(overrides = {}) {
  return {
    run: { phase: 'generate', cost_usd: '0' },
    task: { status: 'in_progress', payload: {} },
    prdExists: true,
    contract: { approved: true, id: 'contract-1', row: {} },
    pr: { url: 'https://github.com/test/repo/pull/42', state: 'OPEN', merged: false, ci: 'pass', head_sha: 'sha-abc' },
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
    decisionLog: [],
    authCircuit: [],
    callbackResult: null,
    counters: { hops: 5, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    ...overrides,
  };
}

// ---- T-01: same SHA no-progress → no_progress_same_sha terminal ----

describe('[BEHAVIOR] B-02 same SHA no-progress terminal', () => {
  /**
   * 场景：generator-fix 已跑完，callback pr_head_sha === trigger_sha（SHA 未前进）。
   * ground-truth 应推导 noProgress: true，derive 应路由 mark_failed(no_progress_same_sha)。
   *
   * 当前状态（先红）：ground-truth 没有 deriveNoProgress 接入，
   * observe.noProgress 字段不存在，derive 会路由到 spawn:evaluator（evaluate_fail 分支）。
   * 实现后应 PASS：derive 识别 noProgress=true → mark_failed。
   */
  test('T-02-a: derive 识别 noProgress=true → mark_failed(no_progress_same_sha)', () => {
    // 模拟 ground-truth 已推导 noProgress=true（实现后 collectGroundTruth 会提供此字段）
    const observed = makeObserved({
      // 实现后 ground-truth 会注入此字段
      noProgress: true,
      noProgressReason: 'same_sha',
      // evaluate verdict 不存在，derive 会先路由 evaluator
      evaluateVerdict: null,
      counters: { hops: 10, fixRound: 1, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    });

    const result = derive(observed);

    // 实现后期望：mark_failed
    // 当前期望（先红）：会是 spawn:evaluator
    expect(result.action).toBe('mark_failed');
    expect(result.reason).toBe('no_progress_same_sha');
  });

  /**
   * 场景：counter.js 中 fixRound 只计产生新 SHA 的 fix。
   * 若 generator-fix callback pr_head_sha === trigger_sha，不计入 fixRound。
   *
   * 当前状态（先红）：counters.js 的 fixRound = COUNT(spawn:generator-fix)，
   * 无法区分 same-SHA 和 new-SHA。
   */
  test('T-03-a: counters fixRound 不计同 SHA no-progress fix', () => {
    // 模拟 decision log：一条 spawn:generator-fix（trigger_sha=sha-old），
    // 一条 verdict:generator-fix-callback（pr_head_sha=sha-old，same SHA）
    const logRows = [
      {
        hop: 1,
        action: 'spawn:generator',
        observed: { prdExists: true },
      },
      {
        hop: 2,
        action: 'spawn:generator-fix',
        observed: { trigger_sha: 'sha-old', failure_class: 'product_failure' },
      },
      {
        hop: 3,
        action: 'verdict:generator-fix-callback',
        observed: { pr_head_sha: 'sha-old' }, // same SHA → no-progress
      },
    ];

    const counters = deriveCounters(logRows, { proposeBranchMaxRn: 0 });

    // 实现后期望：fixRound=0（因为 SHA 未变化，不算有效 fix）
    // 当前期望（先红）：fixRound=1（当前只计 spawn:generator-fix 数量）
    expect(counters.fixRound).toBe(0);
  });

  /**
   * 场景：counter.js fixRound 计产生新 SHA 的有效 fix。
   */
  test('T-03-b: counters fixRound 计新 SHA fix', () => {
    const logRows = [
      {
        hop: 1,
        action: 'spawn:generator',
        observed: {},
      },
      {
        hop: 2,
        action: 'spawn:generator-fix',
        observed: { trigger_sha: 'sha-old', failure_class: 'product_failure' },
      },
      {
        hop: 3,
        action: 'verdict:generator-fix-callback',
        observed: { pr_head_sha: 'sha-new' }, // new SHA → valid fix
      },
    ];

    const counters = deriveCounters(logRows, { proposeBranchMaxRn: 0 });

    // 实现后期望：fixRound=1（SHA 变化了，算有效 fix）
    // 当前期望（先红）：fixRound=1（恰好相同，但原因不同——当前只计 spawn intent 数量）
    // 注意：此测试可能偶然通过，但它验证的是正确的语义
    expect(counters.fixRound).toBe(1);
  });

  /**
   * 场景：generator-fix intent 必须写入 trigger_sha。
   * 验证 ground-truth 的 noProgress 推导逻辑依赖于 trigger_sha 存在。
   */
  test('T-02-b: trigger_sha 缺失时 noProgress 应为 false（保守）', () => {
    const logRows = [
      {
        hop: 2,
        action: 'spawn:generator-fix',
        observed: {}, // 无 trigger_sha → 当前代码写法
      },
      {
        hop: 3,
        action: 'verdict:generator-fix-callback',
        observed: { pr_head_sha: 'sha-abc' },
      },
    ];

    const counters = deriveCounters(logRows, { proposeBranchMaxRn: 0 });

    // trigger_sha 缺失时，不能误判为 same-SHA，保守处理不计入 noProgress
    // 当前代码不支持此推导，实现后 deriveCounters 需新增 noProgress 字段
    expect(counters).toHaveProperty('noProgress');
    expect(counters.noProgress).toBe(false);
  });
});
