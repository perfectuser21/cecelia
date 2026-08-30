// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：Commander 失联不再静默判死（r83 run 32873c79 案卷）
//
// r83 零人碰跑到 judge PASS + merge gate，最后 20 秒死法：
//   00:19 Commander attempt 因 worker_attempt_replacement_required_after_lease 失败（基础设施类，
//         但错误码不在 COMMANDER_FAILOVER_CODES 白名单）→ failoverFrom 判"不可 failover" →
//         stopForHuman 把 harness_commander_state 永久置 failed——**无决策行、无日志**；
//   此后 7 小时每轮 reconcile 都走 degradeToKernelDecision（continue 默认决策）；
//   07:50 人肉推新 head → humanReviewDeadlinePauseActive 要求 head 全等 → 冻结解除 → deadline
//         早已过期 → 默认决策 MARK_FAILED → "拟判死交 Commander 会诊"日志打了，Commander 已 failed
//         → degrade → failRun。分权翻转在"Commander 失联"这条路上是空的。
//
// 修法：
// a) isFailoverEligible：failure_class ∈ 基础设施类即可 failover（错误码白名单只作补充）；
// b) Commander 状态 failed 后遇拟判死（defaultDecision=mark_failed）先复活一次：重置 ready、
//    新派 Commander（logical_cycle_id=commander-revive:<run>，reasons 含 commander_revive）；
//    复活谱系已存在仍拟判死 → 升人审停表（wait:human_review / commander_unavailable_pre_terminal），
//    不判死；非拟判死场景保持降级 continue；
// c) stopForHuman 落 commander.stopped 决策行（reason_code）——失联必须可见；
// d) humanReviewDeadlinePauseActive：正在等人（decision=wait:human_review 且有开放请求）就停表，
//    不再要求请求行 head 与当前 head 全等（r76 的"stale 人审不停表"让位：等人期间时钟不能杀人）。
//
// 真 import 协调器 / loop（被改的边），deps 注入 fake。
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { createCommanderCoordinator } from '../../../packages/brain/src/orchestrator/commander-coordinator.js';
import { __test__ as loopTest } from '../../../packages/brain/src/orchestrator/loop.js';

const runId = randomUUID();
const commanderAttemptId = randomUUID();
const targets = Object.freeze([
  { role: 'commander', provider: 'codex', account: 'team4', model: 'GPT-5.5', machine: 'us-mac-m4' },
  { role: 'commander', provider: 'claude', account: 'account1', machine: 'us-mac-m4' },
]);

function state(overrides = {}) {
  return {
    run_id: runId, event_cursor: 5, strategy_summary: {}, active_risks: [], latest_guidance: null,
    provider: 'codex', account_id: 'team4', model: 'GPT-5.5', provider_session_id: 'old', ...overrides,
  };
}

function context(overrides = {}) {
  return {
    run: { id: runId, commander_mode: 'hybrid', phase: 'review' },
    commanderMode: 'hybrid',
    runProfile: { commander: { primary: targets[0], fallbacks: targets.slice(1) } },
    objective: { summary: 'r83 复刻' },
    observed: { phase: 'review', run: { id: runId } },
    defaultDecision: { phase: 'review', action: 'wait:human_review', reason: 'awaiting_human_review' },
    historySummary: {},
    budgets: { remaining_attempts: 2, safety_max_hops: 4096 },
    allowedActions: ['continue_default', 'dispatch_role', 'request_human', 'abort_run'],
    ...overrides,
  };
}

const preTerminal = () => context({
  defaultDecision: { phase: 'failed', action: 'mark_failed', reason: 'automation_deadline_exceeded' },
});

function failedInfraAttempt(overrides = {}) {
  return {
    id: commanderAttemptId,
    run_id: runId,
    role: 'commander',
    status: 'failed',
    provider: 'codex',
    account_id: 'team4',
    requested_machine_id: 'us-mac-m4',
    failure_class: 'infrastructure_blocked',
    // r83 真实错误码：不在 COMMANDER_FAILOVER_CODES 白名单
    error_code: 'worker_attempt_replacement_required_after_lease',
    logical_cycle_id: 'commander-wakeup:5',
    attempt_kind: 'initial',
    task_bundle: { inputs: { commander_bundle: { event_cursor: 5 } } },
    result: null,
    ...overrides,
  };
}

function deps(overrides = {}) {
  return {
    commanderStore: {
      ensureRun: vi.fn().mockResolvedValue(state()),
      get: vi.fn().mockResolvedValue(state()),
      updateMemory: vi.fn().mockResolvedValue(state()),
      advanceCursor: vi.fn().mockImplementation(async (_r, { nextCursor }) => state({ event_cursor: nextCursor })),
    },
    eventStore: { list: vi.fn().mockResolvedValue([]), latestCursor: vi.fn().mockResolvedValue(5) },
    actorInbox: { list: vi.fn().mockResolvedValue([]) },
    attemptStore: {
      getLatestCommanderAttempt: vi.fn().mockResolvedValue(null),
      listCommanderFailoverLineage: vi.fn().mockResolvedValue([]),
    },
    appendDecision: vi.fn().mockResolvedValue(undefined),
    nextHop: vi.fn().mockResolvedValue(12),
    now: () => new Date('2026-08-30T07:50:00.000Z'),
    ...overrides,
  };
}

