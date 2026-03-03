/**
 * llm-caller-account-selection.test.js
 *
 * 测试 callClaudeViaBridge 正确传递 accountId 给 bridge：
 *  - selectBestAccount() 返回 { accountId, model } 时，提取 accountId（修复容器内 homedir 路径 bug）
 *  - selectBestAccountForHaiku() 返回 string 时，直接使用
 *  - bridge 在宿主机侧用 accountId 拼出正确 CLAUDE_CONFIG_DIR（不在容器内拼）
 *
 * DoD 映射：
 *  - ACS1 → 'selectBestAccount 返回 {accountId} 对象时，requestBody.accountId 为正确 accountId 字符串'
 *  - ACS2 → 'selectBestAccountForHaiku 返回 string 时，requestBody.accountId 为正确账号'
 *  - ACS3 → 'selectBestAccount 返回 null 时，不传 accountId'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs.existsSync (for isSpendingCapped)
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({ api_key: 'test-key' })),
  existsSync: vi.fn().mockReturnValue(true),
}));

// Mock account-usage.js
const mockSelectBestAccount = vi.hoisted(() => vi.fn());
const mockSelectBestAccountForHaiku = vi.hoisted(() => vi.fn());
vi.mock('../account-usage.js', () => ({
  selectBestAccount: mockSelectBestAccount,
  selectBestAccountForHaiku: mockSelectBestAccountForHaiku,
  isSpendingCapped: vi.fn().mockReturnValue(false),
}));

// Mock model-profile.js
vi.mock('../model-profile.js', () => ({
  getActiveProfile: vi.fn().mockReturnValue({
    config: {
      thalamus: { model: 'claude-sonnet-4-6', provider: 'anthropic' },
    },
  }),
}));

// Mock fetch (bridge call)
const mockFetch = vi.hoisted(() => vi.fn());
global.fetch = mockFetch;

import { callLLM } from '../llm-caller.js';

describe('llm-caller accountId 传递给 bridge（ACS 系列）', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Default: fetch returns ok
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, text: '测试回复' }),
      text: async () => JSON.stringify({ ok: true, text: '测试回复' }),
    });
    // 每个测试前重置 model profile 为 sonnet（避免测试间 mock 状态污染）
    const { getActiveProfile } = await import('../model-profile.js');
    getActiveProfile.mockReturnValue({
      config: {
        thalamus: { model: 'claude-sonnet-4-6', provider: 'anthropic' },
      },
    });
  });

  it('ACS1: selectBestAccount 返回 {accountId, model} 对象时，requestBody.accountId 为正确字符串', async () => {
    mockSelectBestAccount.mockResolvedValue({ accountId: 'account2', model: 'sonnet' });

    await callLLM('thalamus', '测试 prompt');

    expect(mockFetch).toHaveBeenCalled();
    const callArgs = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);

    // 发给 bridge 的是 accountId 字符串（不是 configDir 路径，不是 [object Object]）
    expect(requestBody.accountId).toBe('account2');
    expect(requestBody.configDir).toBeUndefined();
  });

  it('ACS2: selectBestAccountForHaiku 返回 string 时，requestBody.accountId 为正确账号', async () => {
    // 当 model 是 haiku，使用 selectBestAccountForHaiku（返回 string）
    const { getActiveProfile } = await import('../model-profile.js');
    getActiveProfile.mockReturnValue({
      config: {
        thalamus: { model: 'claude-haiku-4-5-20251001', provider: 'anthropic' },
      },
    });

    mockSelectBestAccountForHaiku.mockResolvedValue('account3');

    await callLLM('thalamus', '测试 prompt');

    expect(mockFetch).toHaveBeenCalled();
    const callArgs = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);

    expect(requestBody.accountId).toBe('account3');
    expect(requestBody.configDir).toBeUndefined();
  });

  it('ACS3: selectBestAccount 返回 null 时，不传 accountId', async () => {
    mockSelectBestAccount.mockResolvedValue(null);

    await callLLM('thalamus', '测试 prompt');

    expect(mockFetch).toHaveBeenCalled();
    const callArgs = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);

    // null 时不应有 accountId 字段
    expect(requestBody.accountId).toBeUndefined();
    expect(requestBody.configDir).toBeUndefined();
  });
});

describe('llm-caller 图片视觉支持（VB 系列）', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // 有图片时走 anthropic-api（直连），返回标准 Anthropic API 格式
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: '我看到了一张图片' }],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
      text: async () => JSON.stringify({ ok: true, text: '测试回复' }),
    });
    const { getActiveProfile } = await import('../model-profile.js');
    getActiveProfile.mockReturnValue({
      config: {
        mouth: { model: 'claude-sonnet-4-6', provider: 'anthropic' },
      },
    });
    mockSelectBestAccount.mockResolvedValue({ accountId: 'account1', model: 'claude-sonnet-4-6' });
  });

  it('VB1: imageContent 存在 + provider=anthropic → 调用 anthropic-api 直连（非 bridge）', async () => {
    const imageContent = [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'abc123' } }];

    await callLLM('mouth', '这张图片是什么？', { imageContent });

    expect(mockFetch).toHaveBeenCalled();
    const calledUrl = mockFetch.mock.calls[0][0];
    // 应该调用 Anthropic 直连 API（非 bridge localhost）
    expect(calledUrl).toContain('api.anthropic.com');
    expect(calledUrl).not.toContain('localhost');
  });

  it('VB2: 无 imageContent + provider=anthropic → 调用 bridge（原有逻辑不破坏）', async () => {
    // 无图片时走 bridge，bridge 返回格式
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, text: '纯文字回复' }),
      text: async () => JSON.stringify({ ok: true, text: '纯文字回复' }),
    });

    await callLLM('mouth', '你好，世界！');

    expect(mockFetch).toHaveBeenCalled();
    const calledUrl = mockFetch.mock.calls[0][0];
    // 应该走 bridge（localhost）
    expect(calledUrl).toContain('localhost');
    expect(calledUrl).not.toContain('api.anthropic.com');
  });
});
