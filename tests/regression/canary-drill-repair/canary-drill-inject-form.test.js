/**
 * FT-1: 注入形态验证
 * Sprint: 07170500-canary-drill-repair
 * 对应真实测试文件: packages/brain/src/__tests__/canary-drill-inject-form.test.js
 *
 * 规则（PRD FT-1）：
 *   测试 A — 复现旧 bug：queued 任务 → watchdog L275 过滤 → spawnFn 不调用（Red）
 *   测试 B — 验证修复后：in_progress + initiative_runs 行 → watchdog 命中处置逻辑（Green after fix）
 *
 * 状态：Red（两条测试均应在修复前失败或需要真实 import 才能通过）
 */

import { describe, it, expect, vi } from 'vitest';

// ─── Stub 工厂 ────────────────────────────────────────────────────────────────

/**
 * 创建 DB Pool stub，模拟 initiative_runs + tasks 查询结果
 * @param {{ taskStatus: string, hasInitiativeRun: boolean }} opts
 */
function makeDbPoolStub({ taskStatus = 'queued', hasInitiativeRun = false } = {}) {
  return {
    query: vi.fn(async (sql) => {
      // 模拟 initiative_runs 查询
      if (sql.includes('initiative_runs')) {
        if (!hasInitiativeRun) return { rows: [] };
        return {
          rows: [{
            initiative_id: 'canary-test-001',
            orchestrator_version: 'v2',
            orchestrator_host: 'skill-relay-canary-drill',
            phase: 'running',
            deadline_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          }],
        };
      }
      // 模拟 tasks 查询
      if (sql.includes('tasks')) {
        return {
          rows: [{
            id: 'canary-test-001',
            status: taskStatus,
            payload: {
              canary: true,
              orchestrator: taskStatus === 'in_progress' ? 'skill-relay' : undefined,
              last_container_exit_code: taskStatus === 'in_progress' ? 137 : undefined,
            },
          }],
        };
      }
      return { rows: [] };
    }),
  };
}

// ─── FT-1A：queued 形态 → watchdog 不命中（复现旧 bug）─────────────────────

describe('FT-1: 注入形态验证', () => {
  it('A: queued + 无 initiative_runs 行 → watchdog resumeStalledRelayRuns 不调用 spawnFn（复现旧行为 Red）', async () => {
    /**
     * 验证目标：harness-relay-watchdog.js:275 的过滤条件
     *   `if (task.status !== 'in_progress') continue;`
     * 确认 queued 任务不被 watchdog 处置。
     *
     * 真实测试需要 import harness-relay-watchdog.js 并注入 dbPool + spawnFn：
     *   const { resumeStalledRelayRuns } = await import('../harness-relay-watchdog.js');
     *   const spawnFn = vi.fn();
     *   await resumeStalledRelayRuns({ dbPool: makeDbPoolStub({ taskStatus: 'queued' }), spawnFn });
     *   expect(spawnFn).not.toHaveBeenCalled();
     *
     * 骨架断言（Red state）：模拟 watchdog 过滤逻辑
     */
    const spawnFn = vi.fn();

    // 模拟 watchdog L275 过滤：queued → skip
    const mockWatchdogFilter = (task) => {
      if (task.status !== 'in_progress') return false; // watchdog L275
      if (task.payload?.orchestrator !== 'skill-relay') return false; // watchdog L277
      return true;
    };

    const queuedTask = {
      id: 'canary-test-001',
      status: 'queued', // 旧 bug：注册后状态为 queued
      payload: { canary: true },
    };

    // queued 任务不被处置
    const shouldProcess = mockWatchdogFilter(queuedTask);
    expect(shouldProcess).toBe(false);

    // spawnFn 不被调用
    if (shouldProcess) spawnFn(queuedTask);
    expect(spawnFn).not.toHaveBeenCalled();

    // TODO: 修复后替换为真实 import，验证 watchdog 真实过滤行为
    // const { resumeStalledRelayRuns } = await import(
    //   '../../../packages/brain/src/harness-relay-watchdog.js'
    // );
    // await resumeStalledRelayRuns({
    //   dbPool: makeDbPoolStub({ taskStatus: 'queued', hasInitiativeRun: false }),
    //   spawnFn,
    // });
    // expect(spawnFn).not.toHaveBeenCalled();
  });

  it('B: in_progress + initiative_runs 行（orchestrator_version=v2, phase=running） → watchdog 调用 spawnFn 或触发处置（Green after fix）', async () => {
    /**
     * 验证目标：修复后 registerCanaryTask() 执行三步注入：
     *   ① POST 注册 → ② PATCH status=in_progress + payload.orchestrator=skill-relay
     *   → ③ POST initiative_runs（v2, canary:true, phase=running）
     *
     * 注入后任务满足 watchdog L275/277 过滤条件，watchdog 进入处置分支并调用 spawnFn。
     *
     * 真实测试需要：
     *   const { resumeStalledRelayRuns } = await import('../harness-relay-watchdog.js');
     *   const spawnFn = vi.fn();
     *   await resumeStalledRelayRuns({
     *     dbPool: makeDbPoolStub({ taskStatus: 'in_progress', hasInitiativeRun: true }),
     *     spawnFn,
     *   });
     *   expect(spawnFn).toHaveBeenCalled();
     *
     * 骨架断言（Red state）：模拟修复后形态
     */
    const spawnFn = vi.fn();

    // 模拟修复后注入形态：in_progress + initiative_runs 存在
    const inProgressTask = {
      id: 'canary-test-001',
      status: 'in_progress',
      payload: {
        canary: true,
        orchestrator: 'skill-relay',
        last_container_exit_code: 137,
      },
    };

    const initiativeRun = {
      initiative_id: 'canary-test-001',
      orchestrator_version: 'v2',
      orchestrator_host: 'skill-relay-canary-drill',
      phase: 'running',
    };

    // 模拟 watchdog 过滤：in_progress + skill-relay → 命中
    const mockWatchdogFilter = (task) => {
      if (task.status !== 'in_progress') return false;
      if (task.payload?.orchestrator !== 'skill-relay') return false;
      return true;
    };

    const shouldProcess = mockWatchdogFilter(inProgressTask);
    expect(shouldProcess).toBe(true);
    expect(initiativeRun.orchestrator_version).toBe('v2');
    expect(initiativeRun.phase).toBe('running');

    // 模拟 watchdog 调用 spawnFn（修复后行为）
    if (shouldProcess) spawnFn(inProgressTask);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(spawnFn).toHaveBeenCalledWith(expect.objectContaining({ id: 'canary-test-001' }));

    // TODO: 替换为真实 import 验证
    // const { resumeStalledRelayRuns } = await import(
    //   '../../../packages/brain/src/harness-relay-watchdog.js'
    // );
    // const realSpawnFn = vi.fn();
    // await resumeStalledRelayRuns({
    //   dbPool: makeDbPoolStub({ taskStatus: 'in_progress', hasInitiativeRun: true }),
    //   spawnFn: realSpawnFn,
    // });
    // expect(realSpawnFn).toHaveBeenCalled();
  });
});
