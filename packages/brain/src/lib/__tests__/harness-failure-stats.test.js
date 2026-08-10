/**
 * harness-failure-stats.test.js — failure-stats 纯计量逻辑 brain-unit 配对测试。
 * 无 DB / 无 mock：真函数真断言。DB 聚合真值另由 sprint 合同测试 + real-env-smoke 用真 Postgres 验。
 */
import { describe, it, expect } from 'vitest';
import { parseFailureStatsDays, buildFailureStats } from '../harness-failure-stats.js';

describe('parseFailureStatsDays', () => {
  it('缺省 → 7', () => {
    expect(parseFailureStatsDays(undefined)).toEqual({ days: 7 });
  });
  it('合法整数字符串 → 数值', () => {
    expect(parseFailureStatsDays('7')).toEqual({ days: 7 });
    expect(parseFailureStatsDays('365')).toEqual({ days: 365 });
    expect(parseFailureStatsDays('1')).toEqual({ days: 1 });
  });
  it('非整数 / 越界 → error', () => {
    expect(parseFailureStatsDays('abc').error).toMatch(/integer/);
    expect(parseFailureStatsDays('0').error).toMatch(/integer/);
    expect(parseFailureStatsDays('-5').error).toMatch(/integer/);
    expect(parseFailureStatsDays('366').error).toMatch(/integer/);
    expect(parseFailureStatsDays('1.5').error).toMatch(/integer/);
  });
});

describe('buildFailureStats', () => {
  it('空窗口 → failure_rate 0、by_class {}、不除零', () => {
    const s = buildFailureStats(7, 0, []);
    expect(s).toEqual({
      window_days: 7,
      total_tasks: 0,
      terminal_failed_count: 0,
      failure_rate: 0,
      by_class: {},
    });
  });

  it('分组求和恒等 terminal_failed_count（无双重计数）+ 失败率两位小数', () => {
    const s = buildFailureStats(7, 12, [
      { failure_class: 'watchdog_deadline', cnt: '3' },
      { failure_class: 'unclassified', cnt: 2 },
    ]);
    expect(s.window_days).toBe(7);
    expect(s.total_tasks).toBe(12);
    expect(s.terminal_failed_count).toBe(5);
    expect(s.by_class).toEqual({ watchdog_deadline: 3, unclassified: 2 });
    const sum = Object.values(s.by_class).reduce((a, b) => a + b, 0);
    expect(sum).toBe(s.terminal_failed_count);
    expect(s.failure_rate).toBe(0.42); // 5/12 = 0.4166… → 0.42
    expect(typeof s.failure_rate).toBe('number');
  });

  it('全失败 → failure_rate = 1；分母字符串也能解析', () => {
    const s = buildFailureStats(1, '2', [{ failure_class: 'product_failure', cnt: 2 }]);
    expect(s.failure_rate).toBe(1);
    expect(s.total_tasks).toBe(2);
  });
});
