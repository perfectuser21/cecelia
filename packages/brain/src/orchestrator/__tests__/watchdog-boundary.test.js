/**
 * watchdog-boundary.test.js — B-10: Watchdog 边界规则
 *
 * TDD 骨架：全红状态。
 * FR-10 要求：
 * 1. 过期 run 上 watchdog 不得 resume/requeue
 * 2. watchdog 不得在过期 run 上创建第二个 run
 * 3. Evaluator PASS 后 Judge 环境故障只允许重跑 Judge（不重跑 Evaluator）
 *
 * FR-12 条目 8：watchdog 在过期 run 上不得 resume 或创建第二个 run
 */
import { describe, it, expect } from 'vitest';

import { watchdogShouldResume, watchdogAction } from '../watchdog.js';
import { derive } from '../derive.js';

// ─── 测试数据 ───────────────────────────────────────────────────────────────

const EXPIRED_RUN = {
  id: 'run-expired-001',
  phase: 'failed',
  terminal_reason: 'automation_deadline_exceeded',
  started_at: new Date(Date.now() - 200 * 60 * 1000), // 200 分钟前启动（已超 120 分钟）
  result: { terminal: true, reason: 'automation_deadline_exceeded' },
};

const ACTIVE_RUN = {
  id: 'run-active-001',
  phase: 'generate',
  terminal_reason: null,
  started_at: new Date(Date.now() - 30 * 60 * 1000), // 30 分钟前启动（未超时）
  result: null,
};

const DECISION_LOG_EXPIRED = [
  {
    hop: 60,
    action: 'terminal',
    detail: { terminal_reason: 'automation_deadline_exceeded', timestamp: new Date(Date.now() - 10 * 60 * 1000) },
  },
];

// ─── B-10.1：过期 run 上 watchdog 不得 resume/requeue ────────────────────────

describe('B-10.1: 过期 run watchdog 不得 resume/requeue', () => {
  it('run 已写入 terminal_reason=automation_deadline_exceeded → watchdogShouldResume 返回 false', () => {
    expect(watchdogShouldResume(EXPIRED_RUN)).toBe(false);
  });

  it('active run（无 terminal_reason）→ watchdogShouldResume 可以返回 true', () => {
    // 非过期 run 的 watchdog 行为不受此约束限制
    // 此测试仅验证过期判断逻辑对非过期 run 不误判
    const result = watchdogShouldResume(ACTIVE_RUN);
    // active run 不应被判定为不可恢复（watchdog 可以 resume）
    expect(typeof result).toBe('boolean');
  });

  it('过期 run watchdog 动作应为 fenced_terminal_cleanup，不得为 resume/requeue', () => {
    const action = watchdogAction(EXPIRED_RUN, DECISION_LOG_EXPIRED);
    expect(action.action).not.toBe('resume');
    expect(action.action).not.toBe('requeue');
    expect(action.action).toBe('fenced_terminal_cleanup');
  });

  it('过期 run watchdog derive() 读取到 terminal → 输出 noop，不产生新 spawn', () => {
    const observed = {
      run: {
        phase: 'failed',
        terminal_reason: 'automation_deadline_exceeded',
        id: EXPIRED_RUN.id,
      },
      task: { status: 'failed' },
      prdExists: true,
      contract: { approved: true },
      pr: { url: 'u', state: 'OPEN', ci: 'pass', merged: false, head_sha: 'sha-xyz' },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: 0, auth_failed: false },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: null,
      judgeVerdict: null,
      reviewRequired: false,
      reviewApproved: false,
      isDeadlineExceeded: true,
      terminalReasonWritten: 'automation_deadline_exceeded', // 已有 terminal
      counters: { hops: 60, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    };
    const r = derive(observed);
    // 已有 terminal 的 run，derive 不得产生新 spawn action
    expect(r.action).not.toBe('spawn:generator-fix');
    expect(r.action).not.toBe('spawn:evaluator');
    expect(r.action).not.toBe('spawn:judge');
    // 应输出 noop 或 terminal 确认
    expect(['noop', 'mark_failed', 'terminal_confirmed']).toContain(r.action);
  });
});

// ─── B-10.2：watchdog 不得创建第二个 run ────────────────────────────────────

describe('B-10.2: watchdog 不得在过期 run 上创建第二个 run', () => {
  it('过期 run watchdog 动作不包含 create_new_run', () => {
    const action = watchdogAction(EXPIRED_RUN, DECISION_LOG_EXPIRED);
    expect(action.action).not.toBe('create_new_run');
    expect(action.action).not.toBe('spawn_new_run');
  });

  it('watchdog fenced_terminal_cleanup 不携带新 run 创建参数', () => {
    const action = watchdogAction(EXPIRED_RUN, DECISION_LOG_EXPIRED);
    // 确保清理动作不含新 run 的 payload
    if (action.payload) {
      expect(action.payload.newRunId).toBeUndefined();
      expect(action.payload.createRun).toBeFalsy();
    }
    // 核心约束：action 必须为清理类，不含创建类
    expect(action.action).toBe('fenced_terminal_cleanup');
  });
});

