/**
 * llm-caller-bridge-image.test.js — P0-5 vision-via-bridge 专项单测
 *
 * 目标：验证 callClaudeViaBridge 已支持多模态（image_base64 + image_mime），
 * 且 callLLM 路由层不再因为 imageContent 就强制升级到 anthropic-api。
 *
 * 覆盖：
 *   1. 有图片 + provider=anthropic → fetch bridge /llm-call，body 带 image_base64 + image_mime
 *   2. 有图片 + provider=anthropic-api → 仍走 Anthropic REST API（向后兼容 fallback）
 *   3. 无图片的老调用不受影响 — 不带 image_base64 字段
 *   4. 空 imageContent 数组 / 非 image 类型 → 不传图片字段
 *   5. imageContent 多张图 → 只取第一张传给 bridge（claude -p + Read 工具场景）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../model-profile.js', () => ({
  getActiveProfile: vi.fn(() => ({
    id: 'profile-test',
    name: 'Test Profile',
    config: {
      // 故意把 cortex / vision_like 配成 anthropic（bridge 路径）
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

import { callLLM, _resetAnthropicKey, _resetBridgeCircuitState } from '../llm-caller.js';

function makeBridgeOk(text = 'bridge回复') {
  return {
    ok: true,
    status: 200,
    json: async () => ({ text }),
    text: async () => JSON.stringify({ text }),
  };
}

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

describe('vision-via-bridge (P0-5)', () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = vi.fn();
    _resetAnthropicKey();
    _resetBridgeCircuitState();
    vi.clearAllMocks();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('有图片 + provider=anthropic → 走 bridge，body 带 image_base64 + image_mime', async () => {
    global.fetch.mockResolvedValueOnce(makeBridgeOk('看图成功'));

    const imageContent = [
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
      },
    ];
    const result = await callLLM('cortex', '请评审这张图', { imageContent });

    expect(result.text).toBe('看图成功');
    expect(result.provider).toBe('anthropic');

    // 验证 fetch 调的是 bridge /llm-call，不是 anthropic REST
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toContain('/llm-call');
    expect(url).not.toContain('api.anthropic.com');
    const body = JSON.parse(init.body);
    expect(body.prompt).toBe('请评审这张图');
    expect(body.image_base64).toBe('AAAA');
    expect(body.image_mime).toBe('image/jpeg');
    expect(body.accountId).toBe('account1');
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

  it('无图片的老调用 → bridge body 不带 image 字段', async () => {
    global.fetch.mockResolvedValueOnce(makeBridgeOk('纯文字'));

    const result = await callLLM('cortex', '只是聊天');

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toContain('/llm-call');
    const body = JSON.parse(init.body);
    expect(body.prompt).toBe('只是聊天');
    expect(body.image_base64).toBeUndefined();
    expect(body.image_mime).toBeUndefined();
    expect(result.text).toBe('纯文字');
  });

  it('空 imageContent 数组 → 不传 image 字段', async () => {
    global.fetch.mockResolvedValueOnce(makeBridgeOk('ok'));

    await callLLM('cortex', '测试', { imageContent: [] });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.image_base64).toBeUndefined();
    expect(body.image_mime).toBeUndefined();
  });

  it('imageContent 含非 image 元素 → 跳过，不传 image 字段', async () => {
    global.fetch.mockResolvedValueOnce(makeBridgeOk('ok'));

    const imageContent = [{ type: 'text', text: 'not an image' }];
    await callLLM('cortex', '测试', { imageContent });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.image_base64).toBeUndefined();
  });

  it('多张图 → bridge 只传第一张（claude -p + Read 单图场景）', async () => {
    global.fetch.mockResolvedValueOnce(makeBridgeOk('ok'));

    const imageContent = [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'FIRST' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'SECOND' } },
    ];
    await callLLM('cortex', '多图', { imageContent });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.image_base64).toBe('FIRST');
    expect(body.image_mime).toBe('image/png');
  });

  it('imageContent source.type 不是 base64 → 跳过，不传 image 字段', async () => {
    global.fetch.mockResolvedValueOnce(makeBridgeOk('ok'));

    const imageContent = [
      {
        type: 'image',
        source: { type: 'url', url: 'https://example.com/a.png' },
      },
    ];
    await callLLM('cortex', '测试', { imageContent });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.image_base64).toBeUndefined();
  });
});
