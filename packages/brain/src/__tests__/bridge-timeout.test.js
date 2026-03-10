/**
 * Bridge 超时降级测试
 * 验证：bridge 超时 → degraded 响应 → llm-caller 正确处理
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../model-profile.js', () => ({
  getActiveProfile: vi.fn(() => ({
    id: 'test',
    config: {
      cortex: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    },
  })),
}));

vi.mock('../account-usage.js', () => ({
  selectBestAccount: vi.fn(async () => ({ accountId: 'account1' })),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => JSON.stringify({ api_key: 'test-key' })),
}));

vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

describe('Bridge timeout degraded response', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    const { getActiveProfile } = await import('../model-profile.js');
    getActiveProfile.mockReturnValue({
      id: 'test',
      config: {
        cortex: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      },
    });
  });

  it('应该在 bridge 返回 degraded=true 时抛出包含 "timed out" 的错误', async () => {
    const degradedResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        ok: false,
        status: 'timeout',
        degraded: true,
        message: 'LLM call timed out',
        elapsed_ms: 120000,
      }),
      text: async () => '{}',
    };
    global.fetch = vi.fn().mockResolvedValueOnce(degradedResponse);

    const { callLLM } = await import('../llm-caller.js');
    await expect(callLLM('cortex', 'test prompt')).rejects.toThrow(/timed out/i);
  });

  it('bridge degraded 错误应该有 degraded=true 属性', async () => {
    const degradedResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        ok: false,
        status: 'timeout',
        degraded: true,
        message: 'LLM call timed out',
        elapsed_ms: 90000,
      }),
      text: async () => '{}',
    };
    global.fetch = vi.fn().mockResolvedValueOnce(degradedResponse);

    const { callLLM } = await import('../llm-caller.js');
    let caughtErr;
    try {
      await callLLM('cortex', 'test prompt');
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr).toBeDefined();
    expect(caughtErr.degraded).toBe(true);
    expect(caughtErr.status).toBe('timeout');
  });
});
