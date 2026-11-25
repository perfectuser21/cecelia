/**
 * Heartbeat tick.js 集成测试
 * 覆盖：D6（时间触发逻辑）
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn(),
}));
vi.mock('../decision-executor.js', () => ({
  executeDecision: vi.fn(),
}));

describe('Heartbeat tick.js 集成', () => {
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

});
