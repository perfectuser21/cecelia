// F1「工厂 · 开发闭环」步骤 1「接单进车间即分档」—— 边：编排槽满排队的 run 不算失败
//
// ── 事故（2026-10-07 盘点）──
// 跑场机槽满（bridge 429 orchestrator_slots_exhausted）时，requeueKernelRunLaunchDeferred 把 run 置
// phase='failed'（清理触发器依赖 phase IN ('done','failed')，不能改）、任务回 queued 等下个 tick 重建新 run。
// 成功率统计（stats?by=journey / 战报 / warroom 健康度 / relay-runs SLO）直接 COUNT 这些 run：
// 近 60 天 275 条排队 run 被当失败，一个任务占 227 条，盘点误报 81% 失败率。
//
// ── 守卫的边 ──
// 统计口径靠 failure_reason 前缀识别"排队"，所以「生成 reason 的两个流水线模块」与「识别 reason 的口径」
// 必须咬合：
// ① harness-skill-relay 远程点火遇 429 → 传给 requeue 的 reason 被判"排队"；延后用尽回落 finalize 的
//    reason 是真实失败，判"非排队"；
// ② harness-relay-watchdog reconcile 回队的 reason 判"排队"，`:defers_exhausted` 终态判"非排队"；
// ③ SQL 判定（launchDeferredSql）与 JS 判定（isLaunchDeferredReason）对同一组样本结论一致。
// 真 import 被改模块 harness-skill-relay.js / harness-relay-watchdog.js（不 mock 它们），
// 只注入假 pool / 假 bridge，并 mock 外部依赖（db / alerting / runtime-safety）。
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../packages/brain/src/runtime-safety.js', () => ({ assertExternalExecutionAllowed: () => {} }));
vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));
const { mockRaise } = vi.hoisted(() => ({ mockRaise: vi.fn() }));
vi.mock('../../../packages/brain/src/alerting.js', () => ({ raise: mockRaise }));

// 真 import 被改模块 —— 守卫在边上，不 mock 它们
import { spawnSkillRelaySession } from '../../../packages/brain/src/harness-skill-relay.js';
import { resumeStalledRelayRuns } from '../../../packages/brain/src/harness-relay-watchdog.js';
import { createAttemptStore } from '../../../packages/brain/src/orchestrator/attempt-store.js';
import {
  isLaunchDeferredReason,
  launchDeferredSql,
} from '../../../packages/brain/src/lib/kernel-launch-deferral.js';

const TASK_ID = '55555555-5555-4555-8555-555555555555';
const RUN_ID = '66666666-6666-4666-8666-666666666666';

// ── ① skill-relay ────────────────────────────────────────────────────────────
function kernelTask() {
  return {
    id: TASK_ID,
    title: 'remote kernel task',
    payload: { harness_runtime: 'kernel-v1', base_repo: 'https://github.com/perfectuser21/cecelia.git' },
  };
}

function relayDeps(overrides = {}) {
  return {
    env: { CECELIA_LOCAL_EXECUTION_ENABLED: 'false' },
    pool: { query: vi.fn(async () => ({ rows: [] })) },
    now: () => new Date('2026-10-07T00:00:00Z'),
    createKernelRun: vi.fn(async () => ({
      created: true,
      run: { id: RUN_ID, controller_session_id: '77777777-7777-4777-8777-777777777777', controller_generation: 1 },
    })),
    finalizeRun: vi.fn(async () => ({ changed: true })),
    requeueKernelRunDeferred: vi.fn(async () => ({ changed: true, deferCount: 1 })),
    orchestratorBridge: {
      targetMachineId: 'primary-under-test',
      prepare: vi.fn(async () => { throw new Error('orchestrator_bridge_prepare_http_429:orchestrator_slots_exhausted'); }),
      start: vi.fn(async () => ({ pid: 999, host: 'primary-under-test', status: 'running' })),
    },
    ...overrides,
  };
}

// ── ② watchdog ───────────────────────────────────────────────────────────────
const WD_RUN_ID = '11111111-1111-4111-8111-111111111111';
const WD_TASK_ID = 'aaaabbbb-cccc-dddd-eeee-ffff00003333';
const FAILED_ATTEMPT = {
  id: '22222222-2222-4222-8222-222222222222', run_id: WD_RUN_ID, role: 'planner', provider: 'claude',
  provider_session_id: null, status: 'failed', lease_expires_at: null,
};

