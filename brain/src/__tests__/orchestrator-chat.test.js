/**
 * Orchestrator Chat Tests
 * 测试 Cecelia 嘴巴对话链路
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

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

// Mock memory-retriever.js (fetchMemoryContext now uses buildMemoryContext directly)
vi.mock('../memory-retriever.js', () => ({
  buildMemoryContext: vi.fn().mockResolvedValue({ block: '', meta: {} }),
}));

// Mock user-profile.js — 阻止副作用，getUserProfileContext 默认返回 ''
const mockGetUserProfileContext = vi.hoisted(() => vi.fn().mockResolvedValue(''));
vi.mock('../user-profile.js', () => ({
  extractAndSaveUserFacts: vi.fn().mockResolvedValue(undefined),
  getUserProfileContext: mockGetUserProfileContext,
}));

// Mock chat-action-dispatcher.js — 默认不执行动作（各测试按需覆盖）
const mockDetectAndExecuteAction = vi.hoisted(() => vi.fn().mockResolvedValue(''));
vi.mock('../chat-action-dispatcher.js', () => ({
  detectAndExecuteAction: mockDetectAndExecuteAction,
}));

// Import after mocks
import pool from '../db.js';
import { processEvent as thalamusProcessEvent } from '../thalamus.js';
import { parseIntent } from '../intent.js';
import { buildMemoryContext } from '../memory-retriever.js';
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
      // Mock MiniMax call (memory now uses buildMemoryContext mock, not fetch)
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
      // MiniMax returns ESCALATE (memory uses buildMemoryContext mock)
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
      // MiniMax fails (memory uses buildMemoryContext mock)
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

  // ===================== D5: 多轮历史上下文 =====================

  describe('handleChat - multi-turn history (D2)', () => {
    it('passes messages to callMiniMax', async () => {
      // MiniMax call (memory uses buildMemoryContext mock)
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '记得，你叫小明。' } }],
          usage: {},
        }),
      });

      const history = [
        { role: 'user', content: '我叫小明' },
        { role: 'assistant', content: '你好，小明！' },
      ];

      const result = await handleChat('你还记得我叫什么吗', {}, history);

      expect(result.reply).toBe('记得，你叫小明。');

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      // system + 2 history + user = 4
      expect(body.messages).toHaveLength(4);
      expect(body.messages[1]).toEqual({ role: 'user', content: '我叫小明' });
    });

    it('works without history (backward compatible)', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '你好！' } }],
          usage: {},
        }),
      });

      const result = await handleChat('你好');
      expect(result.reply).toBe('你好！');

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.messages).toHaveLength(2); // system + user only
    });
  });

  // ===================== D3: 始终注入状态 =====================

  describe('handleChat - always inject status (D3)', () => {
    it('injects status for CREATE_TASK intent (not just QUERY_STATUS/QUESTION)', async () => {
      parseIntent.mockReturnValueOnce({ type: 'CREATE_TASK', confidence: 0.9 });

      // buildStatusSummary needs pool.query mocks
      pool.query
        .mockResolvedValueOnce({ rows: [{ status: 'in_progress', cnt: 2 }] }) // tasks
        .mockResolvedValueOnce({ rows: [{ status: 'active', cnt: 1 }] })      // goals
        .mockResolvedValueOnce({ rows: [] });                                  // recordChatEvent

      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '好的，我来创建任务。' } }],
          usage: {},
        }),
      });

      const result = await handleChat('帮我创建一个任务');

      expect(result.reply).toBe('好的，我来创建任务。');

      // 验证 system prompt 包含状态（无论 intent 类型）
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      const systemMsg = body.messages.find(m => m.role === 'system');
      expect(systemMsg.content).toContain('当前系统状态');
    });
  });

  describe('handleChat - memory integration', () => {
    it('injects memory context into MiniMax prompt', async () => {
      // Memory returns block via buildMemoryContext
      buildMemoryContext.mockResolvedValueOnce({
        block: '\n## 相关历史上下文\n- [任务] **历史任务**: 相关上下文\n',
        meta: { candidates: 1, injected: 1, tokenUsed: 50 },
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
      const minimaxCall = global.fetch.mock.calls[0];
      const body = JSON.parse(minimaxCall[1].body);
      const systemMsg = body.messages.find(m => m.role === 'system');
      expect(systemMsg.content).toContain('相关历史上下文');
    });
  });

  // ===================== D4: 错误处理 =====================

  describe('handleChat - error handling', () => {
    it('handles MiniMax failure gracefully with thalamus fallback', async () => {
      // MiniMax network error (memory uses buildMemoryContext mock)
      global.fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      // Thalamus also fails
      thalamusProcessEvent.mockRejectedValueOnce(new Error('API key not set'));

      const result = await handleChat('测试');

      expect(result.routing_level).toBe(-1);
      expect(result.reply).toContain('遇到了一些问题');
    });

    it('handles both MiniMax and thalamus failure', async () => {
      // MiniMax fails (memory uses buildMemoryContext mock)
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
      expect(body.model).toBe('MiniMax-M2.5-highspeed');
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1].role).toBe('user');
    });

    it('inserts history messages between system and user (D1)', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '记得，你叫小明。' } }],
          usage: { total_tokens: 80 },
        }),
      });

      const history = [
        { role: 'user', content: '我叫小明' },
        { role: 'assistant', content: '你好，小明！' },
      ];

      const result = await callMiniMax('你还记得我叫什么吗', '系统提示', {}, history);

      expect(result.reply).toBe('记得，你叫小明。');

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.messages).toHaveLength(4); // system + 2 history + user
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1]).toEqual({ role: 'user', content: '我叫小明' });
      expect(body.messages[2]).toEqual({ role: 'assistant', content: '你好，小明！' });
      expect(body.messages[3]).toEqual({ role: 'user', content: '你还记得我叫什么吗' });
    });

    it('limits history to last 10 messages (D1)', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '好的' } }],
          usage: {},
        }),
      });

      // 12 条历史，应只取最后 10 条
      const history = Array.from({ length: 12 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `消息 ${i + 1}`,
      }));

      await callMiniMax('新消息', '系统提示', {}, history);

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      // system(1) + last 10 history + user(1) = 12
      expect(body.messages).toHaveLength(12);
      expect(body.messages[1].content).toBe('消息 3'); // 第3条（0-index=2）开始
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

  describe('handleChat action suffix (D9)', () => {
    it('D9: 动作回复追加到 reply 末尾', async () => {
      // MiniMax 返回正常回复
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '好的，我来帮你记录。' } }],
          usage: {},
        }),
      });

      // dispatcher 返回确认文本
      mockDetectAndExecuteAction.mockResolvedValueOnce('\n\n✅ 已创建任务：完成周报');

      const result = await handleChat('帮我记个任务：完成周报');

      expect(result.reply).toContain('好的，我来帮你记录。');
      expect(result.reply).toContain('✅ 已创建任务：完成周报');
      expect(mockDetectAndExecuteAction).toHaveBeenCalledWith('帮我记个任务：完成周报');
    });

    it('D9-2: 无动作意图时 reply 不变', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '你好！有什么需要帮助的吗？' } }],
          usage: {},
        }),
      });

      mockDetectAndExecuteAction.mockResolvedValueOnce('');

      const result = await handleChat('你好');

      expect(result.reply).toBe('你好！有什么需要帮助的吗？');
    });
  });

  // ===================== D10: 用户画像注入 =====================

  describe('handleChat profile context injection (D10)', () => {
    it('D10: profileSnippet 注入到 systemPrompt', async () => {
      // 让 getUserProfileContext 返回画像片段
      mockGetUserProfileContext.mockResolvedValueOnce('## 主人信息\n你正在和 徐啸 对话。TA 目前的重点方向是：Cecelia 自主运行。\n');

      let capturedSystemPrompt = '';
      global.fetch.mockImplementationOnce(async (url, opts) => {
        const body = JSON.parse(opts.body);
        capturedSystemPrompt = body.messages.find(m => m.role === 'system')?.content || '';
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '你好，徐啸！' } }],
            usage: {},
          }),
        };
      });

      const result = await handleChat('你好');

      expect(capturedSystemPrompt).toContain('## 主人信息');
      expect(capturedSystemPrompt).toContain('徐啸');
      expect(capturedSystemPrompt).toContain('Cecelia 自主运行');
      expect(result.reply).toBe('你好，徐啸！');
      expect(mockGetUserProfileContext).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.any(String));
    });

    it('D10-2: profileSnippet 为空时 systemPrompt 不受影响', async () => {
      mockGetUserProfileContext.mockResolvedValueOnce('');

      let capturedSystemPrompt = '';
      global.fetch.mockImplementationOnce(async (url, opts) => {
        const body = JSON.parse(opts.body);
        capturedSystemPrompt = body.messages.find(m => m.role === 'system')?.content || '';
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '我是 Cecelia。' } }],
            usage: {},
          }),
        };
      });

      await handleChat('你好');

      // systemPrompt 应以 MOUTH_SYSTEM_PROMPT 内容开头，无多余画像块
      expect(capturedSystemPrompt).toContain('你是 Cecelia');
      expect(capturedSystemPrompt).not.toContain('## 主人信息');
    });
  });
});