// ─── B-10.3：Evaluator PASS 后 Judge 故障只允许重跑 Judge ─────────────────────

describe('B-10.3: Evaluator PASS 后 Judge 环境故障只允许重跑 Judge', () => {
  /**
   * 场景：Evaluator 已输出 PASS verdict，
   * Judge 因 environment_failure 失败。
   * 约束：不得重跑 Evaluator，只允许重跑 Judge。
   */
  it('evaluateVerdict=PASS, judgeVerdict=FAIL(environment_failure) → derive 输出 spawn:judge，不得输出 spawn:evaluator', () => {
    const observed = {
      run: { phase: 'verify' },
      task: { status: 'in_progress' },
      prdExists: true,
      contract: { approved: true },
      pr: { url: 'u', state: 'OPEN', ci: 'pass', merged: false, head_sha: 'sha-v1' },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: 0, auth_failed: false },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: {
        verdict: 'PASS',
        pr_head_sha: 'sha-v1',
        // Evaluator 已成功，有持久化 verdict
        attempt_id: 'eval-attempt-001',
        committed_at: new Date(Date.now() - 5 * 60 * 1000),
      },
      judgeVerdict: {
        verdict: 'FAIL',
        pr_head_sha: 'sha-v1',
        failure_class: 'environment_failure',
        error_signature: 'judge-env-timeout-001',
      },
      reviewRequired: false,
      reviewApproved: false,
      noProgressSameSha: false,
      // 关键：environment recovery 计数（同错误签名第一次，允许重跑 Judge）
      environmentRecoveryCount: 0,
      judgeEnvironmentErrorSignature: 'judge-env-timeout-001',
      counters: {
        hops: 35,
        fixRound: 1,
        pollCount: 0,
        noPushStreak: 0,
        noVerdictStreak: 0,
        ganCostUsd: 0,
      },
    };
    const r = derive(observed);
    // 必须重跑 Judge（environment recovery）
    expect(r.action).toBe('spawn:judge');
    // 绝对不得重跑 Evaluator
    expect(r.action).not.toBe('spawn:evaluator');
    expect(r.action).not.toBe('spawn:evaluator-evidence-repair');
    // 也不得重跑 generator
    expect(r.action).not.toBe('spawn:generator-fix');
    expect(r.action).not.toBe('spawn:generator');
  });

  it('Evaluator PASS + Judge 同错误签名 environment_failure 第二次 → mark_failed（不再重跑 Judge）', () => {
    const observed = {
      run: { phase: 'verify' },
      task: { status: 'in_progress' },
      prdExists: true,
      contract: { approved: true },
      pr: { url: 'u', state: 'OPEN', ci: 'pass', merged: false, head_sha: 'sha-v1' },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: 0, auth_failed: false },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: {
        verdict: 'PASS',
        pr_head_sha: 'sha-v1',
        attempt_id: 'eval-attempt-001',
        committed_at: new Date(Date.now() - 15 * 60 * 1000),
      },
      judgeVerdict: {
        verdict: 'FAIL',
        pr_head_sha: 'sha-v1',
        failure_class: 'environment_failure',
        error_signature: 'judge-env-timeout-001',
      },
      reviewRequired: false,
      reviewApproved: false,
      noProgressSameSha: false,
      // 关键：同错误签名已恢复 1 次，达到上限
      environmentRecoveryCount: 1,
      judgeEnvironmentErrorSignature: 'judge-env-timeout-001',
      counters: {
        hops: 40,
        fixRound: 1,
        pollCount: 0,
        noPushStreak: 0,
        noVerdictStreak: 0,
        ganCostUsd: 0,
      },
    };
    const r = derive(observed);
    // 同错误签名第二次 → 必须 mark_failed
    expect(r.action).toBe('mark_failed');
    // 不得 spawn:judge 再次重试
    expect(r.action).not.toBe('spawn:judge');
    // 不得 spawn:evaluator
    expect(r.action).not.toBe('spawn:evaluator');
  });

  it('Evaluator PASS + Judge PASS → 正常进入 human-review，Evaluator 不被重跑', () => {
    const observed = {
      run: { phase: 'verify' },
      task: { status: 'in_progress' },
      prdExists: true,
      contract: { approved: true },
      pr: { url: 'u', state: 'OPEN', ci: 'pass', merged: false, head_sha: 'sha-v1' },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: 0, auth_failed: false },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-v1', attempt_id: 'eval-001' },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: 'sha-v1', failure_class: null },
      reviewRequired: true,
      reviewApproved: false,
      noProgressSameSha: false,
      counters: { hops: 38, fixRound: 1, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    };
    const r = derive(observed);
    // 双 PASS → 进入 human-review 等待（loop 层会追加 effect:human_review_requested marker）
    expect(r.action).toBe('wait:human_review');
    // 不得重跑 Evaluator
    expect(r.action).not.toBe('spawn:evaluator');
  });
});
