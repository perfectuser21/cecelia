
// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：静默等待活锁（r80 run 5100560e 案卷）
//
// 真相（08-30 复盘，推翻"控制循环半死"的初判）：hop 206 Commander 提案（dispatch_role
// reviewer）落行后，控制循环每 90s 照常迭代、照常续租，却 4h39m 一行不写、一人不通知：
//   ① 协调器：提案的 bundle 游标(354) < 状态游标(361) → 走 dispatchFor；状态游标之后
//      没有新 material 事件 → wake=false → continue 默认决策。提案被**静默丢弃**，无行。
//      游标落后的根因：stale 拒绝后的替换派发用 material 事件的最大游标建 bundle，而状态
//      游标推进到**全部**事件的最大游标——最后一个事件非 material 时，替换提案天生滞后，
//      每次都被丢弃 → 确定性活锁发生器。
//   ② loop：默认决策 wait:human_review，去重逻辑按 SHA+reason 命中 hop 182 的旧请求——
//      该请求早在 hop 183 被批准并消费（184 spawn:evaluator）。已裁决的请求仍挡住新请求，
//      不再通知任何人。
//   ③ 所有纯等待分支只心跳不落行、无上限：监工/看门狗/Commander 三层全瞎。
//
// 修法：
// a) commander-bundle：buildCommanderBundle 接受显式 eventCursor（不得落后于事件）；
//    协调器 stale 替换派发把 nextCursor 传进去，bundle 游标与状态游标对齐；
// b) 协调器：完成的提案若 bundle 游标滞后，拉 bundle 游标之后的真实事件判 material——
//    无 material → 照常裁决（control），有 → 既有 stale 拒绝+替换路径；
// c) loop：人审去重只认**未裁决**的请求行（已有 verdict:human_review 指回该 hop 的不算）；
// d) loop：决策日志 ≥15 分钟无新行 → 落 result:wait_stalled 行 + 发 run.wait_stalled
//    事件（material，唤醒 Commander）+ P1 告警；15 分钟一拍，停摆永远可见。
//
// 真 import 协调器/loop/bundle/wakeup/silent-wait（被改的边），deps 注入 fake。
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { createCommanderCoordinator } from '../../../packages/brain/src/orchestrator/commander-coordinator.js';
import { buildCommanderBundle } from '../../../packages/brain/src/orchestrator/commander-bundle.js';
import { classifyCommanderWakeup } from '../../../packages/brain/src/orchestrator/commander-wakeup.js';

import {
  detectSilentWaitStall,
  SILENT_WAIT_STALL_MS,
} from '../../../packages/brain/src/orchestrator/silent-wait.js';
import { LOG_ACTION } from '../../../packages/brain/src/orchestrator/constants.js';

const runId = randomUUID();
const commanderAttemptId = randomUUID();

// ---------- 协调器 fake（与 __tests__/commander-coordinator.test.js 同形） ----------
const targets = Object.freeze([
  { role: 'commander', provider: 'codex', account: 'team4', model: 'GPT-5.5', machine: 'us-mac-m4' },
  { role: 'commander', provider: 'claude', account: 'account1', machine: 'us-mac-m4' },
]);

function event(cursor, eventType, overrides = {}) {
  return {
    run_id: runId,
    cursor,
    event_type: eventType,
    source_type: 'initiative_run',
    source_id: runId,
    source_version: cursor,
    payload: {},
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    run_id: runId,
    event_cursor: 5,
    strategy_summary: {},
    active_risks: [],
    latest_guidance: null,
    provider: 'codex',
    account_id: 'team4',
    model: 'GPT-5.5',
    provider_session_id: 'old-session',
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    run: { id: runId, commander_mode: 'hybrid', phase: 'review' },
    commanderMode: 'hybrid',
    runProfile: { commander: { primary: targets[0], fallbacks: targets.slice(1) } },
    objective: { summary: 'r80 复刻' },
    observed: { phase: 'review', run: { id: runId } },
    defaultDecision: { phase: 'review', action: 'wait:human_review', reason: 'evidence_insufficient_after_recollect' },
    historySummary: {},
    budgets: { remaining_attempts: 2, safety_max_hops: 4096 },
    allowedActions: ['continue_default', 'dispatch_role'],
    ...overrides,
  };
}

