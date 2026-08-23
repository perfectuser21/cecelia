/**
 * GP-Anchor: factory/F1 造完真验 #step3
 *
 * 第 29 批（r60 run 918422f4 案卷）：
 *
 * ① Commander attempt 基础设施类失败（lease 过期/容器死/5xx）曾把整个 run 拖死：
 *    无 failover 目标 → wait:human_review → GAN 期人审无载体（无 PR 无冻结候选）
 *    → dispatch BLOCKED ×2 → blocked_same_state 判死。
 *    Commander 是监理不是承重墙：基础设施类失败应降级 continue 走 kernel 默认
 *    决策（kernel-only 语义，已长期验证安全），留 degraded 理由；semantic_refusal
 *    （Commander 明确拒绝，可能发现真问题）仍人审。
 * ② 缺省 profile fallbacks 为空=单点，补 claude/account2 做 failover 目标。
 */
import { describe, expect, it } from 'vitest';
import { createCommanderCoordinator } from '../../../packages/brain/src/orchestrator/commander-coordinator.js';
import { parseCommanderProfile } from '../../../packages/brain/src/orchestrator/commander-profile.js';

const RUN_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const DEFAULT_DECISION = { phase: 'gan', action: 'spawn:proposer', reason: 'no_contract_yet' };

function makeCoordinator({ latestAttempt, stateStatus = 'active' }) {
  const state = {
    run_id: RUN_ID,
    status: stateStatus,
    event_cursor: 5,
    memory: {},
  };
  const commanderStore = {
    ensureRun: async () => state,
    get: async () => state,
    updateMemory: async () => state,
    advanceCursor: async () => state,
  };
  const eventStore = {
    list: async () => [],
    latestCursor: async () => 5,
  };
  const attemptStore = {
    getLatestCommanderAttempt: async () => latestAttempt,
    listCommanderFailoverLineage: async () => (latestAttempt ? [latestAttempt] : []),
  };
  const actorInbox = { list: async () => [] };
  return createCommanderCoordinator({
    commanderStore,
    eventStore,
    attemptStore,
    actorInbox,
    appendDecision: async () => 99,
    nextHop: async () => 99,
    now: () => new Date('2026-08-24T02:00:00.000Z'),
  });
}

function hybridInput(overrides = {}) {
  return {
    run: { id: RUN_ID, phase: 'gan', commander_mode: 'hybrid' },
    commanderMode: 'hybrid',
    runProfile: parseCommanderProfile({ commanderMode: 'hybrid', payload: {} }),
    objective: { task_id: 't1', title: 'x', description: 'y' },
    observed: {},
    defaultDecision: DEFAULT_DECISION,
    historySummary: { counters: {} },
    budgets: { spent_usd: 0 },
    ...overrides,
  };
}

describe('② 缺省 Commander profile 带 fallback（消单点）', () => {
  it('DEFAULT profile fallbacks 非空且含 claude 目标', () => {
    const profile = parseCommanderProfile({ commanderMode: 'hybrid', payload: {} });
    expect(profile.commander.fallbacks.length).toBeGreaterThan(0);
    expect(profile.commander.fallbacks.some((t) => t.provider === 'claude')).toBe(true);
  });
});

describe('① Commander 基础设施失败降级续跑（r60 案卷）', () => {
  it('lease 过期类失败且无可用 failover → continue 走默认决策（不再 wait:human_review）', async () => {
    // 失败 attempt 覆盖 primary 与全部 fallbacks（failover 真穷尽）
    const profile = parseCommanderProfile({ commanderMode: 'hybrid', payload: {} });
    const allTargets = [profile.commander.primary, ...profile.commander.fallbacks];
    const latestAttempt = {
      id: 'att-1',
      status: 'failed',
      failure_class: 'infrastructure',
      error_code: 'worker_attempt_replacement_required_after_lease',
      logical_cycle_id: 'cycle-1',
      provider: allTargets.at(-1).provider,
      account: allTargets.at(-1).account,
      model: allTargets.at(-1).model ?? null,
      machine: allTargets.at(-1).machine ?? null,
    };
    const coordinator = makeCoordinator({ latestAttempt, stateStatus: 'failed' });
    const result = await coordinator.reconcile(hybridInput());
    expect(result.kind).toBe('continue');
    expect(result.decision.action).toBe(DEFAULT_DECISION.action);
    expect(result.decision.action).not.toBe('wait:human_review');
  });

  it('负向：semantic_refusal 仍走人审（Commander 明确拒绝不降级）', async () => {
    const profile = parseCommanderProfile({ commanderMode: 'hybrid', payload: {} });
    const latestAttempt = {
      id: 'att-2',
      status: 'failed',
      failure_class: 'semantic_refusal',
      error_code: 'semantic_refusal',
      logical_cycle_id: 'cycle-2',
      provider: profile.commander.primary.provider,
      account: profile.commander.primary.account,
      model: profile.commander.primary.model ?? null,
      machine: profile.commander.primary.machine ?? null,
    };
    const coordinator = makeCoordinator({ latestAttempt, stateStatus: 'active' });
    const result = await coordinator.reconcile(hybridInput());
    expect(result.decision?.action).toBe('wait:human_review');
  });
});