describe('a) 基础设施类失败一律可 failover（错误码白名单只作补充）', () => {
  it('worker_attempt_replacement_required_after_lease（infrastructure_blocked）→ failover 到下一目标，不停机', async () => {
    const d = deps();
    const failed = failedInfraAttempt();
    d.attemptStore.getLatestCommanderAttempt.mockResolvedValue(failed);
    d.attemptStore.listCommanderFailoverLineage.mockResolvedValue([failed]);

    const outcome = await createCommanderCoordinator(d).reconcile(context());

    expect(outcome.kind).toBe('dispatch');
    expect(outcome.context.target).toMatchObject({ provider: 'claude', account: 'account1' });
    expect(d.appendDecision).toHaveBeenCalledWith(expect.objectContaining({ action: 'commander.failover_started' }));
    expect(d.commanderStore.updateMemory).not.toHaveBeenCalledWith(runId, expect.objectContaining({ status: 'failed' }));
  });

  it('负向：semantic_refusal 仍不可 failover → 升人审并落 commander.stopped 行', async () => {
    const d = deps();
    d.attemptStore.getLatestCommanderAttempt.mockResolvedValue(failedInfraAttempt({
      failure_class: 'semantic_refusal', error_code: 'refused',
    }));

    const outcome = await createCommanderCoordinator(d).reconcile(context());

    expect(outcome.kind).toBe('continue');
    expect(outcome.decision.action).toBe('wait:human_review');
    expect(d.appendDecision).toHaveBeenCalledWith(expect.objectContaining({
      action: 'commander.stopped',
      detail: expect.objectContaining({ reason_code: 'commander_semantic_refusal' }),
    }));
  });
});

describe('b) Commander 已 failed 时的拟判死：先复活一次，再升人，绝不静默判死', () => {
  it('状态 failed + 默认 mark_failed + 无复活谱系 → 重置 ready 并新派 Commander（commander_revive）', async () => {
    const d = deps();
    d.commanderStore.get.mockResolvedValue(state({ status: 'failed' }));
    d.attemptStore.getLatestCommanderAttempt.mockResolvedValue(failedInfraAttempt());
    d.attemptStore.listCommanderFailoverLineage.mockImplementation(async (_r, cycle) => (
      cycle === `commander-revive:${runId}` ? [] : [failedInfraAttempt()]
    ));

    const outcome = await createCommanderCoordinator(d).reconcile(preTerminal());

    expect(outcome.kind).toBe('dispatch');
    expect(outcome.context.wakeup_reasons).toContain('commander_revive');
    expect(outcome.context.logical_cycle_id).toBe(`commander-revive:${runId}`);
    expect(d.commanderStore.updateMemory).toHaveBeenCalledWith(runId, expect.objectContaining({ status: 'ready' }));
    expect(d.appendDecision).toHaveBeenCalledWith(expect.objectContaining({ action: 'commander.revived' }));
  });

  it('状态 failed + 默认 mark_failed + 复活谱系已存在 → 升人审停表，不判死', async () => {
    const d = deps();
    d.commanderStore.get.mockResolvedValue(state({ status: 'failed' }));
    d.attemptStore.getLatestCommanderAttempt.mockResolvedValue(failedInfraAttempt({
      logical_cycle_id: `commander-revive:${runId}`, attempt_kind: 'retry',
    }));
    d.attemptStore.listCommanderFailoverLineage.mockResolvedValue([failedInfraAttempt()]);

    const outcome = await createCommanderCoordinator(d).reconcile(preTerminal());

    expect(outcome.kind).toBe('continue');
    expect(outcome.decision).toMatchObject({ phase: 'review', action: 'wait:human_review', reason: 'commander_unavailable_pre_terminal' });
    expect(outcome.decision.action).not.toBe('mark_failed');
  });

  it('负向：状态 failed 但默认决策不是拟判死 → 保持降级 continue（第 29 批语义不动）', async () => {
    const d = deps();
    d.commanderStore.get.mockResolvedValue(state({ status: 'failed' }));
    d.attemptStore.getLatestCommanderAttempt.mockResolvedValue(failedInfraAttempt());

    const outcome = await createCommanderCoordinator(d).reconcile(context({
      defaultDecision: { phase: 'evaluate', action: 'spawn:evaluator', reason: 'no_evaluate_verdict_for_head_sha' },
    }));

    expect(outcome).toMatchObject({ kind: 'continue', degraded: true, decision: { action: 'spawn:evaluator' } });
  });
});

describe('d) 等人期间时钟不杀人：humanReviewDeadlinePauseActive 不再要求 head 全等', () => {
  const sha = 'e'.repeat(40);
  it('请求行 head 与当前 head 不同（人肉 rebase 推新 head）但仍在等人 → 停表', () => {
    expect(loopTest.humanReviewDeadlinePauseActive({
      decisionAction: 'wait:human_review', hasOpenHumanReview: true,
      reviewHeadSha: 'a'.repeat(40), currentHeadSha: sha,
    })).toBe(true);
  });
  it('负向：无开放请求 / 不在等人 / 当前 head 缺失 → 不停表', () => {
    expect(loopTest.humanReviewDeadlinePauseActive({
      decisionAction: 'wait:human_review', hasOpenHumanReview: false, reviewHeadSha: sha, currentHeadSha: sha,
    })).toBe(false);
    expect(loopTest.humanReviewDeadlinePauseActive({
      decisionAction: 'spawn:evaluator', hasOpenHumanReview: true, reviewHeadSha: sha, currentHeadSha: sha,
    })).toBe(false);
    expect(loopTest.humanReviewDeadlinePauseActive({
      decisionAction: 'wait:human_review', hasOpenHumanReview: true, reviewHeadSha: null, currentHeadSha: null,
    })).toBe(false);
  });
});
