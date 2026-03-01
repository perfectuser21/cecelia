/**
 * Orchestrator Chat Tests
 * 测试 Cecelia 嘴巴对话链路
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

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

// Mock memory-retriever.js (fetchMemoryContext now uses buildMemoryContext directly)
vi.mock('../memory-retriever.js', () => ({
  buildMemoryContext: vi.fn().mockResolvedValue({ block: '', meta: {} }),
  CHAT_TOKEN_BUDGET: 2500,
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

// Mock owner-input-extractor.js — DOD-6: 验证 fire-and-forget 调用
const mockExtractSuggestionsFromChat = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../owner-input-extractor.js', () => ({
  extractSuggestionsFromChat: mockExtractSuggestionsFromChat,
}));

// Mock self-model.js — 避免 getSelfModel/initSeed 产生额外 pool.query 调用
vi.mock('../self-model.js', () => ({
  getSelfModel: vi.fn().mockResolvedValue('保护型，追求精确'),
  updateSelfModel: vi.fn().mockResolvedValue(undefined),
  initSeed: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocks
import pool from '../db.js';
import { processEvent as thalamusProcessEvent } from '../thalamus.js';
import { parseIntent } from '../intent.js';
import { buildMemoryContext } from '../memory-retriever.js';
import {
  handleChat,
  callWithHistory,
  stripThinking,
  fetchMemoryContext,
  recordChatEvent,
  needsEscalation,
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
    // 明确重置 once-queue，防止上一个测试未消费的 mock 泄漏
    mockCallLLM.mockReset();
    pool.query.mockReset();
    _resetApiKey();

    // 默认 mock parseIntent
    parseIntent.mockReturnValue({ type: 'QUESTION', confidence: 0.8 });

    // 默认 mock pool.query（用于 recordChatEvent）
    pool.query.mockResolvedValue({ rows: [] });
  });

  // 辅助：mock pool.query 使 retrieveCeceliaVoice 返回叙事内容（触发传声器 LLM 调用）
  function withNarratives(content = '今天我感到专注，工作有序推进。') {
    pool.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes("source_type = 'narrative'")) {
        return Promise.resolve({ rows: [{ content }] });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  // ===================== D1: 端点基本功能 =====================

  describe('handleChat - basic', () => {
    it('returns reply from MiniMax for simple queries', async () => {
      // 检索优先：提供叙事内容 → LLM 被调用（传声器模式）
      withNarratives('当前系统运行正常，有 5 个任务在进行中。');
      mockCallLLM.mockResolvedValueOnce(llmResp('当前有 5 个任务在进行中。'));

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
      // 检索优先：提供叙事 → LLM 被调用 → LLM 返回 [ESCALATE] → 丘脑
      withNarratives('有很多任务失败，需要分析原因。');
      mockCallLLM.mockResolvedValueOnce(llmResp('[ESCALATE] 这个问题需要深度分析。'));

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
      // 检索优先：提供叙事 → LLM 被调用 → LLM 抛出错误 → 丘脑回退
      withNarratives('系统状态信息。');
      // callLLM throws → callWithHistory propagates error → handleChat falls back to thalamus
      mockCallLLM.mockRejectedValueOnce(new Error('Service unavailable'));

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
    it('passes messages to callWithHistory', async () => {
      // 检索优先：提供叙事 → LLM 被调用（传声器模式），history 包含在 prompt 中
      withNarratives('我叫小明这件事我记得。');
      mockCallLLM.mockResolvedValueOnce(llmResp('记得，你叫小明。'));

      const history = [
        { role: 'user', content: '我叫小明' },
        { role: 'assistant', content: '你好，小明！' },
      ];

      const result = await handleChat('你还记得我叫什么吗', {}, history);

      expect(result.reply).toBe('记得，你叫小明。');

      // callLLM('mouth', prompt, ...) — prompt 包含 history 和用户消息
      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).toContain('我叫小明');
      expect(prompt).toContain('Alex：你还记得我叫什么吗');
    });

    it('works without history (backward compatible)', async () => {
      // 动作意图走 MOUTH_SYSTEM_PROMPT 路径，不依赖叙事
      parseIntent.mockReturnValueOnce({ type: 'CREATE_TASK', confidence: 0.9 });
      mockCallLLM.mockResolvedValueOnce(llmResp('你好！'));

      const result = await handleChat('你好');
      expect(result.reply).toBe('你好！');

      // prompt 包含系统提示和用户消息
      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).toContain('你是 Cecelia');
      expect(prompt).toContain('Alex：你好');
    });
  });

  // ===================== D3: 始终注入状态 =====================

  describe('handleChat - always inject status (D3)', () => {
    it('injects status for CREATE_TASK intent (not just QUERY_STATUS/QUESTION)', async () => {
      parseIntent.mockReturnValueOnce({ type: 'CREATE_TASK', confidence: 0.9 });

      // pool.query 真实调用顺序（动作意图）：
      // 1,2=working_memory/memory_stream INSERT（graceful，用默认 rows:[]）
      // 3,4=buildStatusSummary（Promise.all → tasks + goals）
      // 5=buildDesiresContext; 6=pending_actions
      // 7=callLLM（非 pool.query）; 8=recordChatEvent
      pool.query.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('FROM tasks GROUP BY status')) {
          return Promise.resolve({ rows: [{ status: 'in_progress', cnt: 2 }] });
        }
        if (typeof sql === 'string' && sql.includes('FROM goals GROUP BY status')) {
          return Promise.resolve({ rows: [{ status: 'active', cnt: 1 }] });
        }
        return Promise.resolve({ rows: [] });
      });

      mockCallLLM.mockResolvedValueOnce(llmResp('好的，我来创建任务。'));

      const result = await handleChat('帮我创建一个任务');

      expect(result.reply).toBe('好的，我来创建任务。');

      // 验证 prompt 包含状态（无论 intent 类型）
      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).toContain('当前系统状态');
    });
  });

  describe('handleChat - memory integration', () => {
    it('injects memory context into MiniMax prompt for action intents', async () => {
      // 动作意图使用 MOUTH_SYSTEM_PROMPT，memoryBlock 会被注入到 prompt
      parseIntent.mockReturnValueOnce({ type: 'CREATE_TASK', confidence: 0.9 });
      buildMemoryContext.mockResolvedValueOnce({
        block: '\n## 相关历史上下文\n- [任务] **历史任务**: 相关上下文\n',
        meta: { candidates: 1, injected: 1, tokenUsed: 50 },
      });

      mockCallLLM.mockResolvedValueOnce(llmResp('好的，我知道了。'));

      const result = await handleChat('告诉我关于任务系统的情况');

      expect(result.reply).toBe('好的，我知道了。');
      expect(result.routing_level).toBe(0);

      // 验证 callLLM prompt 中包含记忆上下文
      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).toContain('相关历史上下文');
    });
  });

  // ===================== D4: 错误处理 =====================

  describe('handleChat - error handling', () => {
    it('handles MiniMax failure gracefully with thalamus fallback', async () => {
      // 检索优先：提供叙事 → LLM 被调用 → LLM 抛出 → 丘脑回退 → 丘脑也失败
      withNarratives('系统信息。');
      mockCallLLM.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      thalamusProcessEvent.mockRejectedValueOnce(new Error('API key not set'));

      const result = await handleChat('测试');

      expect(result.routing_level).toBe(-1);
      expect(result.reply).toContain('遇到了一些问题');
    });

    it('handles both MiniMax and thalamus failure', async () => {
      // 检索优先：提供叙事 → LLM 被调用 → LLM 抛出 → 丘脑也失败
      withNarratives('系统信息。');
      mockCallLLM.mockRejectedValueOnce(new Error('timeout'));
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
    it('calls callLLM("mouth", ...) with system prompt and user message (D1, D2)', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp('测试回复'));

      const result = await callWithHistory('你好', '系统提示');

      expect(result.reply).toBe('测试回复');
      expect(result.usage).toBeDefined();

      // 验证 callLLM 被正确调用
      expect(mockCallLLM).toHaveBeenCalledWith(
        'mouth',
        expect.stringContaining('系统提示'),
        expect.objectContaining({ maxTokens: 2048 }),
      );
      // prompt 末尾包含用户消息
      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).toContain('Alex：你好');
    });

    it('includes history in prompt (D1)', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp('记得，你叫小明。'));

      const history = [
        { role: 'user', content: '我叫小明' },
        { role: 'assistant', content: '你好，小明！' },
      ];

      const result = await callWithHistory('你还记得我叫什么吗', '系统提示', {}, history);

      expect(result.reply).toBe('记得，你叫小明。');

      // prompt 中包含历史消息
      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).toContain('对话历史');
      expect(prompt).toContain('我叫小明');
      expect(prompt).toContain('你好，小明');
      expect(prompt).toContain('Alex：你还记得我叫什么吗');
    });

    it('limits history to last 10 messages (D1)', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp('好的'));

      // 12 条历史，应只取最后 10 条
      const history = Array.from({ length: 12 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `历史消息第${i + 1}条`,
      }));

      await callWithHistory('新消息', '系统提示', {}, history);

      const prompt = mockCallLLM.mock.calls[0][1];
      // 最后 10 条 = 第3~12条（跳过第1和第2条）
      expect(prompt).not.toContain('历史消息第1条');
      expect(prompt).not.toContain('历史消息第2条');
      expect(prompt).toContain('历史消息第3条');
      expect(prompt).toContain('历史消息第12条');
    });

    it('returns text from callLLM response (D3)', async () => {
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

    it('handles content passthrough (D3)', () => {
      const input = '直接回复内容';
      expect(stripThinking(input)).toBe('直接回复内容');
    });

    it('handles empty/null input', () => {
      expect(stripThinking('')).toBe('');
      expect(stripThinking(null)).toBe('');
    });
  });

  describe('handleChat action suffix (D9)', () => {
    it('D9: 动作回复追加到 reply 末尾', async () => {
      // 动作意图：使用 MOUTH_SYSTEM_PROMPT，detectAndExecuteAction 在步骤 4 执行
      // 非动作意图也有 fallback detectAndExecuteAction（步骤 7）
      // 测试步骤 7 fallback：QUESTION 意图 + 叙事内容 → LLM 回复 + 动作追加
      withNarratives('今天我帮助了很多任务管理。');
      mockCallLLM.mockResolvedValueOnce(llmResp('好的，我来帮你记录。'));

      // dispatcher 返回确认文本（步骤 7 fallback）
      mockDetectAndExecuteAction.mockResolvedValueOnce('\n\n✅ 已创建任务：完成周报');

      const result = await handleChat('帮我记个任务：完成周报');

      expect(result.reply).toContain('好的，我来帮你记录。');
      expect(result.reply).toContain('✅ 已创建任务：完成周报');
      expect(mockDetectAndExecuteAction).toHaveBeenCalledWith('帮我记个任务：完成周报');
    });

    it('D9-2: 无动作意图时 reply 不变', async () => {
      // 非动作意图 + 叙事 → LLM 回复，detectAndExecuteAction 返回空
      withNarratives('今天系统正常运行。');
      mockCallLLM.mockResolvedValueOnce(llmResp('你好！有什么需要帮助的吗？'));
      mockDetectAndExecuteAction.mockResolvedValueOnce('');

      const result = await handleChat('你好');

      expect(result.reply).toBe('你好！有什么需要帮助的吗？');
    });
  });

  // ===================== D10: 用户画像注入 =====================

  describe('handleChat profile context injection (D10)', () => {
    it('D10: profileSnippet 注入到 systemPrompt（动作意图）', async () => {
      // 动作意图使用 MOUTH_SYSTEM_PROMPT，profileSnippet 会被注入
      parseIntent.mockReturnValueOnce({ type: 'CREATE_TASK', confidence: 0.9 });
      mockGetUserProfileContext.mockResolvedValueOnce('## 主人信息\n你正在和 徐啸 对话。TA 目前的重点方向是：Cecelia 自主运行。\n');

      mockCallLLM.mockResolvedValueOnce(llmResp('你好，徐啸！'));

      const result = await handleChat('你好');

      // 验证 callLLM prompt 包含画像信息
      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).toContain('## 主人信息');
      expect(prompt).toContain('徐啸');
      expect(prompt).toContain('Cecelia 自主运行');
      expect(result.reply).toBe('你好，徐啸！');
      expect(mockGetUserProfileContext).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.any(String));
    });

    it('D10-2: profileSnippet 为空时 systemPrompt 不受影响（动作意图）', async () => {
      // 动作意图使用 MOUTH_SYSTEM_PROMPT，无画像时仍包含系统提示
      parseIntent.mockReturnValueOnce({ type: 'CREATE_TASK', confidence: 0.9 });
      mockGetUserProfileContext.mockResolvedValueOnce('');

      mockCallLLM.mockResolvedValueOnce(llmResp('我是 Cecelia。'));

      await handleChat('你好');

      // prompt 应包含 MOUTH_SYSTEM_PROMPT 内容，无多余画像块
      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).toContain('你是 Cecelia');
      expect(prompt).not.toContain('## 主人信息');
    });
  });

  // ===================== D11: DOD-6 owner-input-extractor fire-and-forget =====================

  describe('DOD-6: handleChat 触发 extractSuggestionsFromChat（fire-and-forget）', () => {
    it('handleChat 返回后 extractSuggestionsFromChat 被异步调用', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp('好的，我来处理。'));

      await handleChat('帮我创建一个任务');

      // flushPromises：等待 Promise.resolve().then() 微任务执行
      await Promise.resolve();

      expect(mockExtractSuggestionsFromChat).toHaveBeenCalledTimes(1);
    });

    it('extractSuggestionsFromChat 接收正确的 message 参数', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp('收到。'));

      const message = '想做一个 AI 学习项目';
      await handleChat(message);
      await Promise.resolve();

      const [calledMessage] = mockExtractSuggestionsFromChat.mock.calls[0];
      expect(calledMessage).toBe(message);
    });

    it('extractSuggestionsFromChat 失败时不影响 handleChat 返回值', async () => {
      // 提供叙事内容 → LLM 被调用 → 返回 '好的。'
      withNarratives('测试叙事内容。');
      mockCallLLM.mockResolvedValueOnce(llmResp('好的。'));
      mockExtractSuggestionsFromChat.mockRejectedValueOnce(new Error('suggestion failed'));

      const result = await handleChat('测试消息');
      await Promise.resolve();

      expect(result).toHaveProperty('reply', '好的。');
    });
  });
});
