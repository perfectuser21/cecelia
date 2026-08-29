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
import { runLoop, __test__ as loopTest } from '../../../packages/brain/src/orchestrator/loop.js';
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
const RUN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TASK_ID = '11111111-2222-3333-4444-555555555555';
const CONTRACT_ID = '99999999-8888-7777-6666-555555555555';
const IDENTITY = Object.freeze({
  contract_id: CONTRACT_ID,
  manifest_sha256: 'a'.repeat(64),
  source_revision: 'b'.repeat(40),
});
const NOW = new Date('2026-07-04T12:00:00Z');

function obs(overrides = {}) {
  return {
    run: { id: RUN_ID, phase: 'generate', cost_usd: 0 },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true, id: CONTRACT_ID, identity: IDENTITY },
    pr: null,
    inflight: { containers: [], host_pids: [] },
    lastAgentExit: { code: null, auth_failed: false },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: false,
    evaluateVerdict: null,
    judgeVerdict: null,
    reviewRequired: false,
    reviewApproved: false,
    decisionLog: [],
    authCircuit: [],
    callbackResult: null,
    ...overrides,
  };
}

function makeEnv({ observedSeq }) {
  let i = 0;
  let hopCounter = 0;
  let observedMaxHop = 0;
  const appended = [];
  const persistedRows = [];
  const sleeps = [];
  const deps = {
    pool: {
      query: vi.fn(async (sql) => {
        if (sql.includes('SELECT run.initiative_id, run.current_task_id')) {
          return { rows: [{ initiative_id: TASK_ID, current_task_id: TASK_ID }] };
        }
        return { rows: [] };
      }),
    },
    collectGroundTruth: vi.fn(async () => {
      const value = observedSeq[Math.min(i, observedSeq.length - 1)];
      i++;
      const decisionLog = [...(value.decisionLog ?? []), ...persistedRows];
      observedMaxHop = decisionLog.reduce((max, row) => Math.max(max, Number(row.hop) || 0), 0);
      return { ...value, decisionLog };
    }),
    // loop 的 stale-observation 护栏要求 DB next hop 紧接 observed max hop
    nextHop: vi.fn(async () => { hopCounter = Math.max(hopCounter, observedMaxHop) + 1; return hopCounter; }),
    appendHop: vi.fn(async (entry) => {
      appended.push(entry);
      persistedRows.push({
        hop: entry.hop,
        action: entry.action,
        observed: entry.observed,
        gate_verdict: entry.gateVerdict,
        detail: entry.detail,
        created_at: NOW.toISOString(),
      });
    }),
    writeHeartbeat: vi.fn(async () => {}),
    dispatch: vi.fn(async () => ({ status: 'DONE', detail: 'human review requested: preview' })),
    impactGate: {
      beforeGenerate: vi.fn(async () => ({ gate: 'pass', stage: 'structure' })),
      beforeEvaluate: vi.fn(async () => ({ gate: 'pass', stage: 'diff' })),
      beforeMerge: vi.fn(async () => ({ gate: 'pass', stage: 'merge' })),
    },
    finalizeRun: vi.fn(async () => ({ changed: true, outcome: 'failed', runId: RUN_ID, taskId: TASK_ID })),
    runEventStore: { append: vi.fn(async () => ({ cursor: 99 })) },
    sleep: vi.fn(async (ms) => { sleeps.push(ms); }),
    now: () => NOW,
    host: 'test-host',
    pid: 4242,
    log: vi.fn(),
  };
  return { deps, appended, sleeps };
}

const pr = { url: 'u', state: 'OPEN', ci: 'pass', merged: false, head_sha: 'sha-review' };
const passVerdicts = {
  evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-review', contract_identity: IDENTITY },
  judgeVerdict: { verdict: 'PASS', pr_head_sha: 'sha-review', contract_identity: IDENTITY },
};
const requestedRow = (hop, createdAt = NOW.toISOString()) => ({
  hop,
  action: LOG_ACTION.HUMAN_REVIEW_REQUESTED,
  observed: { pr: { head_sha: 'sha-review' } },
  detail: null,
  created_at: createdAt,
});
const decidedRow = (hop, requestHop) => ({
  hop,
  action: LOG_ACTION.VERDICT_HUMAN_REVIEW,
  observed: { pr: { head_sha: 'sha-review' } },
  detail: { verdict: 'APPROVED', approved: true, pr_head_sha: 'sha-review', review_request_hop: requestHop },
  created_at: NOW.toISOString(),
});

describe('③ loop：人审去重只认未裁决的请求', () => {
  it('同 SHA 旧请求已有 verdict:human_review 指回 → 视为新一轮，重新派发通知并落新请求行', async () => {
    const decided = obs({
      generatorSpawned: true, pr, reviewRequired: true, ...passVerdicts,
      decisionLog: [requestedRow(2), decidedRow(3, 2)],
    });
    const { deps, appended } = makeEnv({
      observedSeq: [decided, obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } })],
    });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    expect(deps.dispatch).toHaveBeenCalledWith('wait:human_review', expect.any(Object));
    expect(appended.map((entry) => entry.action)).toEqual([
      'wait:human_review',
      LOG_ACTION.HUMAN_REVIEW_REQUESTED,
    ]);
  });

  it('负向：同 SHA 旧请求尚未裁决 → 仍只心跳等待，不重复通知（原去重语义保住）', async () => {
    const pending = obs({
      generatorSpawned: true, pr, reviewRequired: true, ...passVerdicts,
      decisionLog: [requestedRow(2)],
    });
    const { deps, appended, sleeps } = makeEnv({
      observedSeq: [pending, obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } })],
    });

    await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(appended).toHaveLength(0);
    expect(sleeps).toHaveLength(1);
  });

  it('纯函数：humanReviewRequestDecided 只认 review_request_hop 指回该请求行的裁决', () => {
    const { humanReviewRequestDecided } = loopTest;
    expect(humanReviewRequestDecided([requestedRow(2), decidedRow(3, 2)], 2)).toBe(true);
    expect(humanReviewRequestDecided([requestedRow(2), decidedRow(3, 1)], 2)).toBe(false);
    expect(humanReviewRequestDecided([requestedRow(2)], 2)).toBe(false);
  });
});

describe('④ loop：静默等待 ≥15 分钟必须落行 + 发事件唤醒 Commander', () => {
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

  it('人审等待 20 分钟无行 → 落 result:wait_stalled 行、发 run.wait_stalled 事件，再落行后计时归零', async () => {
    const pending = obs({
      generatorSpawned: true, pr, reviewRequired: true, ...passVerdicts,
      decisionLog: [requestedRow(2, twentyMinAgo)],
    });
    const { deps, appended } = makeEnv({
      observedSeq: [pending, pending, obs({ run: { id: RUN_ID, phase: 'done', cost_usd: 0 } })],
    });

    const result = await runLoop(deps, { taskId: TASK_ID, runId: RUN_ID });

    expect(result.exitReason).toBe('run_done');
    const stallRows = appended.filter((entry) => entry.action === LOG_ACTION.WAIT_STALLED);
    expect(stallRows).toHaveLength(1);
    expect(stallRows[0].detail).toMatchObject({
      last_hop: 2,
      last_action: LOG_ACTION.HUMAN_REVIEW_REQUESTED,
      idle_minutes: 20,
    });
    expect(deps.runEventStore.append).toHaveBeenCalledWith(expect.objectContaining({
      runId: RUN_ID,
      eventType: 'run.wait_stalled',
    }));
    expect(deps.dispatch).not.toHaveBeenCalled();
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