function completedDirectiveAttempt(bundleCursor) {
  return {
    id: commanderAttemptId,
    run_id: runId,
    role: 'commander',
    status: 'completed',
    task_bundle: { inputs: { commander_bundle: { event_cursor: bundleCursor } } },
    result: {
      status: 'completed',
      decision: {
        schema: 'commander-directive/v1',
        run_id: runId,
        event_cursor: bundleCursor,
        action: 'dispatch_role',
        target_role: 'reviewer',
        reason: '证据不足，派 reviewer 基于真实检查产物判定',
        evidence_refs: [`event:${bundleCursor}`],
      },
    },
  };
}

function coordinatorDeps(overrides = {}) {
  return {
    commanderStore: {
      ensureRun: vi.fn().mockResolvedValue(state()),
      get: vi.fn().mockResolvedValue(state()),
      updateMemory: vi.fn().mockResolvedValue(state()),
      advanceCursor: vi.fn().mockImplementation(
        async (_runId, { nextCursor }) => state({ event_cursor: nextCursor }),
      ),
    },
    eventStore: {
      list: vi.fn().mockResolvedValue([]),
      latestCursor: vi.fn().mockResolvedValue(5),
    },
    actorInbox: { list: vi.fn().mockResolvedValue([]) },
    attemptStore: {
      getLatestCommanderAttempt: vi.fn().mockResolvedValue(null),
      listCommanderFailoverLineage: vi.fn().mockResolvedValue([]),
    },
    appendDecision: vi.fn().mockResolvedValue(undefined),
    nextHop: vi.fn().mockResolvedValue(12),
    now: () => new Date('2026-08-29T04:10:00.000Z'),
    ...overrides,
  };
}

describe('① 协调器：r80 复刻——stale 拒绝后的替换提案完成时必须被裁决，不再静默丢弃', () => {
  const replacementAttemptId = randomUUID();
  const evaluatorDone = event(6, 'attempt.completed', {
    source_type: 'harness_attempt', source_id: randomUUID(), payload: { role: 'evaluator' },
  });
  // 非 material 尾巴（r80：状态游标被推到这里，而修前替换 bundle 停在 6）
  const evaluatorHeartbeat = event(7, 'attempt.heartbeat', {
    source_type: 'harness_attempt', source_id: evaluatorDone.source_id, payload: { role: 'evaluator' },
  });

  it('第一轮：旧提案 stale 拒绝 → 派替换；第二轮：替换提案完成 → kind=control（修前 continue 丢弃）', async () => {
    const deps = coordinatorDeps();
    // 第一轮：状态 5，旧提案 bundle 5，5 之后有 material（evaluator 完成）+ 非 material 尾巴
    deps.attemptStore.getLatestCommanderAttempt.mockResolvedValueOnce(completedDirectiveAttempt(5));
    deps.eventStore.list.mockResolvedValueOnce([evaluatorDone, evaluatorHeartbeat]);
    const coordinator = createCommanderCoordinator(deps);

    const first = await coordinator.reconcile(context());
    expect(first.kind).toBe('dispatch');
    expect(deps.appendDecision).toHaveBeenCalledWith(expect.objectContaining({
      action: 'commander.directive_rejected',
      detail: expect.objectContaining({ reason_code: 'stale_event_cursor' }),
    }));
    const replacementCursor = first.context.bundle.event_cursor;
    expect(deps.commanderStore.advanceCursor).toHaveBeenCalledWith(runId, expect.objectContaining({
      nextCursor: replacementCursor,
    }));

    // 第二轮：状态已推进到 7；替换提案带着自己的 bundle 游标完成；7 之后只有它自己的生命周期
    deps.commanderStore.get.mockResolvedValue(state({ event_cursor: 7 }));
    deps.attemptStore.getLatestCommanderAttempt.mockResolvedValueOnce({
      ...completedDirectiveAttempt(replacementCursor),
      id: replacementAttemptId,
    });
    deps.eventStore.list.mockResolvedValueOnce([
      event(8, 'attempt.completed', {
        source_type: 'harness_attempt', source_id: replacementAttemptId, payload: { role: 'commander' },
      }),
    ]);

    const second = await coordinator.reconcile(context());
    expect(second.kind).toBe('control');
    expect(second.decision).toMatchObject({ action: 'dispatch_role', target_role: 'reviewer' });
    expect(second.attempt_id).toBe(replacementAttemptId);
  });

  it('负向：已裁决消费（状态游标 > bundle 游标）的提案不再重复裁决，无新 material 事件 → continue', async () => {
    const deps = coordinatorDeps();
    deps.commanderStore.get.mockResolvedValue(state({ event_cursor: 8 }));
    deps.attemptStore.getLatestCommanderAttempt.mockResolvedValue(completedDirectiveAttempt(7));
    deps.eventStore.list.mockResolvedValue([]);

    const outcome = await createCommanderCoordinator(deps).reconcile(context());

    expect(outcome).toEqual({ kind: 'continue', decision: context().defaultDecision });
    expect(deps.appendDecision).not.toHaveBeenCalled();
  });
});

