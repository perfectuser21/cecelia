vi.mock('child_process', async original => ({ ...await original(), spawn: vi.fn(() => { throw new Error('测试禁止启动真实模型进程'); }) }));
// 本文件显式模拟模型网络与凭据，独立测试 provider 行为；真实隔离由 runtime-isolation.test.js 验证。
vi.mock('../runtime-safety.js', () => ({ assertLiveLLMAllowed: () => {} }));
/**
 * llm-caller-bridge-image.test.js — 图片调用路由专项单测
 *
 * 原 P0-5 vision-via-bridge（图片经 bridge /llm-call 的 image_base64 透传）已随 Claude 通道退役删除（任务 76a160b3）。
 *
 * 覆盖：
 *   1. 有图片 + provider=anthropic → 不 fetch bridge，图片随 anthropic-api 直连兜底透传
 *   2. 有图片 + provider=anthropic-api → 仍走 Anthropic REST API
 *   3. 无图片 + provider=anthropic → 不 fetch bridge，纯文字走 anthropic-api
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../model-profile.js', () => ({
  getActiveProfile: vi.fn(() => ({
    id: 'profile-test',
    name: 'Test Profile',
    config: {
      // cortex 配成 anthropic（已退役的 Claude 通道）
      cortex: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      thalamus: { provider: 'anthropic-api', model: 'claude-haiku-4-5-20251001' },
    },
  })),
}));

vi.mock('../account-usage.js', () => ({
  selectBestAccount: vi.fn(async () => ({ accountId: 'account1', model: 'sonnet' })),
  markAuthFailure: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn((p) => {
    if (String(p).includes('anthropic.json')) {
      return JSON.stringify({ api_key: 'test-anthropic-key' });
    }
    throw new Error('File not found');
  }),
}));

import { callLLM, _resetAnthropicKey, _resetAnthropicBalanceAlerted } from '../llm-caller.js';

function makeAnthropicOk(text = 'api回复') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      content: [{ type: 'text', text }],
      model: 'claude-sonnet-4-6',
    }),
    text: async () => text,
  };
}

describe('图片调用路由（Claude 通道退役后）', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = vi.fn();
    _resetAnthropicKey();
    _resetAnthropicBalanceAlerted();
    vi.clearAllMocks();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('有图片 + provider=anthropic → 不 fetch bridge，图片随 anthropic-api 兜底透传', async () => {
    global.fetch.mockResolvedValueOnce(makeAnthropicOk('看图成功'));

    const imageContent = [
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
      },
    ];
    const result = await callLLM('cortex', '请评审这张图', { imageContent });

    expect(result.text).toBe('看图成功');
    expect(result.provider).toBe('anthropic-api');
    expect(result.attempted_fallback).toBe(true);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).not.toContain('/llm-call');
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.image_base64).toBeUndefined();
    expect(body.messages[0].content[0]).toEqual({ type: 'text', text: '请评审这张图' });
    expect(body.messages[0].content[1]).toEqual(imageContent[0]);
  });

  it('有图片 + provider=anthropic-api → 走 Anthropic REST（向后兼容 fallback）', async () => {
    global.fetch.mockResolvedValueOnce(makeAnthropicOk('api 看图'));

    const imageContent = [
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'BBBB' },
      },
    ];
    const result = await callLLM('thalamus', '看图', { imageContent });

    // thalamus 配置里 provider=anthropic-api，应该仍走 REST
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(init.body);
    expect(Array.isArray(body.messages[0].content)).toBe(true);
    expect(body.messages[0].content[0]).toEqual({ type: 'text', text: '看图' });
    expect(body.messages[0].content[1]).toEqual(imageContent[0]);
    expect(result.text).toBe('api 看图');
    expect(result.provider).toBe('anthropic-api');
  });

  it('无图片 + provider=anthropic → 不 fetch bridge，纯文字走 anthropic-api', async () => {
    global.fetch.mockResolvedValueOnce(makeAnthropicOk('纯文字'));

    const result = await callLLM('cortex', '只是聊天');

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).not.toContain('/llm-call');
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(init.body);
    expect(body.messages[0].content).toBe('只是聊天');
    expect(result.text).toBe('纯文字');
    expect(result.provider).toBe('anthropic-api');
  });

  it('provider=anthropic 且 anthropic-api 兜底失败 → 抛 claude_channel_retired，不 fetch bridge', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'unavailable' });

    await expect(callLLM('cortex', '测试', { imageContent: [] })).rejects.toMatchObject({ code: 'claude_channel_retired' });
    const urls = global.fetch.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes('/llm-call'))).toBe(false);
  });

  // 原「空 imageContent / 非 image 元素 / 多张图只传第一张 / 非 base64 source」四条 bridge 取图字段用例已随 Claude 通道退役删除（任务 76a160b3）
});
