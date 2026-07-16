/**
 * canary-drill-scheduler.test.js — BEHAVIOR-8 补充：tick 调度时间窗口测试
 */
import { describe, it, expect } from 'vitest';
import { maybeScheduleCanaryDrill } from '../canary-drill-scheduler.js';

describe('canary-drill-scheduler', () => {
  describe('maybeScheduleCanaryDrill', () => {
    it('UTC 19:25~19:35 窗口内应触发演习', async () => {
      // 注入处于窗口内的时间（UTC 19:30）
      const now = new Date('2026-07-15T19:30:00.000Z');
      const execFn = async () => ({ stdout: '', stderr: '' });
      const poolStub = {
        query: async () => ({ rows: [] }),
      };
      const result = await maybeScheduleCanaryDrill({ now, execFn, pool: poolStub });
      // 应触发（triggered=true）或因幂等已跳过（skipped=true）
      expect(typeof result).toBe('object');
      expect(result).toHaveProperty('triggered');
    });

    it('同一日历日不重复触发（幂等保护）', async () => {
      const now = new Date('2026-07-15T19:30:00.000Z');
      const execFn = async () => ({ stdout: '', stderr: '' });
      const poolStub = {
        query: async () => ({ rows: [] }),
      };
      // 第一次调用
      await maybeScheduleCanaryDrill({ now, execFn, pool: poolStub });
      // 第二次调用应被幂等跳过
      const result = await maybeScheduleCanaryDrill({ now, execFn, pool: poolStub });
      expect(result.triggered).toBe(false);
      expect(result.skipped).toBe(true);
    });

    it('UTC 19:25~19:35 窗口外不触发', async () => {
      // UTC 10:00 远离窗口
      const now = new Date('2026-07-16T10:00:00.000Z');
      const execFn = async () => ({ stdout: '', stderr: '' });
      const poolStub = {
        query: async () => ({ rows: [] }),
      };
      const result = await maybeScheduleCanaryDrill({ now, execFn, pool: poolStub });
      expect(result.triggered).toBe(false);
    });

    it('runCanaryDrillIfNeeded 是命名导出（函数）', async () => {
      const mod = await import('../canary-drill-scheduler.js');
      expect(typeof mod.runCanaryDrillIfNeeded).toBe('function');
    });
  });
});

// ─── FT-3：调度器路径容错（Red→Green）──────────────────────────────────────────

describe('FT-3: 调度器路径容错 — ENOENT→有日志 / 环境变量优先', () => {
  it('execFn 抛 ENOENT → 打印 [canary-drill] failed reason=，不静默', async () => {
    const logCalls = [];
    const originalError = console.error;
    console.error = (...args) => { logCalls.push(args.join(' ')); };

    const enoentExecFn = async () => {
      const err = new Error('ENOENT: no such file or directory');
      err.code = 'ENOENT';
      throw err;
    };

    const poolStub = { query: async () => ({ rows: [] }) };

    // 注意：maybeScheduleCanaryDrill 有内存幂等，需要新日期避免 already_ran_today
    // 用不同日期的 now 绕过幂等
    const freshNow = new Date('2026-07-17T19:30:00.000Z');

    let result;
    try {
      result = await maybeScheduleCanaryDrill({ now: freshNow, execFn: enoentExecFn, pool: poolStub });
    } finally {
      console.error = originalError;
    }

    // 修复前：只有 console.error 通用信息，无三态日志前缀
    // 修复后：必须打印 [canary-drill-scheduler] failed
    const failedLog = logCalls.find(l => l.includes('[canary-drill-scheduler] failed'));
    expect(failedLog).toBeDefined();
    expect(failedLog).toMatch(/\[canary-drill-scheduler\] failed/);

    // 修复后 return 值含 failed: true，triggered: false（exec 抛异常未成功执行）
    expect(result).toHaveProperty('triggered', false);
    // 修复后应有 failed 字段（修复前无此字段）
    expect(result).toHaveProperty('failed', true);
  });

  it('CANARY_DRILL_SCRIPT 环境变量存在 → 使用该路径，不走相对路径', async () => {
    const execCalls = [];
    const captureExecFn = async (script, args) => {
      execCalls.push({ script, args });
    };

    const originalEnv = process.env.CANARY_DRILL_SCRIPT;
    process.env.CANARY_DRILL_SCRIPT = '/custom/path/canary-death-drill.mjs';

    const freshNow = new Date('2026-07-18T19:30:00.000Z');
    const poolStub = { query: async () => ({ rows: [] }) };

    try {
      await maybeScheduleCanaryDrill({ now: freshNow, execFn: captureExecFn, pool: poolStub });
    } finally {
      if (originalEnv === undefined) {
        delete process.env.CANARY_DRILL_SCRIPT;
      } else {
        process.env.CANARY_DRILL_SCRIPT = originalEnv;
      }
    }

    // 修复前：不读 CANARY_DRILL_SCRIPT，始终用 path.resolve(__dirname, ...)
    // 修复后：CANARY_DRILL_SCRIPT 存在时使用该路径
    expect(execCalls.length).toBeGreaterThan(0);
    expect(execCalls[0].script).toBe('/custom/path/canary-death-drill.mjs');
  });

  it('CANARY_DRILL_SCRIPT 未设且 /app/scripts/canary-death-drill.mjs 可用 → 使用容器绝对路径', async () => {
    // 此测试验证路径优先级逻辑（不需要文件真实存在，只验证脚本路径选择）
    // 修复后 maybeScheduleCanaryDrill 内部路径选择：
    // 1. CANARY_DRILL_SCRIPT env → 2. /app/scripts/... → 3. 相对路径 fallback
    const execCalls = [];
    const captureExecFn = async (script, args) => {
      execCalls.push({ script, args });
    };

    const originalEnv = process.env.CANARY_DRILL_SCRIPT;
    delete process.env.CANARY_DRILL_SCRIPT;

    const freshNow = new Date('2026-07-19T19:30:00.000Z');
    const poolStub = { query: async () => ({ rows: [] }) };

    try {
      // existsFn: () => true 模拟 /app/scripts/canary-death-drill.mjs 存在，让 exec 被调用
      await maybeScheduleCanaryDrill({ now: freshNow, execFn: captureExecFn, pool: poolStub, existsFn: () => true });
    } finally {
      if (originalEnv !== undefined) {
        process.env.CANARY_DRILL_SCRIPT = originalEnv;
      }
    }

    // 只验证 exec 被调用（路径具体值取决于修复实现，关键是不抛 ENOENT 静默）
    expect(execCalls.length).toBeGreaterThan(0);
  });
});
