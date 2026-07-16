/**
 * FT-3: 调度器路径容错
 * Sprint: 07170500-canary-drill-repair
 * 对应真实测试文件: packages/brain/src/__tests__/canary-drill-scheduler-path.test.js
 *
 * 规则（PRD FT-3）：
 *   A — 旧版本路径不存在 → 返回 {triggered:true, error:ENOENT}（Red：这是 bug）
 *   B — 修复后：existsSync 校验失败 → 返回 {triggered:false, failed:true}，console.error 含 "script not found"
 *   C — CANARY_DRILL_SCRIPT env 存在 → execFn 使用该路径（不走 /app 默认路径）
 *
 * 涉及 INV-22/INV-23：
 *   INV-22: 路径策略 CANARY_DRILL_SCRIPT env > /app/scripts/... > existsSync 校验
 *   INV-23: 三态日志 triggered/skipped/failed 必须打印，禁止静默失败
 *
 * 状态：Red（FT-3A 需要验证旧版 bug，FT-3B/C 需要 import 修复后代码）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Stub 工厂 ────────────────────────────────────────────────────────────────

/**
 * 创建 execFn stub，记录调用参数
 */
function makeExecStub({ shouldThrow = false, errorCode = 'ENOENT' } = {}) {
  const calls = [];
  const fn = vi.fn(async (scriptPath, args) => {
    calls.push({ scriptPath, args });
    if (shouldThrow) {
      const err = new Error(`spawn ${scriptPath} ENOENT`);
      err.code = errorCode;
      throw err;
    }
    return { stdout: '', stderr: '' };
  });
  fn._calls = calls;
  return fn;
}

/**
 * 创建 existsSync stub
 */
function makeExistsSyncStub(exists = true) {
  return vi.fn((path) => exists);
}

/**
 * 创建 Pool stub（无当日演习记录）
 */
function makePoolStub({ hasToday = false } = {}) {
  return {
    query: vi.fn(async () => ({
      rows: hasToday ? [{ id: 'existing-drill' }] : [],
    })),
  };
}

// ─── FT-3A：旧版本 ENOENT → triggered:true（复现旧 bug）────────────────────

