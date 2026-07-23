/**
 * kernel-no-progress-integration.test.js
 *
 * [BEHAVIOR] B-02：no-progress 集成推导测试（从 decision log 结构推导，不手动注入）
 *
 * 先红后绿：当前代码 ground-truth.js 无 deriveNoProgress 接入，
 * collectGroundTruth 不从 decision log 推导 noProgress 字段。
 *
 * 修复后期望：
 *   collectGroundTruth 从 decision log 推导 noProgress=true，
 *   当 spawn:generator-fix 的 trigger_sha === 后续 verdict:generator-fix-callback 的 pr_head_sha
 *
 * Sprint: 07231527-relay-50170af2
 * TASK_ID: 50170af2-fefa-41a7-b0b4-dcf1a5d7b077
 *
 * 新增说明（round-2 C-3）：
 * - 从 decision log 结构推导 noProgress（不手动注入 noProgress=true）
 * - 测试路径：decision log 包含 spawn:generator-fix(trigger_sha=sha-X) + verdict:generator-fix-callback(pr_head_sha=sha-X)
 * - 调用 collectGroundTruth（mock pool 返回真实结构）
 * - 断言 observed.noProgress === true 且 observed.noProgressReason === 'no_progress_same_sha'
 */

import { collectGroundTruth } from '../ground-truth.js';

// ---- helper: 构建 mock pool ----

function makeMockPool({
  runPhase = 'generate',
  prUrl = 'https://github.com/test/repo/pull/42',
  decisionLogRows = [],
} = {}) {
  return {
    query: async (sql) => {
      if (sql.includes('initiative_runs')) {
        return {
          rows: [{
            id: 'run-np-1',
            phase: runPhase,
            contract_id: 'contract-np-1',
            cost_usd: '1.00',
            pr_url: prUrl,
          }],
        };
      }
      if (sql.includes('initiative_contracts')) {
        return { rows: [{ id: 'contract-np-1', status: 'approved' }] };
      }
      if (sql.includes('tasks')) {
        return {
          rows: [{
            id: 'task-np-1',
            status: 'in_progress',
            payload: JSON.stringify({ review_required: false }),
            title: 'no-progress integration test',
            ability_id: null,
          }],
        };
      }
      if (sql.includes('orchestrator_decision_log')) {
        return { rows: decisionLogRows };
      }
      if (sql.includes('harness_attempts')) return { rows: [] };
      if (sql.includes('account_usage_cache')) return { rows: [] };
      return { rows: [] };
    },
  };
}

function makeMockDeps({ prHeadSha = 'sha-X', pool, ciStatus = 'pass' } = {}) {
  return {
    pool,
    execCmd: (cmd) => {
      if (cmd.includes('gh pr view')) {
        return JSON.stringify({
          state: 'OPEN',
          mergeStateStatus: 'CLEAN',
          headRefOid: prHeadSha,
          statusCheckRollup: ciStatus === 'pass'
            ? [{ state: 'SUCCESS' }]
            : [{ state: 'FAILURE' }],
        });
      }
      if (cmd.includes('git ls-remote')) return '';
      if (cmd.includes('docker ps') && cmd.includes('exited')) return '';
      if (cmd.includes('docker ps')) return '';
      if (cmd.includes('docker inspect')) return '{"ExitCode": 0}';
      return '';
    },
    fileExists: (path) => path.includes('sprint-prd.md'),
    readFile: () => '# PRD content',
  };
}

// ---- C-3 核心测试：从 decision log 结构推导 noProgress ----

