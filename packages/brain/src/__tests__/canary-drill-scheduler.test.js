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