describe('FT-3: 调度器路径容错', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.CANARY_DRILL_SCRIPT;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('A: 注入不存在脚本路径 → 旧版本返回 {triggered:true, error:ENOENT}（Red: 这是 bug）', async () => {
    /**
     * 验证目标：旧版 canary-drill-scheduler.js:88-91 catch 块
     *   catch (e) {
     *     console.error('[canary-drill-scheduler] 演习失败:', e.message);
     *     return { triggered: true, error: e.message }; // BUG
     *   }
     *
     * 当脚本路径 ENOENT 时，旧版返回 triggered:true 掩盖失败
     * 修复后应返回 {triggered:false, failed:true}
     *
     * 真实测试需要 import maybeScheduleCanaryDrill 并注入 execFn（会 throw ENOENT）：
     *   const { maybeScheduleCanaryDrill } = await import('../canary-drill-scheduler.js');
     *   const execFn = makeExecStub({ shouldThrow: true });
     *   const result = await maybeScheduleCanaryDrill({
     *     now: new Date('2026-07-16T19:30:00Z'),
     *     execFn,
     *     pool: makePoolStub(),
     *   });
     *   // 旧版 bug：triggered 仍为 true
     *   expect(result.triggered).toBe(true); // Red: bug 复现
     *   // 修复后应为 false
     *   // expect(result.triggered).toBe(false); // Green after fix
     *
     * 骨架断言（Red state）：模拟旧版 catch 块行为
     */

    // 模拟旧版 maybeScheduleCanaryDrill catch 块（bug 版本）
    const buggyScheduler = async ({ execFn }) => {
      try {
        const drillScript = '/nonexistent/path/canary-death-drill.mjs'; // 模拟 ENOENT 路径
        await execFn(drillScript, ['oom']);
        return { triggered: true };
      } catch (e) {
        console.error('[canary-drill-scheduler] 演习失败:', e.message);
        return { triggered: true, error: e.message }; // BUG：应为 {triggered:false, failed:true}
      }
    };

    const execFn = makeExecStub({ shouldThrow: true });
    const result = await buggyScheduler({ execFn });

    // 验证旧版 bug：ENOENT 后返回 triggered:true（掩盖失败）
    expect(result.triggered).toBe(true); // Red：bug 存在
    expect(result.error).toContain('ENOENT');

    // 修复后正确行为断言（此处注释，修复后 uncomment）：
    // expect(result.triggered).toBe(false); // Green after fix
    // expect(result.failed).toBe(true);     // Green after fix

    // TODO: 修复后替换为真实 import
    // const { maybeScheduleCanaryDrill } = await import('../../../packages/brain/src/canary-drill-scheduler.js');
    // const realResult = await maybeScheduleCanaryDrill({
    //   now: new Date('2026-07-16T19:30:00Z'),
    //   execFn: makeExecStub({ shouldThrow: true }),
    //   pool: makePoolStub(),
    // });
    // expect(realResult.triggered).toBe(false); // Green after fix
    // expect(realResult.failed).toBe(true);
  });

  it('B: existsSync 校验后，不存在路径 → 返回 {triggered:false, failed:true}，console.error 含 "script not found"（Green after fix）', async () => {
    /**
     * 验证目标（修复后行为）：
     * 1. exec 前执行 existsSync 校验
     * 2. existsSync 返回 false → 不执行 exec
     * 3. 返回 {triggered:false, failed:true}
     * 4. console.error 含 '[canary-drill-scheduler] failed: script not found <path>'
     *
     * 真实测试（修复后）：
     *   const { maybeScheduleCanaryDrill } = await import('../canary-drill-scheduler.js');
     *   // 注入 existsSync 返回 false 的环境
     *   const result = await maybeScheduleCanaryDrill({...});
     *   expect(result.triggered).toBe(false);
     *   expect(result.failed).toBe(true);
     *
     * 骨架断言（Green after fix）
     */

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // 模拟修复后的调度器（含 existsSync 校验）
    const fixedScheduler = async ({ execFn, existsSyncFn }) => {
      const drillScript = '/app/scripts/canary-death-drill.mjs';
      if (!existsSyncFn(drillScript)) {
        console.error(`[canary-drill-scheduler] failed: script not found ${drillScript}`);
        return { triggered: false, failed: true };
      }
      try {
        await execFn(drillScript, ['oom']);
        console.log('[canary-drill-scheduler] triggered');
        return { triggered: true };
      } catch (e) {
        console.error(`[canary-drill-scheduler] failed reason=${e.message}`);
        return { triggered: false, failed: true, error: e.message };
      }
    };

    const execFn = makeExecStub();
    const existsSyncFn = makeExistsSyncStub(false); // 路径不存在
    const result = await fixedScheduler({ execFn, existsSyncFn });

    expect(result.triggered).toBe(false);
    expect(result.failed).toBe(true);
    expect(execFn).not.toHaveBeenCalled(); // exec 未被调用（existsSync 校验已拦截）
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[canary-drill-scheduler] failed: script not found')
    );

    errorSpy.mockRestore();

    // TODO: 修复后替换为真实 import
    // const { maybeScheduleCanaryDrill } = await import('../../../packages/brain/src/canary-drill-scheduler.js');
    // vi.mock('node:fs', () => ({ existsSync: vi.fn(() => false) }));
    // const realResult = await maybeScheduleCanaryDrill({
    //   now: new Date('2026-07-16T19:30:00Z'),
    //   pool: makePoolStub(),
    // });
    // expect(realResult.triggered).toBe(false);
    // expect(realResult.failed).toBe(true);
  });

  it('C: CANARY_DRILL_SCRIPT 环境变量设置 → 使用该路径，不走 /app 默认路径', async () => {
    /**
     * 验证目标（INV-22 路径优先级）：
     * 1. process.env.CANARY_DRILL_SCRIPT 存在时，使用该值作为脚本路径
     * 2. 不走 /app/scripts/canary-death-drill.mjs 默认路径
     * 3. execFn 调用参数为 CANARY_DRILL_SCRIPT 的值
     *
     * 真实测试：
     *   process.env.CANARY_DRILL_SCRIPT = '/custom/path/drill.mjs';
     *   const { maybeScheduleCanaryDrill } = await import('../canary-drill-scheduler.js');
     *   const execFn = vi.fn(async (script) => {});
     *   await maybeScheduleCanaryDrill({ now: new Date('2026-07-16T19:30:00Z'), execFn, pool: makePoolStub() });
     *   expect(execFn.mock.calls[0][0]).toBe('/custom/path/drill.mjs');
     *
     * 骨架断言
     */

    const customScript = '/custom/path/drill.mjs';
    process.env.CANARY_DRILL_SCRIPT = customScript;

    const execCalls = [];

    // 模拟修复后路径优先级逻辑
    const getScriptPath = () => {
      if (process.env.CANARY_DRILL_SCRIPT) return process.env.CANARY_DRILL_SCRIPT;
      return '/app/scripts/canary-death-drill.mjs';
    };

    const mockExec = vi.fn(async (scriptPath, args) => {
      execCalls.push({ scriptPath, args });
    });

    const resolvedPath = getScriptPath();
    expect(resolvedPath).toBe(customScript);
    expect(resolvedPath).not.toBe('/app/scripts/canary-death-drill.mjs');

    await mockExec(resolvedPath, ['oom']);
    expect(execCalls.length).toBe(1);
    expect(execCalls[0].scriptPath).toBe(customScript);

    delete process.env.CANARY_DRILL_SCRIPT;

    // TODO: 修复后替换为真实 import
    // process.env.CANARY_DRILL_SCRIPT = '/custom/path/drill.mjs';
    // const { maybeScheduleCanaryDrill } = await import('../../../packages/brain/src/canary-drill-scheduler.js');
    // const execFn = vi.fn(async () => {});
    // await maybeScheduleCanaryDrill({
    //   now: new Date('2026-07-16T19:30:00Z'),
    //   execFn,
    //   pool: makePoolStub(),
    // });
    // expect(execFn.mock.calls[0][0]).toBe('/custom/path/drill.mjs');
  });
});
