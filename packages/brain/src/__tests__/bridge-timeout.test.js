vi.mock('child_process', async original => ({ ...await original(), spawn: vi.fn(() => { throw new Error('测试禁止启动真实模型进程'); }) }));
// 本文件显式模拟模型网络与凭据，独立测试 provider 行为；真实隔离由 runtime-isolation.test.js 验证。
vi.mock('../runtime-safety.js', () => ({ assertLiveLLMAllowed: () => {} }));
/**
 * Bridge 超时降级测试（Claude 通道退役后：provider=anthropic 不再走 bridge，任务 76a160b3）
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
    const { selectBestAccount } = await import('../account-usage.js');
    selectBestAccount.mockResolvedValue({ accountId: 'account1' });
    const { getActiveProfile } = await import('../model-profile.js');
    getActiveProfile.mockReturnValue({
      id: 'test',
      config: {
        cortex: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      },
    });
  });

  // 原「bridge /llm-call 返回 degraded=true → 抛 timed out / degraded 属性」两条用例测的 callClaudeViaBridge
  // 已随 Claude 通道退役删除（任务 76a160b3）；改为断言 provider=anthropic 不再请求 bridge。
  it('provider=anthropic 不再请求 bridge /llm-call，anthropic-api 直连也失败时抛 claude_channel_retired', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('anthropic-api down'));

    const { callLLM } = await import('../llm-caller.js');
    let caughtErr;
    try {
      await callLLM('cortex', 'test prompt');
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr).toBeDefined();
    expect(caughtErr.code).toBe('claude_channel_retired');
    expect(caughtErr.message).toMatch(/claude_channel_retired/);
    expect(caughtErr.degraded).toBeUndefined();
    const urls = global.fetch.mock.calls.map(([url]) => String(url));
    expect(urls.some(u => u.includes('/llm-call'))).toBe(false);
    expect(urls.every(u => u.startsWith('https://api.anthropic.com/'))).toBe(true);
  });

  it('provider=anthropic 时 anthropic-api 直连成功即返回，provider 标为 anthropic-api', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: '直连结果' }], usage: {} }),
      text: async () => '{}',
    });

    const { callLLM } = await import('../llm-caller.js');
    const result = await callLLM('cortex', 'test prompt');
    expect(result.text).toBe('直连结果');
    expect(result.provider).toBe('anthropic-api');
    expect(result.attempted_fallback).toBe(true);
    const urls = global.fetch.mock.calls.map(([url]) => String(url));
    expect(urls.some(u => u.includes('/llm-call'))).toBe(false);
  });
});
