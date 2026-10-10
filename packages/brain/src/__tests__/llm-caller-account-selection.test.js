vi.mock('child_process', async original => ({ ...await original(), spawn: vi.fn(() => { throw new Error('测试禁止启动真实模型进程'); }) }));
// 本文件显式模拟模型网络与凭据，独立测试 provider 行为；真实隔离由 runtime-isolation.test.js 验证。
vi.mock('../runtime-safety.js', () => ({ assertLiveLLMAllowed: () => {} }));
/**
 * llm-caller-account-selection.test.js
 *
 * 原「callClaudeViaBridge 把 selectBestAccount 选出的 accountId 传给 bridge」ACS1-4 已随 Claude 通道退役删除（任务 76a160b3）。
 * 新行为：provider=anthropic 不再选 Claude 订阅账号、不 POST bridge，改由 anthropic-api（API key）直连兜底。
 *
 * DoD 映射：
 *  - ACS1 → 'sonnet + provider=anthropic：不调 selectBestAccount，只请求 api.anthropic.com'
 *  - ACS2 → 'haiku + provider=anthropic：不调 selectBestAccount，只请求 api.anthropic.com'
 *  - ACS3 → '账号查询失败/无账号都不影响：不抛 LLM_ACCOUNT_UNAVAILABLE'
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

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

// Mock fetch
// vi.stubGlobal 确保 afterAll 可以通过 vi.unstubAllGlobals() 恢复，不污染后续文件
const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

afterAll(() => {
  vi.unstubAllGlobals();
});

import { callLLM } from '../llm-caller.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function anthropicOk(text) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text }] }),
    text: async () => JSON.stringify({ content: [{ type: 'text', text }] }),
  };
}

function fetchedUrls() {
  return mockFetch.mock.calls.map(([url]) => String(url));
}

describe('llm-caller Claude 通道退役：不再选 Claude 账号、不 POST bridge（ACS 系列）', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(anthropicOk('测试回复'));
    // 每个测试前重置 model profile 为 sonnet（避免测试间 mock 状态污染）
    const { getActiveProfile } = await import('../model-profile.js');
    getActiveProfile.mockReturnValue({
      config: {
        thalamus: { model: 'claude-sonnet-4-6', provider: 'anthropic' },
      },
    });
  });

  it('ACS1: sonnet + provider=anthropic → 不调 selectBestAccount，只请求 api.anthropic.com', async () => {
    mockSelectBestAccount.mockResolvedValue({ accountId: 'account2', model: 'sonnet' });

    const result = await callLLM('thalamus', '测试 prompt');

    expect(mockSelectBestAccount).not.toHaveBeenCalled();
    expect(fetchedUrls()).toEqual([ANTHROPIC_URL]);
    const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(requestBody.model).toBe('claude-sonnet-4-6');
    expect(requestBody.accountId).toBeUndefined();
    expect(result.provider).toBe('anthropic-api');
  });

  it('ACS2: haiku + provider=anthropic → 不调 selectBestAccount，只请求 api.anthropic.com', async () => {
    const { getActiveProfile } = await import('../model-profile.js');
    getActiveProfile.mockReturnValue({
      config: {
        thalamus: { model: 'claude-haiku-4-5-20251001', provider: 'anthropic' },
      },
    });
    mockSelectBestAccount.mockResolvedValue({ accountId: 'account3', model: 'haiku' });

    await callLLM('thalamus', '测试 prompt');

    expect(mockSelectBestAccount).not.toHaveBeenCalled();
    expect(fetchedUrls()).toEqual([ANTHROPIC_URL]);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).model).toBe('claude-haiku-4-5-20251001');
  });

  it('ACS3: 账号查询失败 / 无可用账号都不影响 → 不抛 LLM_ACCOUNT_UNAVAILABLE，走 anthropic-api', async () => {
    mockSelectBestAccount.mockRejectedValue(new Error('account store unavailable'));
    await expect(callLLM('thalamus', '测试 prompt')).resolves.toMatchObject({ provider: 'anthropic-api', text: '测试回复' });

    mockSelectBestAccount.mockResolvedValue(null);
    await expect(callLLM('thalamus', '测试 prompt')).resolves.toMatchObject({ provider: 'anthropic-api' });

    expect(mockSelectBestAccount).not.toHaveBeenCalled();
    expect(fetchedUrls().some((u) => u.includes('/llm-call'))).toBe(false);
  });
});

describe('llm-caller 图片视觉支持（VB 系列）', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(anthropicOk('我看到了一张图片'));
    const { getActiveProfile } = await import('../model-profile.js');
    getActiveProfile.mockReturnValue({
      config: {
        mouth: { model: 'claude-sonnet-4-6', provider: 'anthropic' },
      },
    });
    mockSelectBestAccount.mockResolvedValue({ accountId: 'account1', model: 'claude-sonnet-4-6' });
  });

  it('VB1: imageContent 存在 + provider=anthropic → 不走 bridge，图片随 anthropic-api 透传', async () => {
    const imageContent = [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'abc123' } }];

    const result = await callLLM('mouth', '这张图片是什么？', { imageContent });

    expect(fetchedUrls()).toEqual([ANTHROPIC_URL]);
    const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(requestBody.image_base64).toBeUndefined();
    expect(requestBody.messages[0].content[1]).toEqual(imageContent[0]);
    expect(result.text).toBe('我看到了一张图片');
  });

  it('VB2: 无 imageContent + provider=anthropic → 不调用 bridge（localhost）', async () => {
    mockFetch.mockResolvedValue(anthropicOk('纯文字回复'));

    const result = await callLLM('mouth', '你好，世界！');

    expect(mockFetch).toHaveBeenCalled();
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).not.toContain('localhost');
    expect(calledUrl).toBe(ANTHROPIC_URL);
    expect(result.text).toBe('纯文字回复');
  });
});
