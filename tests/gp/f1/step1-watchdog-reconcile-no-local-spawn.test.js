// F1「工厂 · 开发闭环」步骤 1 —— 边：调度器机器不许自己把活接下来干（watchdog reconcile 分支）
//
// ── 事故（2026-09-30，任务 1fe53ce4，决策 d605d3df）──
//
// 步骤 1 的零执行闸只拦在执行器咽喉 spawnSkillRelaySession（见 step1-local-execution-guard），
// 看门狗 harness-relay-watchdog `_recoverKernelRun` 的 reconcile 分支没有闸：kernel-v1 远端派发时
// MMV bridge.prepare 建工作区要 3-4 分钟，这期间 run 无心跳无 attempt；stale 判定
// `if (heartbeatAt && …)` 在心跳为空时被跳过 → 判「无可恢复 session」→ launchKernelProcess 在
// us-vps Brain 容器本地 spawn（cwd=/app 非 git 仓）→ ground-truth `git ls-remote --heads origin`
// 报 'origin' does not appear to be a git repository → kernel_process_fatal；1 分钟后远端正常
// remote-launched 却 singleton_conflict(hops=0) 让位。run 2ba6193a / 17f96547 两例复现，
// 09-23 起同 error_message 8 例，MMV 最后一次真跑的 kernel 日志停在 09-25。铁律 96054a8b。
//
// ── 守卫的边 ──
// ① 远端模式（CECELIA_LOCAL_EXECUTION_ENABLED=false）下 reconcile 绝不本地 spawn，改走既有
//    requeueKernelRunLaunchDeferred 交 executor 下个 tick 走正规远端路径（fleet-worker 对同
//    run_id 重放 prepare 是 409，不能在 watchdog 里重起旧 run）；
// ② 新 run 无心跳无 attempt 且 started_at 在启动宽限内 = launch 在途，不重启。
// 真 import 被改模块 harness-relay-watchdog.js（不 mock 它），只 mock 外部依赖（db / alerting）。
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));
const { mockRaise } = vi.hoisted(() => ({ mockRaise: vi.fn() }));
vi.mock('../../../packages/brain/src/alerting.js', () => ({ raise: mockRaise }));

// 真 import 被改模块 —— 守卫在边上，不 mock 它
import { resumeStalledRelayRuns } from '../../../packages/brain/src/harness-relay-watchdog.js';
import { createAttemptStore } from '../../../packages/brain/src/orchestrator/attempt-store.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = 'aaaabbbb-cccc-dddd-eeee-ffff00003333';

function makeDeps({ startedAt, latestAttempt }) {
  const pool = { query: vi.fn() };
  pool.query.mockImplementation(async (sql) => {
    if (/FROM initiative_runs r(?:\s|$)/.test(sql)) {
      return {
        rows: [{
          id: RUN_ID, initiative_id: TASK_ID, current_task_id: TASK_ID, phase: 'planning', attempts: '1',
          deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: null,
          orchestrator_host: 'kernel-v1', orchestrator_heartbeat_at: null, started_at: startedAt,
          controller_session_id: '33333333-3333-4333-8333-333333333333', controller_generation: '1',
        }],
      };
    }
    if (/FROM tasks/.test(sql)) {
      return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', payload: { orchestrator: 'skill-relay', harness_runtime: 'kernel-v1' } }] };
    }
    if (/FROM harness_attempts/.test(sql)) {
      return { rows: latestAttempt ? [latestAttempt] : [] };
    }
    return { rows: [] };
  });
  return {
    pool,
    attemptStore: createAttemptStore(pool, { queryOnlyTestAdapter: true }),
    execFn: vi.fn(() => ''),
    spawnFn: vi.fn(),
    resumeAttempt: vi.fn(),
    launchKernel: vi.fn(async () => ({ pid: 4242 })),
    requeueKernelRunDeferred: vi.fn(async () => ({ changed: true, deferCount: 1 })),
  };
}

const FAILED_ATTEMPT = {
  id: '22222222-2222-4222-8222-222222222222', run_id: RUN_ID, role: 'planner', provider: 'claude',
  provider_session_id: null, status: 'failed', lease_expires_at: null,
};

describe('F1 step1 — watchdog reconcile 不许在调度器本地起 kernel（任务 1fe53ce4）', () => {
  it('零执行闸开着：无可恢复 session 时不 launchKernel，改 requeue 交 executor 远端重派', async () => {
    const deps = makeDeps({ startedAt: new Date(Date.now() - 30 * 60_000).toISOString(), latestAttempt: FAILED_ATTEMPT });
    deps.env = { CECELIA_LOCAL_EXECUTION_ENABLED: 'false' };

    await resumeStalledRelayRuns(deps);

    expect(deps.launchKernel).not.toHaveBeenCalled();
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(deps.requeueKernelRunDeferred).toHaveBeenCalledOnce();
    expect(deps.requeueKernelRunDeferred).toHaveBeenCalledWith(
      deps.pool,
      expect.objectContaining({ runId: RUN_ID, expectedTaskId: TASK_ID }),
    );
  });

  it('新 run 无心跳无 attempt、started_at 在启动宽限内（远端 prepare 在途）：什么都不做', async () => {
    const deps = makeDeps({ startedAt: new Date(Date.now() - 2 * 60_000).toISOString(), latestAttempt: null });

    const result = await resumeStalledRelayRuns(deps);

    expect(deps.launchKernel).not.toHaveBeenCalled();
    expect(deps.requeueKernelRunDeferred).not.toHaveBeenCalled();
    expect(result.resumed).toBe(0);
  });

  it('本地模式（闸未开）行为零变化：宽限外无可恢复 session 仍本地重启 reconcile', async () => {
    const deps = makeDeps({ startedAt: new Date(Date.now() - 30 * 60_000).toISOString(), latestAttempt: FAILED_ATTEMPT });
    deps.env = {};

    await resumeStalledRelayRuns(deps);

    expect(deps.launchKernel).toHaveBeenCalledOnce();
    expect(deps.requeueKernelRunDeferred).not.toHaveBeenCalled();
  });
});
