// F1「工厂 · 开发闭环」步骤 3 —— 闸开着（CECELIA_LOCAL_EXECUTION_ENABLED=false）时，
// kernel-v1 headless 派发不能再一刀切拒绝，必须改道 orchestrator-remote-bridge 把执行
// 权交给远端 primary worker（决策 e3a41ecc：闸语义="禁本机起，放行远程"）。
//
// 真 import 被改模块 harness-skill-relay.js（lint-gp-anchor-artifact 要求），不 mock 它；
// 只通过 deps.orchestratorBridge 注入桥的假实现。

import { describe, it, expect, vi } from 'vitest';
import { spawnSkillRelaySession } from '../../../packages/brain/src/harness-skill-relay.js';

const TASK_ID = '55555555-5555-4555-8555-555555555555';
const RUN_ID = '66666666-6666-4666-8666-666666666666';

function kernelTask() {
  return {
    id: TASK_ID,
    title: 'remote kernel task',
    payload: { harness_runtime: 'kernel-v1', base_repo: 'https://github.com/perfectuser21/cecelia.git' },
  };
}

function fakeDeps(bridgeCalls) {
  return {
    env: { CECELIA_LOCAL_EXECUTION_ENABLED: 'false' },
    pool: { query: vi.fn(async () => ({ rows: [] })) },
    now: () => new Date('2026-09-13T00:00:00Z'),
    createKernelRun: vi.fn(async () => ({
      created: true,
      run: { id: RUN_ID, controller_session_id: '77777777-7777-4777-8777-777777777777', controller_generation: 1 },
    })),
    finalizeRun: vi.fn(async () => {}),
    orchestratorBridge: {
      targetMachineId: 'primary-under-test',
      prepare: vi.fn(async (input) => { bridgeCalls.push(['prepare', input]); return { worktree_path: '/ws/r', status: 'prepared' }; }),
      start: vi.fn(async (input) => { bridgeCalls.push(['start', input]); return { pid: 999, host: 'primary-under-test', status: 'running' }; }),
    },
  };
}

describe('GP F1 step3 — orchestrator 远程派发', () => {
  it('闸=false + kernel-v1 headless → 经桥 prepare+start，不本机 spawn', async () => {
    const bridgeCalls = [];
    const result = await spawnSkillRelaySession(kernelTask(), fakeDeps(bridgeCalls));
    expect(result.ok).toBe(true);
    expect(result.remote).toBe(true);
    expect(result.pid).toBe(999);
    expect(bridgeCalls.map(([op]) => op)).toEqual(['prepare', 'start']);
    expect(bridgeCalls[1][1]).toMatchObject({ run_id: RUN_ID, controller_generation: 1 });
  });

  it('createdSource 必须落在 kernel-run-store 白名单（用既有枚举 kernel_dispatch）', async () => {
    // 回归锁（2026-09-13 生产实锤）：kernel_dispatch_remote 不在 CREATED_SOURCES
    // 白名单（JS + migration 430 DB CHECK 双层）→ createKernelRun 抛 invalid
    // created source → dispatch_fail_autoblock 3 连击把任务打 blocked。
    // mock createRun 挡不住白名单层——用入参断言锁死。
    const bridgeCalls = [];
    const deps = fakeDeps(bridgeCalls);
    await spawnSkillRelaySession(kernelTask(), deps);
    expect(deps.createKernelRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ createdSource: 'kernel_dispatch' }),
    );
  });

  it('闸=false + 远程 prepare 永久失败 → run finalize failed 且错误透传（禁静默）', async () => {
    const bridgeCalls = [];
    const deps = fakeDeps(bridgeCalls);
    deps.orchestratorBridge.prepare = vi.fn(async () => { throw new Error('orchestrator_bridge_prepare_http_400:orchestrator_task_id_invalid'); });
    const result = await spawnSkillRelaySession(kernelTask(), deps);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('orchestrator_bridge_prepare_http_400');
    // terminalized:true 与本机版 _spawnKernelRuntime 失败返回逐字段同构——executor.js:3243
    // 靠这个字段把动作归为 'terminalized' 并走 reconcileTerminalizedKernelAuthority 核验；
    // 缺了会落进 executor.js:3639 的 else 分支打出误导性 error 日志并跳过终态核验。
    expect(result.terminalized).toBe(true);
    expect(deps.finalizeRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ outcome: 'failed' }));
  });

  // 2026-09-24 实证（任务 281aa798）：MMV 2 个槽位其一被泄漏的 prepared 作业恒占，prepare 持续
  // 429；Brain 把 429 当永久失败 terminalized，一天 6 条刀被判死。跑场机忙 = 瞬时，必须 deferred。
  it('闸=false + 远程 prepare 429（跑场机忙）→ deferred：任务回 queued 等下个 tick，不 terminalized', async () => {
    const bridgeCalls = [];
    const deps = fakeDeps(bridgeCalls);
    deps.orchestratorBridge.prepare = vi.fn(async () => { throw new Error('orchestrator_bridge_prepare_http_429:orchestrator_slots_exhausted'); });
    deps.requeueKernelRunDeferred = vi.fn(async () => ({ changed: true, deferCount: 1 }));
    const result = await spawnSkillRelaySession(kernelTask(), deps);
    expect(result).toMatchObject({ ok: false, mode: 'kernel-v1', runId: RUN_ID, deferred: true, reason: 'orchestrator_busy' });
    expect(result.terminalized).toBeUndefined();
    expect(deps.requeueKernelRunDeferred).toHaveBeenCalledWith(deps.pool, expect.objectContaining({
      runId: RUN_ID,
      expectedTaskId: TASK_ID,
      reason: expect.stringContaining('orchestrator_slots_exhausted'),
    }));
    expect(deps.finalizeRun).not.toHaveBeenCalled();
  });

  it('闸=false + 非 kernel 路径 → 仍拒绝（错误码不变）', async () => {
    const result = await spawnSkillRelaySession(
      { id: TASK_ID, payload: {} },
      { env: { CECELIA_LOCAL_EXECUTION_ENABLED: 'false' } },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('local_execution_disabled_on_scheduler');
  });
});
