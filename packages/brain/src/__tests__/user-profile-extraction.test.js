/**
 * user-profile-extraction.test.js — 用户画像提取修复测试
 *
 * 验证：
 * - EXTRACT_PROMPT 明确区分 Alex 和 Cecelia
 * - conversationText 角色标注正确
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 依赖
vi.mock('../embedding-service.js', () => ({
  generateProfileFactEmbeddingAsync: vi.fn(),
}));

vi.mock('../openai-client.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue([]),
}));

// 注入测试 API key
const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

const mockQuery = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [{ id: '1' }] }));
vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

import { extractAndSaveUserFacts, _setApiKeyForTest } from '../user-profile.js';

beforeEach(() => {
  mockQuery.mockClear();
  mockFetch.mockClear();
  _setApiKeyForTest('test-key');
});

describe('extractAndSaveUserFacts 角色区分', () => {
  it('conversationText 中 Alex 标记为用户，Cecelia 标记为 AI', async () => {
    let capturedBody = null;
    mockFetch.mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{}' } }],
        }),
      };
    });

    const messages = [
      { role: 'user', content: '我叫小明' },
      { role: 'assistant', content: '你好小明，我是 Cecelia' },
    ];

    await extractAndSaveUserFacts({ query: mockQuery }, 'owner', messages, '很高兴认识你');

    expect(capturedBody).not.toBeNull();
    const contentMsg = capturedBody.messages.find(m => m.role === 'user');
    expect(contentMsg.content).toContain('Alex（用户）');
    expect(contentMsg.content).toContain('Cecelia（AI管家）');
  });

  it('EXTRACT_PROMPT 包含角色区分说明', async () => {
    let capturedBody = null;
    mockFetch.mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{}' } }],
        }),
      };
    });

    await extractAndSaveUserFacts({ query: mockQuery }, 'owner', [{ role: 'user', content: 'test' }], '');

    const systemMsg = capturedBody.messages.find(m => m.role === 'system');
    expect(systemMsg.content).toContain('Alex（用户）');
    expect(systemMsg.content).toContain('Cecelia（AI管家）');
    expect(systemMsg.content).toContain('Cecelia 是 AI 的名字，不是用户的名字');
  });

  it('空消息不调用 API', async () => {
    await extractAndSaveUserFacts({ query: mockQuery }, 'owner', [], '');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
