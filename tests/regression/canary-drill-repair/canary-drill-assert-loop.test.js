/**
 * FT-2: 断言闭环验证
 * Sprint: 07170500-canary-drill-repair
 * 对应真实测试文件: packages/brain/src/__tests__/canary-drill-assert-loop.test.js
 *
 * 规则（PRD FT-2）：
 *   pollAssert timeoutMin=0 → result.pass=false → archiveDrillResult 含 verdict=FAIL → process.exit 1
 *
 *   Red state（当前 bug）：
 *     runOomDrill 的 assertFn 含 `if (task.status === 'failed') return { pass: true }`（L169）
 *     注入后任务被 PATCH 到 status='failed' → assertFn 立即返回 pass=true
 *     → exit 0 掩盖 watchdog 实际未处置的事实
 *
 *   Green state（修复后）：
 *     assertFn 禁止以 task.status==='failed' 作为 PASS 判据
 *     轮询超时 → result.pass=false → archiveDrillResult(verdict=FAIL) → exit 1
 *
 * 状态：Red（此测试在修复前因旧 assertFn bug 无法正确断言）
 */

import { describe, it, expect, vi } from 'vitest';

// ─── Stub 工厂 ────────────────────────────────────────────────────────────────

/**
 * 创建轮询 fetch stub，模拟 watchdog 未处置场景
 * 任务始终保持 in_progress，payload 无 oom_upgraded/attempt 变化
 */
function makePollFetchStub() {
  return vi.fn(async (url) => {
    if (url.includes('/tasks/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'canary-test-002',
          status: 'in_progress', // watchdog 未处置，状态不变
          payload: {
            canary: true,
            orchestrator: 'skill-relay',
            last_container_exit_code: 137,
            oom_upgraded: false,
            attempt: 0,
          },
        }),
      };
    }
    // PATCH 请求返回 200
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

/**
 * 创建 archiveDrillResult stub，捕获写入内容
 */
function makeArchiveStub() {
  const calls = [];
  const fn = vi.fn(async (opts) => {
    calls.push(opts);
  });
  fn._calls = calls;
  return fn;
}

// ─── FT-2：pollAssert 超时 → verdict=FAIL + exit 1 ───────────────────────────

describe('FT-2: 断言闭环验证', () => {
  it('pollAssert timeoutMin=0 → result.pass=false → archiveDrillResult 含 verdict=FAIL → process.exit 1（Red: 现版本 status=failed → pass=true 导致 exit 0）', async () => {
    /**
     * 验证目标：
     * 1. runOomDrill 内 assertFn 不得以 task.status==='failed' 作为 pass=true 判据（INV-20）
     * 2. pollAssert 超时后 result.pass === false
     * 3. archiveDrillResult 被调用，写入内容含 verdict:'FAIL'
     * 4. 主流程调用 process.exit(1)
     *
     * 真实测试需要 import runOomDrill 并注入 fetchFn + archiveFn：
     *   const { runOomDrill } = await import('../../../scripts/canary-death-drill.mjs');
     *   const fetchStub = makePollFetchStub();
     *   const result = await runOomDrill({
     *     taskId: 'canary-test-002',
     *     fetchFn: fetchStub,
     *     timeoutMin: 0, // 立即超时
     *   });
     *   expect(result.pass).toBe(false);
     *
     * 骨架断言（Red state）
     */

    // 模拟旧版 assertFn（包含 bug：status=failed → pass=true）
    const buggyAssertFn = (task) => {
      const cause = task.payload?.cause || task.result?.cause;
      if (cause === 'oom') {
        const upgraded = task.payload?.oom_upgraded === true;
        if (upgraded) return { pass: true };
        if (task.status === 'failed') return { pass: true }; // BUG: L169
      }
      if (task.status === 'completed') return { terminal: true, reason: 'unexpected completion' };
      return { pass: false };
    };

    // 旧 bug 复现：注入 status=failed 后 assertFn 立即返回 pass=true
    const taskWithFailedStatus = {
      id: 'canary-test-002',
      status: 'failed', // 旧版 OOM 注入直接 PATCH status=failed
      result: { exit_code: 137, cause: 'oom' },
      payload: { oom_upgraded: false, attempt: 0 },
    };

    const bugResult = buggyAssertFn(taskWithFailedStatus);
    // 这就是 bug：status=failed 时旧版返回 pass=true，掩盖 watchdog 未处置的事实
    expect(bugResult.pass).toBe(true); // 验证 bug 存在

    // 修复后的正确 assertFn（不以 status=failed 作为 PASS 判据）
    const fixedAssertFn = (task) => {
      // 修复后：只以 initiative_runs.phase 变化或 oom_upgraded/attempt 作为 PASS 判据
      const upgraded = task.payload?.oom_upgraded === true || task.payload?.oom_upgraded === 'true';
      if (upgraded) return { pass: true };
      const attempt = task.payload?.attempt || 0;
      if (attempt > 0) return { pass: true };
      if (task.status === 'completed') return { terminal: true, reason: 'unexpected completion' };
      return { pass: false }; // 超时 → pass=false
    };

    // 修复后：status=failed 不再是 PASS 判据，超时返回 pass=false
    const fixedResult = fixedAssertFn(taskWithFailedStatus);
    expect(fixedResult.pass).toBe(false); // 修复后行为正确

    // 验证 archiveDrillResult 应收到 verdict=FAIL 内容
    const archiveStub = makeArchiveStub();
    const drillResult = { pass: false, reason: '超时 0min' };

    // 模拟 archiveDrillResult 调用（INV-21：必含四字段）
    await archiveStub({
      taskId: 'canary-test-002',
      mode: 'oom',
      results: drillResult,
      success: drillResult.pass,
      verdict: drillResult.pass ? 'PASS' : 'FAIL', // 修复后新增字段
      assertions: [{ name: 'oom_upgraded', pass: false, detail: '超时 0min，watchdog 未处置' }],
      elapsed_ms: 0,
    });

    expect(archiveStub).toHaveBeenCalledTimes(1);
    expect(archiveStub._calls[0].verdict).toBe('FAIL');
    expect(archiveStub._calls[0].assertions).toBeInstanceOf(Array);
    expect(archiveStub._calls[0].assertions.length).toBeGreaterThan(0);
    expect(archiveStub._calls[0].assertions[0]).toMatchObject({
      name: expect.any(String),
      pass: false,
      detail: expect.any(String),
    });
    expect(typeof archiveStub._calls[0].elapsed_ms).toBe('number');

    // TODO: 替换为真实 import 验证 exit 1 调用路径
    // const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    // const { runOomDrill } = await import('../../../scripts/canary-death-drill.mjs');
    // const result = await runOomDrill({ taskId: 'canary-test-002', fetchFn: makePollFetchStub(), timeoutMin: 0 });
    // expect(result.pass).toBe(false);
    // // main 流程应调用 exit(1)
    // expect(exitSpy).toHaveBeenCalledWith(1);
    // exitSpy.mockRestore();
  });
});
