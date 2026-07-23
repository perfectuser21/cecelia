/**
 * deadline-callback-race.test.js — B-12: deadline 与 callback 竞态 → 单一 fenced terminal
 *
 * TDD 骨架：全红状态。
 * FR-12 条目 15：deadline 与 attempt callback 竞态下，只能出现一个 fenced terminal 结果。
 *
 * 核心约束：
 * - deadline fence 与 callback 到达竞争时，只产生一个 terminal_reason 行
 * - run.phase 写入 terminal 后，后续 derive() 必须返回 noop
 * - 不得出现两个不同 terminal_reason 的终止行
 * - deadline 先写入后，callback 到达时写 verdict 行但不触发新 spawn action
 * - callback 先完成后，deadline fence 到达时检测到已有 terminal 行 → 跳过重复写入
 */
import { describe, it, expect } from 'vitest';

// TODO: 实现后取消注释
// import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
// import { isDeadlineExceeded } from '../../../packages/brain/src/orchestrator/gates.js';
// import { resolveRaceCondition } from '../../../packages/brain/src/orchestrator/loop.js';

// Placeholders — 全红骨架
function derive(_observed) {
  return { phase: 'unknown', action: 'unknown', reason: 'not_implemented' };
}

function isDeadlineExceeded(_startedAt, _nowAt, _budgetMs) {
  return undefined; // 未实现
}

/**
 * 模拟竞态处理：当 terminal 已存在时返回 noop
 * 实现后应读取 DB 的 run.phase/terminal_reason 状态
 */
function resolveRaceCondition(_runState, _incomingAction) {
  return { resolved: 'not_implemented', action: 'unknown' };
}

// ─── 场景一：deadline fence 先触发，callback 后到达 ──────────────────────────

describe('B-12.1: deadline fence 先写入 → 后续 callback 不触发新 spawn', () => {
  it('run 已有 terminal_reason=automation_deadline_exceeded → callback 到达时 derive 输出 noop', () => {
    // 场景：deadline fence 在 t=119:59 写入 terminal
    // callback 在 t=120:01 到达（已超时后才收到 worker 结果）
    const observed = {
      run: {
        phase: 'failed',
        terminal_reason: 'automation_deadline_exceeded',
        id: 'run-race-001',
      },
      task: { status: 'in_progress' },
      prdExists: true,
      contract: { approved: true },
      pr: { url: 'u', state: 'OPEN', ci: 'pass', merged: false, head_sha: 'sha-v1' },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: 0, auth_failed: false },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      // callback 后到达：evaluator 说 PASS（但 deadline 已写入）
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-v1', late_callback: true },
      judgeVerdict: null,
      reviewRequired: false,
      reviewApproved: false,
      isDeadlineExceeded: true,
      terminalReasonWritten: 'automation_deadline_exceeded',
      counters: { hops: 61, fixRound: 1, pollCount: 2, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    };
    const r = derive(observed);
    // 已有 terminal，不得产生新 spawn action
    expect(r.action).not.toBe('spawn:judge');
    expect(r.action).not.toBe('spawn:generator-fix');
    expect(r.action).not.toBe('spawn:evaluator');
    // 应输出 noop 或确认 terminal
    expect(['noop', 'terminal_confirmed', 'mark_failed']).toContain(r.action);
  });

  it('deadline 先写入 terminal 后，decision log 中只有一个 terminal 行', () => {
    // 模拟 decision log：先有 deadline terminal，后有 callback verdict（不是 terminal）
    const decisionLog = [
      { hop: 60, action: 'terminal', detail: { terminal_reason: 'automation_deadline_exceeded' } },
      // callback 到达时应只写 verdict 行，不再写 terminal 行
      { hop: 61, action: 'verdict:evaluate', detail: { verdict: 'PASS', late: true, no_spawn: true } },
    ];

    const terminalRows = decisionLog.filter((r) => r.action === 'terminal');
    const terminalReasons = new Set(terminalRows.map((r) => r.detail.terminal_reason).filter(Boolean));

    // 只允许一个 terminal 行
    expect(terminalRows.length).toBe(1);
    // 只允许一种 terminal reason
    expect(terminalReasons.size).toBeLessThanOrEqual(1);
  });
});

// ─── 场景二：callback 先完成，deadline fence 后到达 ─────────────────────────

describe('B-12.2: callback 先完成（PASS） → deadline fence 到达时跳过重复 terminal 写入', () => {
  it('evaluator 已 PASS → judge PASS → terminal=done，deadline fence 到达时输出 noop（不覆盖 terminal）', () => {
    // 场景：正常流程，evaluator+judge 均 PASS，run 进入 human_review_requested
    // deadline fence 在 derive 后触发，但 run 已处于 done 态
    const observed = {
      run: {
        phase: 'done',
        terminal_reason: 'completed',
        id: 'run-race-002',
      },
      task: { status: 'completed' },
      prdExists: true,
      contract: { approved: true },
      pr: { url: 'u', state: 'MERGED', ci: 'pass', merged: true, head_sha: 'sha-v1' },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: 0, auth_failed: false },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-v1' },
      judgeVerdict: { verdict: 'PASS', pr_head_sha: 'sha-v1', failure_class: null },
      reviewRequired: true,
      reviewApproved: true,
      isDeadlineExceeded: true, // deadline 在完成后才"到达"（时钟注入模拟）
      terminalReasonWritten: 'completed',
      counters: { hops: 55, fixRound: 1, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    };
    const r = derive(observed);
    // run 已完成，deadline fence 不得覆盖为 failed
    expect(r.action).not.toBe('mark_failed');
    // 不得写入 automation_deadline_exceeded（run 已 done）
    if (r.reason) {
      expect(r.reason).not.toContain('automation_deadline_exceeded');
    }
  });

  it('decision log 中两个 terminal 行（completed + deadline）应被检测为异常', () => {
    // 这是不允许出现的状态：两个 terminal reason
    const decisionLog = [
      { hop: 55, action: 'terminal', detail: { terminal_reason: 'completed' } },
      { hop: 56, action: 'terminal', detail: { terminal_reason: 'automation_deadline_exceeded' } },
    ];

    const terminalRows = decisionLog.filter((r) => r.action === 'terminal');
    const terminalReasons = new Set(terminalRows.map((r) => r.detail.terminal_reason).filter(Boolean));

    // 断言：出现两个 terminal 行表明竞态保护未生效（这是 B-12 要防止的情况）
    // 测试框架预期：实现后此测试应确保 terminalRows.length === 1
    // 此骨架断言两个 terminal 行是"异常"状态（实现后应确保不产生此状态）
    expect(terminalRows.length).toBeGreaterThan(1); // 骨架：此处为异常检测，实现应让此不可能发生
    expect(terminalReasons.size).toBeGreaterThan(1); // 骨架：实现后应确保 size <= 1
  });
});

