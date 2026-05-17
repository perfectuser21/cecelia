/**
 * 回归测试：PROBE_FAIL_RUMINATION — codex provider 失败时的 anthropic-api 兜底
 *
 * 背景：rumination agent 在 DB profile 中被设置为 codex provider，
 *       但 Codex OAuth team 账号不可用且无 OpenAI API key，
 *       导致 callLLM('rumination', ...) 抛出 "无可用 OAuth team 账号" 错误，
 *       反刍循环完全失效（PROBE_FAIL_RUMINATION degraded_llm_failure）。
 *
 * 修复验证：当 primary provider 为非 Anthropic（codex/openai）且所有候选都失败时，
 *           callLLM 应自动尝试 anthropic-api 兜底（emergency fallback）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../model-profile.js', () => ({
  getActiveProfile: vi.fn(),
}));

vi.mock('../account-usage.js', () => ({
  selectBestAccount: vi.fn(async () => ({ accountId: 'account1', model: 'haiku' })),
  markAuthFailure: vi.fn(),
}));

vi.mock('../langfuse-reporter.js', () => ({
  reportCall: vi.fn(async () => {}),
}));

// codex auth.json 和 openai.json 均不存在，只有 anthropic.json
vi.mock('fs', () => ({
  readFileSync: vi.fn((filePath) => {
    if (filePath.includes('anthropic.json')) {
      return JSON.stringify({ api_key: 'test-anthropic-key' });
    }
    throw new Error('File not found');
  }),
}));

import { callLLM, _resetAnthropicKey, _resetOpenAIKey } from '../llm-caller.js';
import { getActiveProfile } from '../model-profile.js';

function makeAnthropicResponse(text = '兜底回复') {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text }] }),
    text: async () => JSON.stringify({ content: [{ type: 'text', text }] }),
  };
}

describe('callLLM — codex provider 失败后的 anthropic-api 兜底（PROBE_FAIL_RUMINATION 修复）', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = vi.fn();
    _resetAnthropicKey();
    _resetOpenAIKey();
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('codex provider 失败（无 OAuth 账号 + 无 API key）时自动 fallback 到 anthropic-api', async () => {
    getActiveProfile.mockReturnValue({
      config: {
        rumination: {
          provider: 'codex',
          model: 'codex/gpt-5.4-mini',
        },
      },
    });

    // codex 因无 API key 抛出异常（不走 fetch），只需 mock anthropic-api 兜底
    global.fetch.mockResolvedValueOnce(makeAnthropicResponse('反刍洞察兜底内容'));

    const result = await callLLM('rumination', '测试反刍 prompt');

    expect(result.text).toBe('反刍洞察兜底内容');
    expect(result.provider).toBe('anthropic-api');
    expect(result.attempted_fallback).toBe(true);
  });

  it('codex provider 失败且 anthropic-api 兜底也失败时抛出错误', async () => {
    getActiveProfile.mockReturnValue({
      config: {
        rumination: {
          provider: 'codex',
          model: 'codex/gpt-5.4-mini',
        },
      },
    });

    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    await expect(callLLM('rumination', '测试 prompt')).rejects.toThrow();
  });

  it('openai provider 失败（无 API key）时触发 anthropic-api 兜底', async () => {
    getActiveProfile.mockReturnValue({
      config: {
        rumination: {
          provider: 'openai',
          model: 'gpt-5.4-mini',
        },
      },
    });

    // openai 因无 API key 抛出异常（不走 fetch），只需 mock anthropic-api 兜底
    global.fetch.mockResolvedValueOnce(makeAnthropicResponse('兜底成功'));

    const result = await callLLM('rumination', '测试 prompt');

    expect(result.text).toBe('兜底成功');
    expect(result.provider).toBe('anthropic-api');
    expect(result.attempted_fallback).toBe(true);
  });

  it('已有 anthropic-api 候选时不触发 emergency fallback', async () => {
    getActiveProfile.mockReturnValue({
      config: {
        rumination: {
          provider: 'anthropic-api',
          model: 'claude-haiku-4-5-20251001',
        },
      },
    });

    global.fetch.mockResolvedValueOnce(makeAnthropicResponse('直接成功'));

    const result = await callLLM('rumination', '测试 prompt');

    expect(result.text).toBe('直接成功');
    expect(result.provider).toBe('anthropic-api');
    expect(result.attempted_fallback).toBe(false);
    // 只有一次 fetch 调用（emergency fallback 未触发）
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('候选包含 codex + anthropic fallback 时不触发 emergency fallback', async () => {
    getActiveProfile.mockReturnValue({
      config: {
        rumination: {
          provider: 'codex',
          model: 'codex/gpt-5.4-mini',
          fallbacks: [{ provider: 'anthropic-api', model: 'claude-haiku-4-5-20251001' }],
        },
      },
    });

    // codex 失败（无 fetch 调用），fallback anthropic-api 成功
    global.fetch.mockResolvedValueOnce(makeAnthropicResponse('configured fallback 成功'));

    const result = await callLLM('rumination', '测试 prompt');

    expect(result.text).toBe('configured fallback 成功');
    expect(result.provider).toBe('anthropic-api');
    // 只有一次 fetch（emergency fallback 不触发，用了 configured fallback）
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('codex 失败 + anthropic-api 余额不足 → 自动 fallback 到 anthropic bridge', async () => {
    getActiveProfile.mockReturnValue({
      config: {
        rumination: {
          provider: 'codex',
          model: 'codex/gpt-5.4',
        },
      },
    });

    // 第一个 fetch：anthropic-api 余额不足（400 credit balance too low）
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'Your credit balance is too low' },
      }),
    });

    // bridge 调用成功（第二个 fetch）
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ text: 'bridge 兜底成功', degraded: false }),
    });

    const result = await callLLM('rumination', '测试 prompt');

    expect(result.text).toBe('bridge 兜底成功');
    expect(result.provider).toBe('anthropic');
    expect(result.attempted_fallback).toBe(true);
  });

  it('codex 失败 + anthropic-api 失败 + bridge 失败 → 抛出最终错误', async () => {
    getActiveProfile.mockReturnValue({
      config: {
        rumination: {
          provider: 'codex',
          model: 'codex/gpt-5.4',
        },
      },
    });

    // anthropic-api 失败（503）
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    // bridge 也失败（500 after retries exhausted）
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Bridge error',
    });

    await expect(callLLM('rumination', '测试 prompt')).rejects.toThrow();
  });
});
