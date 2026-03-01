/**
 * memory-retriever-chat.test.js — 对话记忆持久化测试
 *
 * 验证：
 * - RELEVANT_EVENT_TYPES 包含 orchestrator_chat
 * - HALF_LIFE 包含 conversation
 * - MODE_WEIGHT 包含 conversation
 * - chat 模式下 buildMemoryContext 能检索到对话历史
 */

import { describe, it, expect, vi } from 'vitest';

// Mock 依赖
vi.mock('../similarity.js', () => ({
  default: class {
    searchWithVectors() { return { matches: [] }; }
  },
}));

vi.mock('../learning.js', () => ({
  searchRelevantLearnings: vi.fn().mockResolvedValue([]),
}));

vi.mock('../user-profile.js', () => ({
  loadUserProfile: vi.fn().mockResolvedValue(null),
  formatProfileSnippet: vi.fn().mockReturnValue(''),
}));

vi.mock('../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

import {
  RELEVANT_EVENT_TYPES,
  HALF_LIFE,
  MODE_WEIGHT,
  buildMemoryContext,
  _loadConversationHistory,
} from '../memory-retriever.js';

describe('memory-retriever chat 模式', () => {
  it('RELEVANT_EVENT_TYPES 包含 orchestrator_chat', () => {
    expect(RELEVANT_EVENT_TYPES).toContain('orchestrator_chat');
  });

  it('HALF_LIFE 包含 conversation 条目，值为 7 天', () => {
    expect(HALF_LIFE.conversation).toBe(7);
  });

  it('MODE_WEIGHT 包含 conversation 条目', () => {
    expect(MODE_WEIGHT.conversation).toBeDefined();
    expect(MODE_WEIGHT.conversation.chat).toBe(1.5);
    expect(MODE_WEIGHT.conversation.plan).toBe(0.3);
  });

  it('loadConversationHistory 格式化对话记录', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: '1',
            payload: JSON.stringify({ user_message: '今天做什么', reply: '看看 OKR' }),
            created_at: new Date().toISOString(),
          },
        ],
      }),
    };

    const result = await _loadConversationHistory(mockPool, 5);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].source).toBe('conversation');
    expect(result.entries[0].text).toContain('Alex:');
    expect(result.entries[0].text).toContain('Cecelia:');
    expect(result.entries[0].title).toContain('[对话]');
  });

  it('buildMemoryContext chat 模式加载对话历史', async () => {
    const mockPool = {
      query: vi.fn().mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes("event_type = 'orchestrator_chat'")) {
          return {
            rows: [{
              id: '1',
              payload: JSON.stringify({ user_message: '上次聊的那个 CI', reply: '你是说 CI 覆盖率吗' }),
              created_at: new Date().toISOString(),
            }],
          };
        }
        if (typeof sql === 'string' && sql.includes('cecelia_events')) {
          return { rows: [] };
        }
        if (typeof sql === 'string' && sql.includes('goals')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    const { block, meta } = await buildMemoryContext({
      query: '上次聊的那个',
      mode: 'chat',
      tokenBudget: 2000,
      pool: mockPool,
    });

    expect(meta.candidates).toBeGreaterThan(0);
    expect(block).toContain('CI');
  });

  it('loadConversationHistory 处理异常返回空数组', async () => {
    const mockPool = {
      query: vi.fn().mockRejectedValue(new Error('DB error')),
    };

    const result = await _loadConversationHistory(mockPool);
    expect(result.entries).toEqual([]);
  });
});