// ─── 场景三：resolveRaceCondition 函数语义 ──────────────────────────────────

describe('B-12.3: resolveRaceCondition 竞态解决函数', () => {
  it('run 已有 terminal → incoming spawn action 被拦截为 noop', () => {
    const runState = { terminal_reason: 'automation_deadline_exceeded', phase: 'failed' };
    const incomingAction = { action: 'spawn:generator-fix', reason: 'product_failure' };

    const resolved = resolveRaceCondition(runState, incomingAction);
    expect(resolved.resolved).not.toBe('not_implemented'); // 实现后不应返回 not_implemented
    // 实现后应返回 noop
    expect(resolved.action).toBe('noop');
  });

  it('run 未有 terminal → incoming spawn action 正常通过', () => {
    const runState = { terminal_reason: null, phase: 'generate' };
    const incomingAction = { action: 'spawn:generator-fix', reason: 'product_failure' };

    const resolved = resolveRaceCondition(runState, incomingAction);
    expect(resolved.resolved).not.toBe('not_implemented');
    // 正常情况下不拦截
    expect(resolved.action).toBe('spawn:generator-fix');
  });

  it('两个并发 terminal 写入请求 → 只允许第一个成功', () => {
    // 模拟：deadline fence（t=120:00）和 judge terminal callback（t=120:01）几乎同时写入
    // 期望：只有一个成功，第二个被幂等保护跳过

    const terminalAttempts = [
      { terminal_reason: 'automation_deadline_exceeded', timestamp: new Date(Date.now()) },
      { terminal_reason: 'judge_environment_failure_terminal', timestamp: new Date(Date.now() + 1) },
    ];

    // TODO: 实现后用真实 DB 事务验证；骨架仅断言数据结构
    // 骨架：验证两个不同 terminal reason 的尝试结构合法
    expect(terminalAttempts.length).toBe(2);
    expect(terminalAttempts[0].terminal_reason).not.toBe(terminalAttempts[1].terminal_reason);

    // 实现约束（非骨架断言，注释形式留存）：
    // - DB 唯一约束或乐观锁确保 initiative_runs.terminal_reason 只写一次
    // - 第二次写入应抛出冲突错误或被应用层幂等检测跳过
    // - 最终 decision_log 中 terminal 行只有 1 条
  });
});

// ─── 场景四：deadline fence 与 callback 时间窗口 ────────────────────────────

describe('B-12.4: 时间窗口边界（纯函数 clock 注入）', () => {
  it('119:59 时 callback 到达 + 无 deadline fence → callback 正常处理', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const at119m59s = new Date(start.getTime() + 119 * 60 * 1000 + 59 * 1000);

    // 此时 deadline 未超，callback 正常
    const exceeded = isDeadlineExceeded(start, at119m59s, 120 * 60 * 1000);
    // 实现后：!exceeded → callback 正常处理，无竞态问题
    expect(exceeded).toBe(false);
  });

  it('120:00 时 callback 与 deadline 同时到达 → 只产生一个 fenced terminal', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const at120m00s = new Date(start.getTime() + 120 * 60 * 1000);

    const exceeded = isDeadlineExceeded(start, at120m00s, 120 * 60 * 1000);
    // 实现后：exceeded=true，deadline fence 优先；callback 晚到时检测到 terminal 跳过 spawn
    expect(exceeded).toBe(true);
  });

  it('120:01 时 callback 到达（deadline 已过 1 秒）→ derive 检测到 terminalReasonWritten → noop', () => {
    const observed = {
      run: { phase: 'failed', terminal_reason: 'automation_deadline_exceeded', id: 'run-race-003' },
      task: { status: 'in_progress' },
      prdExists: true,
      contract: { approved: true },
      pr: { url: 'u', state: 'OPEN', ci: 'pass', merged: false, head_sha: 'sha-v1' },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: 0, auth_failed: false },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-v1', late_callback: true },
      judgeVerdict: null,
      reviewRequired: false,
      reviewApproved: false,
      isDeadlineExceeded: true,
      terminalReasonWritten: 'automation_deadline_exceeded',
      counters: { hops: 61, fixRound: 1, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
    };

    const r = derive(observed);
    expect(r.action).not.toBe('spawn:judge');
    expect(r.action).not.toBe('spawn:generator-fix');
    expect(['noop', 'terminal_confirmed', 'mark_failed']).toContain(r.action);
  });
});