function watchdogDeps(requeueResult) {
  const pool = { query: vi.fn() };
  pool.query.mockImplementation(async (sql) => {
    if (/FROM initiative_runs r(?:\s|$)/.test(sql)) {
      return {
        rows: [{
          id: WD_RUN_ID, initiative_id: WD_TASK_ID, current_task_id: WD_TASK_ID, phase: 'planning', attempts: '1',
          deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: null,
          orchestrator_host: 'kernel-v1', orchestrator_heartbeat_at: null,
          started_at: new Date(Date.now() - 30 * 60_000).toISOString(),
          controller_session_id: '33333333-3333-4333-8333-333333333333', controller_generation: '1',
        }],
      };
    }
    if (/FROM tasks/.test(sql)) {
      return { rows: [{ id: WD_TASK_ID, status: 'in_progress', title: 't', payload: { orchestrator: 'skill-relay', harness_runtime: 'kernel-v1' } }] };
    }
    if (/FROM harness_attempts/.test(sql)) return { rows: [FAILED_ATTEMPT] };
    return { rows: [] };
  });
  return {
    pool,
    env: { CECELIA_LOCAL_EXECUTION_ENABLED: 'false' },
    attemptStore: createAttemptStore(pool, { queryOnlyTestAdapter: true }),
    execFn: vi.fn(() => ''),
    spawnFn: vi.fn(),
    resumeAttempt: vi.fn(),
    launchKernel: vi.fn(async () => ({ pid: 4242 })),
    requeueKernelRunDeferred: vi.fn(async () => requeueResult),
    finalizeRun: vi.fn(async () => ({ ok: true })),
  };
}

// ── ③ 共用样本表：SQL 判定与 JS 判定必须同结论 ───────────────────────────────
const SAMPLES = [
  [null, false],
  ['', false],
  ['kernel_remote_launch_deferred:orchestrator_bridge_prepare_http_429:orchestrator_slots_exhausted', true],
  ['kernel_remote_launch_deferred:orchestrator_bridge_start_request_failed:The operation was aborted', true],
  ['kernel_reconcile_remote_requeue:no_resumable_session', true],
  ['kernel_reconcile_remote_requeue:no_resumable_session:defers_exhausted', false],
  ['kernel_remote_launch_failed:orchestrator_bridge_prepare_http_400', false],
  ['boom', false],
];

// launchDeferredSql 的 JS 等价物：从生成的 SQL 文本里抽前缀/后缀，逐字翻译
//（IS NOT NULL / starts_with / right(col, N) <> suffix）
function sqlSemantics(reason) {
  const sql = launchDeferredSql('ir');
  const prefixes = [...sql.matchAll(/starts_with\(ir\.failure_reason, '([^']+)'\)/g)].map((m) => m[1]);
  const [, len, suffix] = sql.match(/right\(ir\.failure_reason, (\d+)\) <> '([^']+)'/);
  if (reason == null) return false;
  return prefixes.some((p) => reason.startsWith(p)) && reason.slice(-Number(len)) !== suffix;
}

describe('F1 step1 · 编排槽满排队的 run 不计入失败率', () => {
  it('skill-relay 远程点火遇 429：交给 requeue 的 reason 被统计口径判为排队', async () => {
    const deps = relayDeps();
    const result = await spawnSkillRelaySession(kernelTask(), deps);
    expect(result).toMatchObject({ ok: false, deferred: true, reason: 'orchestrator_busy' });
    expect(deps.finalizeRun).not.toHaveBeenCalled();
    const { reason } = deps.requeueKernelRunDeferred.mock.calls[0][1];
    expect(reason).toContain('orchestrator_slots_exhausted');
    expect(isLaunchDeferredReason(reason)).toBe(true);
  });

  it('skill-relay 延后用尽回落终态：finalize 的 reason 是真实失败，不判排队', async () => {
    const deps = relayDeps({
      requeueKernelRunDeferred: vi.fn(async () => ({ changed: false, exhausted: true, deferCount: 300 })),
    });
    const result = await spawnSkillRelaySession(kernelTask(), deps);
    expect(result).toMatchObject({ ok: false, terminalized: true });
    const { reason } = deps.finalizeRun.mock.calls[0][1];
    expect(isLaunchDeferredReason(reason)).toBe(false);
  });

  it('watchdog reconcile 回队：requeue 的 reason 判排队', async () => {
    const deps = watchdogDeps({ changed: true, deferCount: 1 });
    await resumeStalledRelayRuns(deps);
    expect(deps.launchKernel).not.toHaveBeenCalled();
    const { reason } = deps.requeueKernelRunDeferred.mock.calls[0][1];
    expect(isLaunchDeferredReason(reason)).toBe(true);
  });

  it('watchdog 回队用尽：finalize 的 :defers_exhausted 终态 reason 判非排队', async () => {
    const deps = watchdogDeps({ changed: false, exhausted: true, deferCount: 300 });
    await resumeStalledRelayRuns(deps);
    const { reason } = deps.finalizeRun.mock.calls[0][1];
    expect(reason).toMatch(/:defers_exhausted$/);
    expect(isLaunchDeferredReason(reason)).toBe(false);
  });

  it.each(SAMPLES)('SQL 判定与 JS 判定同结论：%j → %s', (reason, expected) => {
    expect(isLaunchDeferredReason(reason)).toBe(expected);
    expect(sqlSemantics(reason)).toBe(expected);
  });
});
