/**
 * llm-caller-account-selection.test.js
 *
 * 测试 callClaudeViaBridge 正确构造 configDir：
 *  - selectBestAccount() 返回 { accountId, model } 时，提取 accountId（修复 object → string bug）
 *  - selectBestAccountForHaiku() 返回 string 时，直接使用
 *
 * DoD 映射：
 *  - ACS1 → 'selectBestAccount 返回 {accountId} 对象时，configDir 包含正确 accountId'
 *  - ACS2 → 'selectBestAccountForHaiku 返回 string 时，configDir 包含正确账号'
 *  - ACS3 → 'selectBestAccount 返回 null 时，不传 configDir'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';

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

describe('llm-caller accountId 提取（ACS 系列）', () => {
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

  it('ACS1: selectBestAccount 返回 {accountId, model} 对象时，configDir 包含正确 accountId', async () => {
    mockSelectBestAccount.mockResolvedValue({ accountId: 'account2', model: 'sonnet' });

    await callLLM('thalamus', '测试 prompt');

    expect(mockFetch).toHaveBeenCalled();
    const callArgs = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);

    // configDir 应包含 account2（不是 [object Object]）
    expect(requestBody.configDir).toBeDefined();
    expect(requestBody.configDir).toContain('account2');
    expect(requestBody.configDir).not.toContain('[object Object]');
    expect(requestBody.configDir).toBe(join(homedir(), '.claude-account2'));
  });

  it('ACS2: selectBestAccountForHaiku 返回 string 时，configDir 包含正确账号', async () => {
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

    expect(requestBody.configDir).toBe(join(homedir(), '.claude-account3'));
  });

  it('ACS3: selectBestAccount 返回 null 时，不传 configDir', async () => {
    mockSelectBestAccount.mockResolvedValue(null);

    await callLLM('thalamus', '测试 prompt');

    expect(mockFetch).toHaveBeenCalled();
    const callArgs = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);

    // null 时不应有 configDir 字段
    expect(requestBody.configDir).toBeUndefined();
  });
});
