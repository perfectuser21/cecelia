/**
 * Orchestrator Chat Tests
 * 测试 Cecelia 嘴巴对话链路（纯意识模式）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 统一 LLM 调用层 — callWithHistory 内部调用 callLLM('mouth', ...)
const mockCallLLM = vi.hoisted(() => vi.fn());
vi.mock('../llm-caller.js', () => ({
  callLLM: mockCallLLM,
}));

// Mock db.js — vi.mock 工厂不能引用外部变量
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

// Mock memory-retriever.js
vi.mock('../memory-retriever.js', () => ({
  buildMemoryContext: vi.fn().mockResolvedValue({ block: '', meta: {} }),
  CHAT_TOKEN_BUDGET: 2500,
}));

// Mock user-profile.js — 阻止副作用
const mockGetUserProfileContext = vi.hoisted(() => vi.fn().mockResolvedValue(''));
vi.mock('../user-profile.js', () => ({
  extractAndSaveUserFacts: vi.fn().mockResolvedValue(undefined),
  getUserProfileContext: mockGetUserProfileContext,
}));

// Mock self-model.js
vi.mock('../self-model.js', () => ({
  getSelfModel: vi.fn().mockResolvedValue('保护型，追求精确'),
  updateSelfModel: vi.fn().mockResolvedValue(undefined),
  initSeed: vi.fn().mockResolvedValue(undefined),
}));

// Mock memory-utils.js
vi.mock('../memory-utils.js', () => ({
  generateL0Summary: vi.fn().mockReturnValue('summary'),
  generateMemoryStreamL1Async: vi.fn(),
}));

// Import after mocks
import pool from '../db.js';
import { buildMemoryContext } from '../memory-retriever.js';
import {
  handleChat,
  callWithHistory,
  stripThinking,
  fetchMemoryContext,
  recordChatEvent,
  buildStatusSummary,
  buildDesiresContext,
  _resetApiKey,
} from '../orchestrator-chat.js';

// callLLM 响应工厂函数
function llmResp(text) {
  return { text, model: 'test-model', provider: 'test', elapsed_ms: 10 };
}

describe('orchestrator-chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLLM.mockReset();
    pool.query.mockReset();
    _resetApiKey();

    // 默认 mock pool.query
    pool.query.mockResolvedValue({ rows: [] });
  });

  // ===================== D1: 端点基本功能 =====================

  describe('handleChat - basic', () => {
    it('任意消息直接调 LLM，返回 reply', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp('我在想这件事。'));

      const result = await handleChat('你好吗？');

      expect(result).toHaveProperty('reply');
      expect(result.reply).toBe('我在想这件事。');
      expect(mockCallLLM).toHaveBeenCalled();
    });

    it('LLM 失败时返回兜底文字', async () => {
      mockCallLLM.mockRejectedValueOnce(new Error('timeout'));

      const result = await handleChat('你好');

      expect(result).toHaveProperty('reply');
      expect(result.reply).toBe('（此刻有些恍神，稍后再聊）');
    });

    it('throws error for empty message', async () => {
      await expect(handleChat('')).rejects.toThrow('message is required');
      await expect(handleChat(null)).rejects.toThrow('message is required');
    });

    it('返回值只有 reply，不包含 routing_level 或 intent', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp('好的。'));

      const result = await handleChat('帮我看看');

      expect(result).toHaveProperty('reply');
      expect(result).not.toHaveProperty('routing_level');
      expect(result).not.toHaveProperty('intent');
    });
  });

  // ===================== D2: 记忆系统集成 =====================

  describe('fetchMemoryContext', () => {
    it('returns memory block from buildMemoryContext', async () => {
      buildMemoryContext.mockResolvedValueOnce({
        block: '\n## 相关历史上下文\n- [任务] **任务管理系统**: 实现了任务调度\n',
        meta: { candidates: 2, injected: 1, tokenUsed: 50 },
      });

      const block = await fetchMemoryContext('任务管理');

      expect(block).toContain('相关历史上下文');
      expect(block).toContain('任务管理系统');
      expect(buildMemoryContext).toHaveBeenCalledWith(
        expect.objectContaining({ query: '任务管理', mode: 'chat' })
      );
    });

    it('returns empty string when buildMemoryContext returns empty block', async () => {
      buildMemoryContext.mockResolvedValueOnce({
        block: '',
        meta: { candidates: 0, injected: 0 },
      });

      const block = await fetchMemoryContext('随机查询');
      expect(block).toBe('');
    });

    it('returns empty string on error (graceful)', async () => {
      buildMemoryContext.mockRejectedValueOnce(new Error('DB error'));

      const block = await fetchMemoryContext('测试');
      expect(block).toBe('');
    });

    it('returns empty string for empty query', async () => {
      const block = await fetchMemoryContext('');
      expect(block).toBe('');
      expect(buildMemoryContext).not.toHaveBeenCalled();
    });
  });

  describe('recordChatEvent', () => {
    it('records chat event to cecelia_events', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await recordChatEvent('你好', '你好！有什么需要帮助的吗？', {
        conversation_id: null,
      });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO cecelia_events'),
        expect.arrayContaining(['orchestrator_chat'])
      );
    });

    it('does not throw on DB error (graceful)', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB connection failed'));

      await expect(
        recordChatEvent('test', 'reply', {})
      ).resolves.toBeUndefined();
    });

    it('stores full message without truncation (D4)', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const longMessage = 'A'.repeat(1000);
      const longReply = 'B'.repeat(500);

      await recordChatEvent(longMessage, longReply, {});

      const callArgs = pool.query.mock.calls[0];
      const payload = JSON.parse(callArgs[1][2]);
      expect(payload.user_message).toBe(longMessage);
      expect(payload.user_message).toHaveLength(1000);
      expect(payload.reply).toBe(longReply);
      expect(payload.reply).toHaveLength(500);
    });

    it('uses reply key not reply_preview (D4)', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await recordChatEvent('消息', '回复内容', {});

      const callArgs = pool.query.mock.calls[0];
      const payload = JSON.parse(callArgs[1][2]);
      expect(payload).toHaveProperty('reply');
      expect(payload).not.toHaveProperty('reply_preview');
    });
  });

  // ===================== D3: 多轮历史上下文 =====================

  describe('handleChat - multi-turn history', () => {
    it('passes messages to callWithHistory', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp('记得，你叫小明。'));

      const history = [
        { role: 'user', content: '我叫小明' },
        { role: 'assistant', content: '你好，小明！' },
      ];

      const result = await handleChat('你还记得我叫什么吗', {}, history);

      expect(result.reply).toBe('记得，你叫小明。');

      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).toContain('我叫小明');
      expect(prompt).toContain('Alex：你还记得我叫什么吗');
    });

    it('works without history (backward compatible)', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp('你好！'));

      const result = await handleChat('你好');
      expect(result.reply).toBe('你好！');

      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).toContain('你是 Cecelia');
      expect(prompt).toContain('Alex：你好');
    });
  });

  // ===================== D4: 始终注入状态 =====================

  describe('handleChat - always inject status', () => {
    it('任意消息都注入系统状态', async () => {
      pool.query.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('FROM tasks GROUP BY status')) {
          return Promise.resolve({ rows: [{ status: 'in_progress', cnt: 2 }] });
        }
        if (typeof sql === 'string' && sql.includes('FROM goals GROUP BY status')) {
          return Promise.resolve({ rows: [{ status: 'active', cnt: 1 }] });
        }
        return Promise.resolve({ rows: [] });
      });

      mockCallLLM.mockResolvedValueOnce(llmResp('好的。'));

      const result = await handleChat('帮我创建一个任务');

      expect(result.reply).toBe('好的。');
      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).toContain('当前系统状态');
    });
  });

  describe('handleChat - memory integration', () => {
    it('injects memory context into prompt', async () => {
      buildMemoryContext.mockResolvedValueOnce({
        block: '\n## 相关历史上下文\n- [任务] **历史任务**: 相关上下文\n',
        meta: { candidates: 1, injected: 1, tokenUsed: 50 },
      });

      mockCallLLM.mockResolvedValueOnce(llmResp('好的，我知道了。'));

      const result = await handleChat('告诉我关于任务系统的情况');

      expect(result.reply).toBe('好的，我知道了。');
      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).toContain('相关历史上下文');
    });
  });

  // ===================== 辅助函数测试 =====================

  describe('buildStatusSummary', () => {
    it('returns formatted status summary', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { status: 'completed', cnt: 10 },
            { status: 'in_progress', cnt: 3 },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            { status: 'active', cnt: 2 },
          ],
        });

      const summary = await buildStatusSummary();

      expect(summary).toContain('当前系统状态');
      expect(summary).toContain('任务');
      expect(summary).toContain('目标');
    });

    it('returns empty string on DB error', async () => {
      pool.query.mockRejectedValueOnce(new Error('connection refused'));

      const summary = await buildStatusSummary();
      expect(summary).toBe('');
    });
  });

  describe('buildDesiresContext', () => {
    it('returns formatted desires block when desires exist', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { type: 'concern', content: 'dev tasks failing with no report', urgency: 10 },
          { type: 'goal', content: '完成 work streams API', urgency: 6 },
        ],
      });

      const result = await buildDesiresContext();

      expect(result).toContain('内心状态');
      expect(result).toContain('concern');
      expect(result).toContain('dev tasks failing with no report');
      expect(result).toContain('urgency:10');
      expect(result).toContain('🔴');
    });

    it('returns empty string when no pending desires', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await buildDesiresContext();

      expect(result).toBe('');
    });

    it('returns empty string on DB error (fire-safe)', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB connection failed'));

      const result = await buildDesiresContext();

      expect(result).toBe('');
    });
  });

  describe('callWithHistory', () => {
    it('calls callLLM("mouth", ...) with system prompt and user message', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp('测试回复'));

      const result = await callWithHistory('你好', '系统提示');

      expect(result.reply).toBe('测试回复');
      expect(result.usage).toBeDefined();

      expect(mockCallLLM).toHaveBeenCalledWith(
        'mouth',
        expect.stringContaining('系统提示'),
        expect.objectContaining({ maxTokens: 2048 }),
      );
      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).toContain('Alex：你好');
    });

    it('includes history in prompt', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp('记得，你叫小明。'));

      const history = [
        { role: 'user', content: '我叫小明' },
        { role: 'assistant', content: '你好，小明！' },
      ];

      const result = await callWithHistory('你还记得我叫什么吗', '系统提示', {}, history);

      expect(result.reply).toBe('记得，你叫小明。');

      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).toContain('对话历史');
      expect(prompt).toContain('我叫小明');
      expect(prompt).toContain('你好，小明');
      expect(prompt).toContain('Alex：你还记得我叫什么吗');
    });

    it('limits history to last 10 messages', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp('好的'));

      const history = Array.from({ length: 12 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `历史消息第${i + 1}条`,
      }));

      await callWithHistory('新消息', '系统提示', {}, history);

      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).not.toContain('历史消息第1条');
      expect(prompt).not.toContain('历史消息第2条');
      expect(prompt).toContain('历史消息第3条');
      expect(prompt).toContain('历史消息第12条');
    });

    it('returns text from callLLM response', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp('实际回复内容'));

      const result = await callWithHistory('你好', '系统提示');

      expect(result.reply).toBe('实际回复内容');
    });

    it('throws on callLLM error', async () => {
      mockCallLLM.mockRejectedValueOnce(new Error('Bridge /llm-call error: 500'));

      await expect(callWithHistory('test', 'prompt')).rejects.toThrow('Bridge /llm-call error: 500');
    });
  });

  describe('stripThinking', () => {
    it('strips <think> blocks from MiniMax response', () => {
      const input = '<think>\n这是思维链内容，不应显示给用户\n</think>你好！有什么需要帮助的吗？';
      expect(stripThinking(input)).toBe('你好！有什么需要帮助的吗？');
    });

    it('returns text as-is when no think blocks', () => {
      const input = '你好！有什么需要帮助的吗？';
      expect(stripThinking(input)).toBe('你好！有什么需要帮助的吗？');
    });

    it('handles content passthrough', () => {
      const input = '直接回复内容';
      expect(stripThinking(input)).toBe('直接回复内容');
    });

    it('handles empty/null input', () => {
      expect(stripThinking('')).toBe('');
      expect(stripThinking(null)).toBe('');
    });
  });

  // ===================== D10: 用户画像注入 =====================

  describe('handleChat profile context injection', () => {
    it('profileSnippet 注入到 systemPrompt', async () => {
      mockGetUserProfileContext.mockResolvedValueOnce('## 主人信息\n你正在和 徐啸 对话。TA 目前的重点方向是：Cecelia 自主运行。\n');

      mockCallLLM.mockResolvedValueOnce(llmResp('你好，徐啸！'));

      const result = await handleChat('你好');

      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).toContain('## 主人信息');
      expect(prompt).toContain('徐啸');
      expect(prompt).toContain('Cecelia 自主运行');
      expect(result.reply).toBe('你好，徐啸！');
    });

    it('profileSnippet 为空时 systemPrompt 仍包含身份描述', async () => {
      mockGetUserProfileContext.mockResolvedValueOnce('');

      mockCallLLM.mockResolvedValueOnce(llmResp('我是 Cecelia。'));

      await handleChat('你好');

      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).toContain('你是 Cecelia');
      expect(prompt).not.toContain('## 主人信息');
    });
  });
});
