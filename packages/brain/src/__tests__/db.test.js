import { describe, it, expect } from 'vitest';
import pool, { getPoolHealth } from '../db.js';

// 配对测试（lint-test-pairing）：db.js 诊断日志改走 stderr 后，验证 pool 契约与
// 健康指标读数仍成立（不建真实连接——getPoolHealth 只读 pg.Pool 计数器）。
describe('db pool', () => {
  it('default export is a usable pg pool', () => {
    expect(pool).toBeTruthy();
    expect(typeof pool.query).toBe('function');
    expect(typeof pool.connect).toBe('function');
  });

  it('getPoolHealth returns numeric pool metrics', () => {
    const h = getPoolHealth();
    expect(h).toHaveProperty('total');
    expect(h).toHaveProperty('idle');
    expect(h).toHaveProperty('waiting');
    expect(h).toHaveProperty('activeCount');
    for (const k of ['total', 'idle', 'waiting', 'activeCount']) {
      expect(typeof h[k]).toBe('number');
    }
    // activeCount = total - idle 恒等式
    expect(h.activeCount).toBe(h.total - h.idle);
  });
});