describe('[BEHAVIOR] B-02 no-progress 集成推导（ground-truth collectGroundTruth）', () => {

  /**
   * T-NP-INT-01: decision log 含 spawn:generator-fix(trigger_sha=sha-X) +
   *              verdict:generator-fix-callback(pr_head_sha=sha-X) → noProgress=true
   *
   * 关键：不手动注入 noProgress，让 collectGroundTruth 从 decision log 推导。
   * 当前（先红）：collectGroundTruth 不推导 noProgress 字段，返回的 observed 中无此字段。
   */
  test('T-NP-INT-01: spawn:generator-fix trigger_sha === callback pr_head_sha → observed.noProgress=true', async () => {
    const sameSha = 'sha-same-abc123';

    const decisionLogRows = [
      {
        hop: 1,
        action: 'spawn:generator',
        observed: JSON.stringify({ prdExists: true }),
        detail: JSON.stringify({ reason: 'contract_approved' }),
      },
      {
        hop: 2,
        action: 'spawn:generator-fix',
        observed: JSON.stringify({
          trigger_sha: sameSha, // 记录当时的 PR head_sha
          failure_class: 'ci_fail',
          pr: { head_sha: sameSha },
        }),
        detail: JSON.stringify({ reason: 'ci_fail' }),
      },
      {
        hop: 3,
        action: 'verdict:generator-fix-callback',
        observed: JSON.stringify({
          pr_head_sha: sameSha, // 同一 SHA → no-progress
        }),
        detail: JSON.stringify({ pr_head_sha: sameSha }),
      },
    ];

    const pool = makeMockPool({ decisionLogRows, prUrl: 'https://github.com/test/repo/pull/42' });
    const deps = makeMockDeps({ prHeadSha: sameSha, pool });

    const observed = await collectGroundTruth(deps, {
      taskId: 'task-np-1',
      runId: 'run-np-1',
    });

    // 实现后期望：noProgress=true，noProgressReason='no_progress_same_sha'
    // 当前（先红）：collectGroundTruth 不推导 noProgress，observed.noProgress 为 undefined/false
    expect(observed.noProgress).toBe(true);
    expect(observed.noProgressReason).toBe('no_progress_same_sha');
  });

  /**
   * T-NP-INT-02: spawn:generator-fix trigger_sha !== callback pr_head_sha → noProgress=false
   * 正常情况：fix 推进了 SHA → 不是 no-progress
   */
  test('T-NP-INT-02: trigger_sha !== callback pr_head_sha → observed.noProgress=false', async () => {
    const triggerSha = 'sha-before-fix';
    const newSha = 'sha-after-fix-new';

    const decisionLogRows = [
      {
        hop: 1,
        action: 'spawn:generator',
        observed: JSON.stringify({ prdExists: true }),
        detail: JSON.stringify({ reason: 'contract_approved' }),
      },
      {
        hop: 2,
        action: 'spawn:generator-fix',
        observed: JSON.stringify({
          trigger_sha: triggerSha,
          failure_class: 'ci_fail',
          pr: { head_sha: triggerSha },
        }),
        detail: JSON.stringify({ reason: 'ci_fail' }),
      },
      {
        hop: 3,
        action: 'verdict:generator-fix-callback',
        observed: JSON.stringify({
          pr_head_sha: newSha, // 新 SHA → 有效推进
        }),
        detail: JSON.stringify({ pr_head_sha: newSha }),
      },
    ];

    const pool = makeMockPool({ decisionLogRows, prUrl: 'https://github.com/test/repo/pull/42' });
    const deps = makeMockDeps({ prHeadSha: newSha, pool });

    const observed = await collectGroundTruth(deps, {
      taskId: 'task-np-1',
      runId: 'run-np-1',
    });

    // 实现后期望：noProgress=false（SHA 变化了，不是 no-progress）
    // 当前（先红）：collectGroundTruth 不推导 noProgress 字段
    expect(observed.noProgress).toBe(false);
  });

  /**
   * T-NP-INT-03: trigger_sha 缺失 → noProgress=false（保守处理）
   * 若 spawn:generator-fix 的 observed 中无 trigger_sha，不能误判为 no-progress
   */
  test('T-NP-INT-03: trigger_sha 缺失时 noProgress=false（保守）', async () => {
    const callbackSha = 'sha-callback';

    const decisionLogRows = [
      {
        hop: 1,
        action: 'spawn:generator',
        observed: JSON.stringify({ prdExists: true }),
        detail: JSON.stringify({ reason: 'contract_approved' }),
      },
      {
        hop: 2,
        action: 'spawn:generator-fix',
        observed: JSON.stringify({
          // 无 trigger_sha → 旧格式，保守处理
          failure_class: 'ci_fail',
        }),
        detail: JSON.stringify({ reason: 'ci_fail' }),
      },
      {
        hop: 3,
        action: 'verdict:generator-fix-callback',
        observed: JSON.stringify({
          pr_head_sha: callbackSha,
        }),
        detail: JSON.stringify({ pr_head_sha: callbackSha }),
      },
    ];

    const pool = makeMockPool({ decisionLogRows, prUrl: 'https://github.com/test/repo/pull/42' });
    const deps = makeMockDeps({ prHeadSha: callbackSha, pool });

    const observed = await collectGroundTruth(deps, {
      taskId: 'task-np-1',
      runId: 'run-np-1',
    });

    // 实现后期望：noProgress=false（无 trigger_sha 保守处理，不误判为 no-progress）
    // 当前（先红）：collectGroundTruth 不推导 noProgress 字段
    expect(observed.noProgress).toBe(false);
  });

  /**
   * T-NP-INT-04: d707 场景 replay — judge_fail 后 SHA 不变 → noProgress
   * 复现 d707 真实 Bug：hop 57-66 generator-fix 同 SHA dc7e1bc0...（judge_fail 触发）
   */
  test('T-NP-INT-04: d707 judge_fail → generator-fix → callback same SHA → noProgress=true', async () => {
    const d707Sha = 'dc7e1bc0a97e87d7a93b9f297cb8db6de6ae6cd7';

    const decisionLogRows = [
      {
        hop: 54,
        action: 'verdict:evaluate',
        observed: JSON.stringify({ role: 'evaluator', attempt_id: 'attempt-eval-54' }),
        detail: JSON.stringify({ verdict: 'PASS', pr_head_sha: d707Sha, failure_class: null }),
      },
      {
        hop: 55,
        action: 'spawn:judge',
        observed: JSON.stringify({ pr: { head_sha: d707Sha, ci: 'pass' } }),
        detail: JSON.stringify({ reason: 'evaluate_passed_awaiting_judge' }),
      },
      {
        hop: 56,
        action: 'verdict:judge',
        observed: JSON.stringify({ pr: { head_sha: d707Sha } }),
        detail: JSON.stringify({ verdict: 'FAIL', pr_head_sha: d707Sha }),
      },
      {
        hop: 57,
        action: 'spawn:generator-fix',
        observed: JSON.stringify({
          trigger_sha: d707Sha, // judge_fail 后派 fix，trigger_sha = 当时 PR head_sha
          failure_class: 'judge_fail',
          pr: { head_sha: d707Sha },
        }),
        detail: JSON.stringify({ reason: 'judge_fail' }),
      },
      {
        hop: 58,
        action: 'verdict:generator-fix-callback',
        observed: JSON.stringify({
          pr_head_sha: d707Sha, // SHA 未变化 → no-progress
        }),
        detail: JSON.stringify({ pr_head_sha: d707Sha }),
      },
    ];

    const pool = makeMockPool({ decisionLogRows, prUrl: 'https://github.com/perfectuser21/cecelia/pull/4204' });
    const deps = makeMockDeps({ prHeadSha: d707Sha, pool });

    const observed = await collectGroundTruth(deps, {
      taskId: 'task-np-1',
      runId: 'run-np-1',
    });

    // 实现后期望：noProgress=true（d707 真实 Bug 场景，judge_fail 后 SHA 未变化）
    // 当前（先红）：collectGroundTruth 不推导 noProgress
    expect(observed.noProgress).toBe(true);
    expect(observed.noProgressReason).toBe('no_progress_same_sha');
  });
});
