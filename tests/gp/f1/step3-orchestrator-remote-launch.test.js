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

  it('闸=false + 远程 prepare 失败 → run finalize failed 且错误透传（禁静默）', async () => {
    const bridgeCalls = [];
    const deps = fakeDeps(bridgeCalls);
    deps.orchestratorBridge.prepare = vi.fn(async () => { throw new Error('orchestrator_bridge_prepare_http_429:orchestrator_slots_exhausted'); });
    const result = await spawnSkillRelaySession(kernelTask(), deps);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('orchestrator_bridge_prepare_http_429');
    expect(deps.finalizeRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ outcome: 'failed' }));
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
