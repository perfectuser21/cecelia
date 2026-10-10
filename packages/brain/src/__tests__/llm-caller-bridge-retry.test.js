vi.mock('child_process', async original => ({ ...await original(), spawn: vi.fn(() => { throw new Error('测试禁止启动真实模型进程'); }) }));
// 本文件显式模拟模型网络与凭据，独立测试 provider 行为；真实隔离由 runtime-isolation.test.js 验证。
vi.mock('../runtime-safety.js', () => ({ assertLiveLLMAllowed: () => {} }));
/**
 * Test: Claude 通道退役后 provider=anthropic 不再走 bridge（也就没有 Bridge 500 重试）
 * 原「Bridge 500 重试 / 500 后第二次成功 / dyld 启动错误跳过重试」三条已随 Claude 通道退役删除（任务 76a160b3）。
 */

import { describe, it, expect, vi } from 'vitest';

// Mock dependencies
vi.mock('../account-usage.js', () => ({
  selectBestAccount: vi.fn().mockResolvedValue({ accountId: 'account1' }),
}));

vi.mock('../model-profile.js', () => ({
  getActiveProfile: vi.fn().mockReturnValue({
    config: {
      thalamus: { provider: 'anthropic-api', model: 'claude-haiku-4-5-20251001' },
    },
  }),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readFileSync: vi.fn((path, enc) => {
      if (typeof path === 'string' && path.includes('anthropic.json')) {
        return JSON.stringify({ api_key: 'test-key' });
      }
      return actual.readFileSync(path, enc);
    }),
  };
});

describe('Claude 通道退役 - 不再请求 bridge /llm-call', () => {
  it('provider=anthropic + 下游一律 500 → 不 fetch 桥接、不重试，抛 claude_channel_retired', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const { callLLM } = await import('../llm-caller.js');

    await expect(
      callLLM('thalamus', 'test prompt', { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' })
    ).rejects.toMatchObject({ code: 'claude_channel_retired' });

    const urls = global.fetch.mock.calls.map(([url]) => String(url));
    expect(urls.some((u) => u.includes('/llm-call'))).toBe(false);
    // 仅剩一次 anthropic-api 直连兜底（API key 通道保留）
    expect(urls).toEqual(['https://api.anthropic.com/v1/messages']);
  });
});
