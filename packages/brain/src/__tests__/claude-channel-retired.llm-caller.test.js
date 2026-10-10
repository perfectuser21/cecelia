vi.mock('child_process', async original => ({ ...await original(), spawn: vi.fn(() => { throw new Error('测试禁止启动真实模型进程'); }) }));
// 本文件显式模拟模型网络与凭据；真实隔离由 runtime-isolation.test.js 验证。
vi.mock('../runtime-safety.js', () => ({ assertLiveLLMAllowed: () => {} }));
/**
 * Claude 无头通道下线 —— llm-caller（任务 76a160b3）
 *
 * provider 'anthropic'（经 cecelia-bridge /llm-call 调 claude -p）已退役：
 *   - 不发任何 HTTP 请求到 bridge，按「该候选失败」走 fallbacks
 *   - 错误信息含 claude_channel_retired
 *   - 不选 Claude 订阅账号、不碰 account1/2 的 exit-code-1 熔断（markAuthFailure）
 *   - anthropic-api（API key 直连）兜底照旧
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../model-profile.js', () => ({ getActiveProfile: vi.fn() }));
vi.mock('../account-usage.js', () => ({
  selectBestAccount: vi.fn(async () => ({ accountId: 'account1', model: 'haiku' })),
  markAuthFailure: vi.fn(),
  verifyAccountTokenLive: vi.fn(async () => 'auth_failed'),
}));
vi.mock('../langfuse-reporter.js', () => ({ reportCall: vi.fn(async () => {}) }));
vi.mock('fs', () => ({
  readFileSync: vi.fn((filePath) => {
    if (String(filePath).includes('anthropic.json')) return JSON.stringify({ api_key: 'test-anthropic-key' });
    throw new Error('File not found');
  }),
}));

import { callLLM, _resetAnthropicKey, _resetMinimaxKey } from '../llm-caller.js';
import { getActiveProfile } from '../model-profile.js';
import { selectBestAccount, markAuthFailure } from '../account-usage.js';

function anthropicOk(text = 'API 直连回复') {
  return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text }] }), text: async () => text };
}
function anthropicFail() {
  return { ok: false, status: 500, json: async () => ({}), text: async () => 'overloaded' };
}
const bridgeCalls = () => global.fetch.mock.calls.filter(([url]) => /llm-call|:3457/.test(String(url)));

describe('llm-caller：anthropic（claude -p 经 bridge）provider 下线', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = vi.fn();
    _resetAnthropicKey();
    _resetMinimaxKey();
    vi.clearAllMocks();
  });
  afterEach(() => { global.fetch = originalFetch; });

  it('primary=anthropic → 不打 bridge，直接走配置的 anthropic-api fallback', async () => {
    getActiveProfile.mockReturnValue({ config: { thalamus: {
      provider: 'anthropic', model: 'claude-haiku-4-5-20251001',
      fallbacks: [{ provider: 'anthropic-api', model: 'claude-haiku-4-5-20251001' }],
    } } });
    global.fetch.mockResolvedValue(anthropicOk());

    const out = await callLLM('thalamus', 'hello');

    expect(out.provider).toBe('anthropic-api');
    expect(out.text).toBe('API 直连回复');
    expect(bridgeCalls()).toHaveLength(0);
    expect(global.fetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.any(Object));
    expect(selectBestAccount).not.toHaveBeenCalled();
  });

  it('claude 模型名 + 非 api provider 同样视为退役通道，不打 bridge', async () => {
    getActiveProfile.mockReturnValue({ config: { mouth: {
      provider: 'anthropic', model: 'claude-sonnet-4-6',
      fallbacks: [{ provider: 'anthropic-api', model: 'claude-sonnet-4-6' }],
    } } });
    global.fetch.mockResolvedValue(anthropicOk('ok'));
    const out = await callLLM('mouth', 'hi');
    expect(out.provider).toBe('anthropic-api');
    expect(bridgeCalls()).toHaveLength(0);
  });

  it('全部失败时抛出的错误带 claude_channel_retired，且不触发账号熔断', async () => {
    getActiveProfile.mockReturnValue({ config: { cortex: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' } } });
    global.fetch.mockResolvedValue(anthropicFail());

    await expect(callLLM('cortex', 'x')).rejects.toThrow(/claude_channel_retired/);
    expect(bridgeCalls()).toHaveLength(0);
    expect(markAuthFailure).not.toHaveBeenCalled();
    expect(selectBestAccount).not.toHaveBeenCalled();
  });

  it('非 anthropic 候选全失败 + anthropic-api 兜底失败后，不再走 bridge「终极兜底」', async () => {
    getActiveProfile.mockReturnValue({ config: { rumination: { provider: 'minimax', model: 'MiniMax-M2.5' } } });
    global.fetch.mockResolvedValue(anthropicFail());

    await expect(callLLM('rumination', 'x')).rejects.toThrow();
    expect(bridgeCalls()).toHaveLength(0);
  });

  it('options.provider=anthropic 显式覆盖也不打 bridge', async () => {
    getActiveProfile.mockReturnValue({ config: {} });
    global.fetch.mockResolvedValue(anthropicOk('隐式直连'));
    const out = await callLLM('reflection', 'x', { provider: 'anthropic' });
    expect(out.provider).toBe('anthropic-api');
    expect(bridgeCalls()).toHaveLength(0);
  });
});
