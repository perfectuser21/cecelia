/**
 * FT-3: 调度器路径容错
 * Red 阶段 — 验证 canary-drill-scheduler.js 路径解析 bug 及修复后三态日志
 *
 * Bug-3（现状）：
 *   - L69: path.resolve(__dirname, '../../../scripts/canary-death-drill.mjs')
 *     容器内 __dirname 不是宿主路径，相对三级跳后 ENOENT
 *   - L84-92 catch 块返回 {triggered:true, error:...}，静默失败
 *
 * 修复后（INV-22/INV-23）：
 *   - 路径优先 CANARY_DRILL_SCRIPT env → /app/scripts/canary-death-drill.mjs
 *   - exec 前 existsSync 校验
 *   - 失败返回 {triggered:false, failed:true}
 *   - 三态日志必打印
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { maybeScheduleCanaryDrill } from '../canary-drill-scheduler.js';

// 固定时间窗口（UTC 19:30 在窗口内）
const IN_WINDOW_DATE = new Date('2026-07-17T19:30:00.000Z');

function makePoolStub() {
  return {
    query: vi.fn(async () => ({ rows: [] })),
  };
}

describe('FT-3: 调度器路径容错', () => {
  let origEnv;

  beforeEach(() => {
    origEnv = { ...process.env };
    // 重置幂等状态（每次测试使用不同日期避免幂等干扰）
    delete process.env.CANARY_DRILL_SCRIPT;
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it('A: 注入不存在脚本路径 → 现版本返回 {triggered:true, error:ENOENT}（Red: 这是 bug）', async () => {
    // 使用不同的日期避免幂等
    const now = new Date('2026-07-11T19:30:00.000Z');
    const pool = makePoolStub();

    // execFn 模拟脚本不存在（throw ENOENT）
    const execFn = vi.fn(async () => {
      const err = new Error('spawn /nonexistent ENOENT');
      err.code = 'ENOENT';
      throw err;
    });

    const result = await maybeScheduleCanaryDrill({ now, execFn, pool });

    // Red 阶段验证：现版本 catch 块返回 {triggered:true, error:...}，这是 bug
    // 期望值：triggered 不应该为 true（修复后应为 false）
    // 此 expect 验证旧 bug：现版本会 triggered=true
    expect(result.triggered).toBe(true); // Red: 旧 bug，修复后此断言应改为 false
    expect(result.error).toBeDefined();   // catch 块有 error 字段
  });

  it('B: existsSync 校验后，不存在路径 → 返回 {triggered:false, failed:true}，console.error 含 script not found（Green after fix）', async () => {
    const now = new Date('2026-07-12T19:30:00.000Z');
    const pool = makePoolStub();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // execFn 不应被调用（existsSync 失败前就返回）
    const execFn = vi.fn(async () => {
      throw new Error('should not be called if existsSync check works');
    });

    // 修复后：调度器 existsSync 校验路径不存在 → 不调 execFn，返回 {triggered:false, failed:true}
    // Red 阶段：此测试失败，因为现版本没有 existsSync 校验，会直接调 execFn 然后 catch
    const result = await maybeScheduleCanaryDrill({ now, execFn, pool });

    // 修复后期望：
    expect(result.triggered).toBe(false);  // Red: 现版本返回 true
    expect(result.failed).toBe(true);       // Red: 现版本无 failed 字段
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[canary-drill-scheduler] failed')
    ); // Red: 现版本打 console.error 但内容不同

    errorSpy.mockRestore();
  });

  it('C: CANARY_DRILL_SCRIPT 环境变量设置 → execFn 调用参数为该路径', async () => {
    const now = new Date('2026-07-13T19:30:00.000Z');
    const pool = makePoolStub();
    const customPath = '/custom/path/drill.mjs';
    process.env.CANARY_DRILL_SCRIPT = customPath;

    const execCalls = [];
    const execFn = vi.fn(async (script, args) => {
      execCalls.push({ script, args });
    });

    // 修复后：优先使用 CANARY_DRILL_SCRIPT env 变量路径
    // Red 阶段：现版本使用 path.resolve(__dirname, '../../../scripts/...') 忽略环境变量
    await maybeScheduleCanaryDrill({ now, execFn, pool });

    // 修复后期望：execFn 被调用且第一个参数为 customPath
    expect(execFn).toHaveBeenCalled(); // Red: 现版本可能调用但参数不同
    expect(execCalls[0]?.script).toBe(customPath); // Red: 现版本不使用 env 变量
  });
});