describe('② 替换派发的 bundle 游标与状态游标对齐（活锁发生器拆除）', () => {
  it('stale 拒绝后替换 bundle.event_cursor = 全部新事件最大游标，即使尾巴事件非 material', async () => {
    const deps = coordinatorDeps();
    deps.attemptStore.getLatestCommanderAttempt.mockResolvedValue(completedDirectiveAttempt(5));
    deps.eventStore.list.mockResolvedValue([
      event(6, 'attempt.completed', {
        source_type: 'harness_attempt', source_id: randomUUID(), payload: { role: 'evaluator' },
      }),
      // 非 material 尾巴：修前替换 bundle 游标停在 6，状态游标推到 7 → 下一轮提案天生滞后
      event(7, 'attempt.heartbeat', {
        source_type: 'harness_attempt', source_id: randomUUID(), payload: { role: 'evaluator' },
      }),
    ]);

    const outcome = await createCommanderCoordinator(deps).reconcile(context());

    expect(outcome.kind).toBe('dispatch');
    expect(outcome.context.bundle.event_cursor).toBe(7);
    expect(deps.commanderStore.advanceCursor).toHaveBeenCalledWith(runId, expect.objectContaining({
      nextCursor: 7,
    }));
  });

  it('buildCommanderBundle 显式 eventCursor 不得落后于事件（防止把 bundle 倒拨回去）', () => {
    const base = {
      runId,
      commanderAttemptId,
      state: state(),
      runProfile: {},
      objective: {},
      observed: {},
      historySummary: {},
      newEvents: [event(6, 'attempt.completed')],
      actorMessages: [],
      activeRisks: [],
      budgets: {},
      allowedActions: ['continue_default'],
    };
    expect(buildCommanderBundle({ ...base, eventCursor: 9 }).event_cursor).toBe(9);
    expect(() => buildCommanderBundle({ ...base, eventCursor: 5 }))
      .toThrow('commander_bundle_cursor_behind_events');
  });
});

// ---------- loop fake（与 __tests__/loop.test.js makeEnv 同形，精简） ----------

const NOW = new Date('2026-07-04T12:00:00Z');

const requestedRow = (hop, createdAt = NOW.toISOString()) => ({
  hop,
  action: LOG_ACTION.HUMAN_REVIEW_REQUESTED,
  observed: { pr: { head_sha: 'sha-review' } },
  detail: null,
  created_at: createdAt,
});

describe('④ 静默等待观测与 Commander 唤醒', () => {
  const twentyMinAgo = new Date(NOW.getTime() - 20 * 60 * 1000).toISOString();

  it('detectSilentWaitStall：无行/无 created_at/新行 → 不停摆；最后一行 ≥ 阈值 → 停摆带 last_hop/last_action', () => {
    expect(detectSilentWaitStall({ decisionLog: [], now: NOW }).stalled).toBe(false);
    expect(detectSilentWaitStall({ decisionLog: [{ hop: 1, action: 'x' }], now: NOW }).stalled).toBe(false);
    expect(detectSilentWaitStall({ decisionLog: [requestedRow(2)], now: NOW }).stalled).toBe(false);
    const stall = detectSilentWaitStall({
      decisionLog: [requestedRow(2, twentyMinAgo), { hop: 1, action: 'spawn:judge', created_at: twentyMinAgo }],
      now: NOW,
    });
    expect(stall).toMatchObject({ stalled: true, last_hop: 2, last_action: LOG_ACTION.HUMAN_REVIEW_REQUESTED });
    expect(stall.idle_ms).toBeGreaterThanOrEqual(SILENT_WAIT_STALL_MS);
  });

  it('run.wait_stalled 是 material 事件：唤醒 Commander，理由 wait_stalled', () => {
    const wakeup = classifyCommanderWakeup({
      runId,
      stateCursor: 5,
      events: [event(6, 'run.wait_stalled')],
      defaultDecision: { phase: 'review', action: 'wait:human_review' },
    });
    expect(wakeup.wake).toBe(true);
    expect(wakeup.reasons).toContain('wait_stalled');
  });
});
