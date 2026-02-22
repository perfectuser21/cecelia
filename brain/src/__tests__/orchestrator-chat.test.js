/**
 * Orchestrator Chat Tests
 * 测试 Cecelia 嘴巴对话链路
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js — vi.mock 工厂不能引用外部变量
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

// Mock thalamus.js
vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn(),
  EVENT_TYPES: {
    USER_MESSAGE: 'USER_MESSAGE',
    TASK_COMPLETED: 'TASK_COMPLETED',
    TASK_FAILED: 'TASK_FAILED',
    TICK: 'TICK',
    HEARTBEAT: 'HEARTBEAT',
  },
}));

// Mock intent.js
vi.mock('../intent.js', () => ({
  parseIntent: vi.fn(),
  INTENT_TYPES: {
    QUERY_STATUS: 'QUERY_STATUS',
    QUESTION: 'QUESTION',
    CREATE_TASK: 'CREATE_TASK',
    UNKNOWN: 'UNKNOWN',
  },
}));

// Mock fs for credentials
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => JSON.stringify({ api_key: 'test-key' })),
}));

// Import after mocks
import pool from '../db.js';
import { processEvent as thalamusProcessEvent } from '../thalamus.js';
import { parseIntent } from '../intent.js';
import {
  handleChat,
  callMiniMax,
  stripThinking,
  fetchMemoryContext,
  recordChatEvent,
  needsEscalation,
  buildStatusSummary,
  _resetApiKey,
} from '../orchestrator-chat.js';

// Mock fetch globally
const originalFetch = global.fetch;

describe('orchestrator-chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetApiKey();
    global.fetch = vi.fn();

    // 默认 mock parseIntent
    parseIntent.mockReturnValue({ type: 'QUESTION', confidence: 0.8 });

    // 默认 mock pool.query（用于 recordChatEvent）
    pool.query.mockResolvedValue({ rows: [] });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  // ===================== D1: 端点基本功能 =====================

  describe('handleChat - basic', () => {
    it('returns reply from MiniMax for simple queries', async () => {
      // Mock memory search
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ matches: [] }),
      });

      // Mock MiniMax call
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '当前有 5 个任务在进行中。' } }],
          usage: { total_tokens: 100 },
        }),
      });

      const result = await handleChat('现在有多少任务？');

      expect(result).toHaveProperty('reply');
      expect(result).toHaveProperty('routing_level');
      expect(result).toHaveProperty('intent');
      expect(result.reply).toBe('当前有 5 个任务在进行中。');
      expect(result.routing_level).toBe(0);
    });

    it('throws error for empty message', async () => {
      await expect(handleChat('')).rejects.toThrow('message is required');
      await expect(handleChat(null)).rejects.toThrow('message is required');
    });
  });

  // ===================== D2: 意图路由 =====================

  describe('handleChat - routing', () => {
    it('routes complex queries to thalamus when MiniMax returns [ESCALATE]', async () => {
      // Memory search
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ matches: [] }),
      });

      // MiniMax returns ESCALATE
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '[ESCALATE] 这个问题需要深度分析。' } }],
          usage: {},
        }),
      });

      // Thalamus decision
      thalamusProcessEvent.mockResolvedValueOnce({
        level: 1,
        actions: [{ type: 'analyze_failure', params: {} }],
        rationale: '需要分析任务失败原因',
        confidence: 0.8,
      });

      const result = await handleChat('为什么最近任务失败率这么高？');

      expect(result.routing_level).toBe(1);
      expect(result.reply).toContain('需要分析任务失败原因');
      expect(thalamusProcessEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'USER_MESSAGE',
          message: '为什么最近任务失败率这么高？',
          source: 'orchestrator_chat',
        })
      );
    });

    it('falls back to thalamus when MiniMax fails', async () => {
      // Memory search
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ matches: [] }),
      });

      // MiniMax fails
      global.fetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'Service unavailable',
      });

      // Thalamus decision
      thalamusProcessEvent.mockResolvedValueOnce({
        level: 1,
        actions: [{ type: 'no_action', params: {} }],
        rationale: '已记录用户查询',
        confidence: 0.7,
      });

      const result = await handleChat('帮我看看系统状态');

      expect(result.routing_level).toBe(1);
      expect(result.reply).toContain('已记录用户查询');
    });
  });

  // ===================== D3: 记忆系统集成 =====================

  describe('fetchMemoryContext', () => {
    it('returns formatted memory block when matches found', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          matches: [
            { title: '任务管理系统', similarity: 0.85, preview: '实现了任务调度' },
            { title: 'OKR 拆解', similarity: 0.72, preview: 'KR 到 Task 的拆解' },
          ],
        }),
      });

      const block = await fetchMemoryContext('任务管理');

      expect(block).toContain('相关历史记忆');
      expect(block).toContain('任务管理系统');
      expect(block).toContain('0.85');
      expect(block).toContain('OKR 拆解');
    });

    it('returns empty string when no matches', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ matches: [] }),
      });

      const block = await fetchMemoryContext('随机查询');
      expect(block).toBe('');
    });

    it('returns empty string on fetch failure (graceful)', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      const block = await fetchMemoryContext('测试');
      expect(block).toBe('');
    });

    it('returns empty string for empty query', async () => {
      const block = await fetchMemoryContext('');
      expect(block).toBe('');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('recordChatEvent', () => {
    it('records chat event to cecelia_events', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await recordChatEvent('你好', '你好！有什么需要帮助的吗？', {
        intent: 'QUESTION',
        routing_level: 0,
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
  });

  describe('handleChat - memory integration', () => {
    it('injects memory context into MiniMax prompt', async () => {
      // Memory search returns matches
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          matches: [
            { title: '历史任务', similarity: 0.9, preview: '相关上下文' },
          ],
        }),
      });

      // MiniMax call
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '好的，我知道了。' } }],
          usage: {},
        }),
      });

      const result = await handleChat('告诉我关于任务系统的情况');

      expect(result.reply).toBe('好的，我知道了。');
      expect(result.routing_level).toBe(0);

      // 验证 MiniMax 调用中的 system prompt 包含记忆
      const minimaxCall = global.fetch.mock.calls[1];
      const body = JSON.parse(minimaxCall[1].body);
      const systemMsg = body.messages.find(m => m.role === 'system');
      expect(systemMsg.content).toContain('相关历史记忆');
    });
  });

  // ===================== D4: 错误处理 =====================

  describe('handleChat - error handling', () => {
    it('handles MiniMax failure gracefully with thalamus fallback', async () => {
      // Memory search
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ matches: [] }),
      });

      // MiniMax network error
      global.fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      // Thalamus also fails
      thalamusProcessEvent.mockRejectedValueOnce(new Error('API key not set'));

      const result = await handleChat('测试');

      expect(result.routing_level).toBe(-1);
      expect(result.reply).toContain('遇到了一些问题');
    });

    it('handles both MiniMax and thalamus failure', async () => {
      // Memory search fails
      global.fetch.mockRejectedValueOnce(new Error('timeout'));

      // MiniMax fails
      global.fetch.mockRejectedValueOnce(new Error('timeout'));

      // Thalamus fails
      thalamusProcessEvent.mockRejectedValueOnce(new Error('timeout'));

      const result = await handleChat('你好');

      expect(result).toHaveProperty('reply');
      expect(result.routing_level).toBe(-1);
    });
  });

  // ===================== 辅助函数测试 =====================

  describe('needsEscalation', () => {
    it('returns true for [ESCALATE] prefix', () => {
      expect(needsEscalation('[ESCALATE] 需要深度分析')).toBe(true);
    });

    it('returns false for normal replies', () => {
      expect(needsEscalation('你好，有什么可以帮助你的？')).toBe(false);
    });

    it('returns false for ESCALATE in middle', () => {
      expect(needsEscalation('我认为 [ESCALATE] 不需要')).toBe(false);
    });
  });

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

  describe('callMiniMax', () => {
    it('calls MiniMax API with correct URL and model (D1, D2)', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '测试回复' } }],
          usage: { total_tokens: 50 },
        }),
      });

      const result = await callMiniMax('你好', '系统提示');

      expect(result.reply).toBe('测试回复');
      expect(result.usage).toEqual({ total_tokens: 50 });

      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe('https://api.minimaxi.com/v1/chat/completions');
      const body = JSON.parse(options.body);
      expect(body.model).toBe('MiniMax-M2.5');
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1].role).toBe('user');
    });

    it('strips thinking block from reply (D3)', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '<think>\n思考过程...\n</think>\n\n实际回复内容' } }],
          usage: { total_tokens: 80 },
        }),
      });

      const result = await callMiniMax('你好', '系统提示');

      expect(result.reply).toBe('实际回复内容');
      expect(result.reply).not.toContain('<think>');
    });

    it('throws on API error', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(callMiniMax('test', 'prompt')).rejects.toThrow('MiniMax API error: 500');
    });
  });

  describe('stripThinking', () => {
    it('removes thinking block from content (D3)', () => {
      const input = '<think>\n分析用户问题...\n</think>\n\n你好！有什么需要帮助的吗？';
      expect(stripThinking(input)).toBe('你好！有什么需要帮助的吗？');
    });

    it('handles content without thinking block (D3)', () => {
      const input = '直接回复内容';
      expect(stripThinking(input)).toBe('直接回复内容');
    });

    it('handles empty thinking block (D3)', () => {
      const input = '<think></think>\n回复';
      expect(stripThinking(input)).toBe('回复');
    });

    it('handles empty/null input', () => {
      expect(stripThinking('')).toBe('');
      expect(stripThinking(null)).toBe('');
    });

    it('handles multiple thinking blocks', () => {
      const input = '<think>第一段</think>中间<think>第二段</think>结尾';
      expect(stripThinking(input)).toBe('中间结尾');
    });
  });
});
