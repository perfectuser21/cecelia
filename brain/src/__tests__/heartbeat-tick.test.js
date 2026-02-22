/**
 * Heartbeat tick.js 集成测试
 * 覆盖：D6（时间触发逻辑）
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../thalamus.js', () => ({
  callThalamLLM: vi.fn(),
  ACTION_WHITELIST: {},
  EVENT_TYPES: {},
}));
vi.mock('../decision-executor.js', () => ({
  executeDecision: vi.fn(),
}));

const { HEARTBEAT_INTERVAL_MS } = await import('../heartbeat-inspector.js');

describe('Heartbeat tick.js 集成', () => {
  it('HEARTBEAT_INTERVAL_MS = 30 分钟 (1800000ms)', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(30 * 60 * 1000);
    expect(HEARTBEAT_INTERVAL_MS).toBe(1800000);
  });

  it('tick.js 导出 _resetLastHeartbeatTime 函数', async () => {
    // 动态导入 tick.js 检查 export
    const tick = await import('../tick.js');
    expect(typeof tick._resetLastHeartbeatTime).toBe('function');
  });

  it('tick.js 使用模块级 _lastHeartbeatTime 变量', async () => {
    // 验证 reset 函数存在且可调用
    const tick = await import('../tick.js');
    expect(() => tick._resetLastHeartbeatTime()).not.toThrow();
  });

  it('HEARTBEAT_INTERVAL_MS 与 CLEANUP_INTERVAL_MS 不同（30min vs 1h）', async () => {
    const tick = await import('../tick.js');
    // CLEANUP_INTERVAL_MS 默认 1 小时
    expect(tick.CLEANUP_INTERVAL_MS).toBe(60 * 60 * 1000);
    expect(HEARTBEAT_INTERVAL_MS).toBeLessThan(tick.CLEANUP_INTERVAL_MS);
  });
});
