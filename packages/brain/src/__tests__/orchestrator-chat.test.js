/**
 * Orchestrator Chat Tests
 * 测试 Cecelia 嘴巴对话链路（纯意识模式）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node:fs/promises（用于 buildManifestBlock 测试）
const mockReadFile = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
}));

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

// Mock executor.js — checkServerResources 返回低压力（默认正常模式）
vi.mock('../executor.js', () => ({
  checkServerResources: vi.fn().mockReturnValue({
    ok: true,
    effectiveSlots: 5,
    metrics: { max_pressure: 0.3 },
  }),
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
  buildRuntimeStateBlock,
  buildDesiresContext,
  callBrainApi,
  buildManifestBlock,
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

  describe('buildRuntimeStateBlock', () => {
    it('返回包含飞书发送时间的运行状态块', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { key: 'last_feishu_at', value_json: '2026-02-25T05:13:14.958Z' },
          { key: 'dispatch_ramp_state', value_json: { current_rate: 0 } },
          { key: 'tick_actions_today', value_json: { count: 62 } },
        ],
      });

      const block = await buildRuntimeStateBlock();

      expect(block).toContain('实时运行状态');
      expect(block).toContain('飞书最近发送时间');
      expect(block).toContain('2026');
      expect(block).toContain('今日已执行');
      expect(block).toContain('62');
    });

    it('last_feishu_at 为空时显示"从未"', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const block = await buildRuntimeStateBlock();

      expect(block).toContain('从未');
    });

    it('DB 查询失败时静默返回空字符串', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB error'));

      const block = await buildRuntimeStateBlock();

      expect(block).toBe('');
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
        expect.objectContaining({ maxTokens: 300 }),
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

  // ===================== D11: callBrainApi =====================

  describe('callBrainApi', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('成功调用 GET 端点返回数据', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ tasks: [] }),
        text: () => Promise.resolve(''),
      }));

      const result = await callBrainApi('/api/brain/tasks');

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ tasks: [] });
    });

    it('HTTP 错误时返回 success: false 含状态码', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'not found' }),
        text: () => Promise.resolve(''),
      }));

      const result = await callBrainApi('/api/brain/missing');

      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
    });

    it('网络异常时返回 success: false（不抛异常）', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

      const result = await callBrainApi('/api/brain/test');

      expect(result.success).toBe(false);
      expect(result.error).toBe('connection refused');
    });
  });

  // ===================== D12: buildManifestBlock =====================

  describe('buildManifestBlock', () => {
    it('读取 manifest 返回包含 Actions 和 Skills 的清单块', async () => {
      const manifest = {
        allActions: ['dispatch_task', 'create_task', 'cancel_task'],
        allSkills: ['dev', 'review', 'qa'],
        allSignals: ['task_fail_rate_24h'],
      };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(manifest));

      const block = await buildManifestBlock();

      expect(block).toContain('Brain 能力清单');
      expect(block).toContain('dispatch_task');
      expect(block).toContain('create_task');
      expect(block).toContain('dev');
      expect(block).toContain('review');
    });

    it('文件不存在时静默返回空字符串', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT: no such file or directory'));

      const block = await buildManifestBlock();

      expect(block).toBe('');
    });
  });

  // ===================== D13: call_brain_api 工具循环 =====================

  describe('handleChat - call_brain_api tool loop', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('LLM 返回 call_brain_api 信号时执行 API 调用并用结果重新问 LLM', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve([{ chat_id: 'chat_abc', name: '团队群' }]),
        text: () => Promise.resolve(''),
      });
      vi.stubGlobal('fetch', mockFetch);

      // 第一次 LLM 调用：返回 call_brain_api 信号
      mockCallLLM.mockResolvedValueOnce(llmResp(
        '{"reply": "让我查一下群列表", "thalamus_signal": {"type": "call_brain_api", "path": "/api/brain/feishu/groups"}}'
      ));
      // 第二次 LLM 调用：基于 API 结果回答
      mockCallLLM.mockResolvedValueOnce(llmResp('找到了，团队群的 chat_id 是 chat_abc。'));

      const result = await handleChat('能不能在群里打招呼？');

      // fetch 被调用（Brain API 查询）
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5221/api/brain/feishu/groups',
        expect.objectContaining({ method: 'GET' })
      );
      // 最终 reply 来自第二次 LLM 调用
      expect(result.reply).toBe('找到了，团队群的 chat_id 是 chat_abc。');
    });

    it('call_brain_api 网络失败时仍返回 reply（不崩溃）', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));

      mockCallLLM.mockResolvedValueOnce(llmResp(
        '{"reply": "让我查一下", "thalamus_signal": {"type": "call_brain_api", "path": "/api/brain/feishu/groups"}}'
      ));
      mockCallLLM.mockResolvedValueOnce(llmResp('查询失败了，不过我记录下来了。'));

      const result = await handleChat('能不能发消息？');

      expect(result).toHaveProperty('reply');
      expect(typeof result.reply).toBe('string');
      expect(result.reply.length).toBeGreaterThan(0);
    });
  });

  // ===================== D14: callWithHistory 文字+JSON 解析 =====================
  describe('callWithHistory - 文字+JSON 混合格式解析', () => {
    it('LLM 输出"文字\\nJSON"时正确提取 reply，不把 JSON 原文发给用户', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp(
        '让我换个角度直接查。\n{"reply": "查询发出去了，稍等。", "thalamus_signal": {"type": "create_task", "title": "test"}}'
      ));

      const result = await handleChat('帮我查一下状态');

      expect(result.reply).toBe('查询发出去了，稍等。');
      expect(result.reply).not.toContain('{');
      expect(result.reply).not.toContain('thalamus_signal');
    });

    it('LLM 输出纯 JSON 时仍正常解析', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp(
        '{"reply": "好的，已收到。", "thalamus_signal": null}'
      ));

      const result = await handleChat('收到了吗？');

      expect(result.reply).toBe('好的，已收到。');
    });

    it('LLM 输出纯文本（无 JSON）时全文作为 reply', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp('这是一段普通回复，没有 JSON。'));

      const result = await handleChat('随便问一下');

      expect(result.reply).toBe('这是一段普通回复，没有 JSON。');
    });
  });

  // ===================== D15: buildManifestBlock 飞书群注入 =====================

  describe('buildManifestBlock - 飞书群 ID 注入', () => {
    it('DB 有群记录时，manifest block 包含 group_id', async () => {
      const manifest = { allActions: ['create_task'], allSkills: ['dev'], allSignals: [] };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(manifest));

      // 注入 pool.query 返回群数据
      pool.query.mockResolvedValueOnce({
        rows: [
          { group_id: 'oc_test123', msg_count: '5', last_active_at: new Date('2026-03-04') },
        ],
      });

      const block = await buildManifestBlock();

      expect(block).toContain('oc_test123');
      expect(block).toContain('已知飞书群');
    });

    it('DB 无群记录时，manifest block 正常返回（不含群 group_id 列表）', async () => {
      const manifest = { allActions: ['create_task'], allSkills: ['dev'], allSignals: [] };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(manifest));
      pool.query.mockResolvedValueOnce({ rows: [] });

      const block = await buildManifestBlock();

      expect(block).toContain('Brain 能力清单');
      // 无群记录时不应出现"可直接用 group_id 发消息"的已知群列表段落
      expect(block).not.toContain('可直接用 group_id');
    });

    it('DB 查询异常时静默降级，仍返回 manifest block', async () => {
      const manifest = { allActions: ['create_task'], allSkills: ['dev'], allSignals: [] };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(manifest));
      pool.query.mockRejectedValueOnce(new Error('DB timeout'));

      const block = await buildManifestBlock();

      expect(block).toContain('Brain 能力清单');
      expect(block.length).toBeGreaterThan(0);
    });

    it('工具链结果注入提示允许继续调用，不含"不要再调用"硬性限制', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve([{ group_id: 'oc_abc', msg_count: 1, last_active_at: new Date() }]),
          text: () => Promise.resolve(''),
        })
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({ success: true }),
          text: () => Promise.resolve(''),
        })
      );

      // 第一次：LLM 返回 call_brain_api（GET groups）
      mockCallLLM.mockResolvedValueOnce(llmResp(
        '{"reply": "查一下群", "thalamus_signal": {"type": "call_brain_api", "path": "/api/brain/feishu/groups"}}'
      ));
      // 第二次：LLM 基于结果继续发消息（POST send）
      mockCallLLM.mockResolvedValueOnce(llmResp(
        '{"reply": "发出去了！", "thalamus_signal": {"type": "call_brain_api", "path": "/api/brain/feishu/send", "method": "POST", "body": {"group_id": "oc_abc", "text": "大家好"}}}'
      ));
      // 第三次：LLM 确认完成
      mockCallLLM.mockResolvedValueOnce(llmResp('消息已发送到群里。'));

      const result = await handleChat('给群里打个招呼');
      expect(result.reply).toBe('消息已发送到群里。');
    });
  });

  // ===================== D17: callWithHistory ```json 代码块包裹 JSON 解析 =====================

  describe('callWithHistory - ```json 代码块包裹 JSON 解析', () => {
    it('LLM 输出 ```json...``` 包裹时正确提取 reply 和 thalamus_signal', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp(
        '```json\n{"reply": "好，这就去。", "thalamus_signal": {"type": "call_brain_api", "path": "/api/brain/feishu/send", "body": {"open_id": "ou_123", "msg": "hi"}}}\n```'
      ));

      const result = await handleChat('去和苏彦卿打个招呼');

      expect(result.reply).toBe('好，这就去。');
      expect(result.reply).not.toContain('thalamus_signal');
      expect(result.reply).not.toContain('```');
    });

    it('LLM 输出 ```json...``` 时 thalamus_signal 被正确提取（直接测 callWithHistory 解析层）', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp(
        '```json\n{"reply": "收到。", "thalamus_signal": {"type": "call_brain_api", "path": "/api/brain/feishu/send"}}\n```'
      ));

      const result = await callWithHistory('发消息', '系统提示');

      expect(result.thalamus_signal).not.toBeNull();
      expect(result.thalamus_signal.type).toBe('call_brain_api');
    });

    it('LLM 输出裸 ``` 结尾（无 json 标记）时也能正确解析', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp(
        '{"reply": "明白了。", "thalamus_signal": null}\n```'
      ));

      const result = await handleChat('明白了吗');

      expect(result.reply).toBe('明白了。');
      expect(result.reply).not.toContain('```');
    });

    it('文字前缀 + ```json 包裹 JSON 时正确提取 reply', async () => {
      mockCallLLM.mockResolvedValueOnce(llmResp(
        '我来帮你发消息。\n```json\n{"reply": "已发送。", "thalamus_signal": {"type": "call_brain_api", "path": "/api/brain/feishu/send"}}\n```'
      ));

      const result = await handleChat('帮我发消息');

      expect(result.reply).toBe('已发送。');
      expect(result.reply).not.toContain('```');
      expect(result.thalamus_signal).not.toBeNull();
    });
  });

  // ===================== D16: buildManifestBlock 飞书成员注入 =====================

  describe('buildManifestBlock - 飞书成员 open_id 注入', () => {
    it('DB 有用户记录时，manifest block 包含 open_id 和姓名', async () => {
      const manifest = { allActions: ['create_task'], allSkills: ['dev'], allSignals: [] };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(manifest));

      // 第一次 pool.query：groups（无群）
      pool.query.mockResolvedValueOnce({ rows: [] });
      // 第二次 pool.query：users（有用户）
      pool.query.mockResolvedValueOnce({
        rows: [
          { open_id: 'ou_test_colleague', name: '苏彦卿', relationship: 'colleague' },
          { open_id: 'ou_test_owner', name: '徐啸', relationship: 'owner' },
        ],
      });

      const block = await buildManifestBlock();

      expect(block).toContain('ou_test_colleague');
      expect(block).toContain('苏彦卿');
      expect(block).toContain('已知飞书成员');
    });

    it('DB 无用户记录时，manifest block 正常返回（不含私信成员列表）', async () => {
      const manifest = { allActions: ['create_task'], allSkills: ['dev'], allSignals: [] };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(manifest));
      // 第一次：groups（无）
      pool.query.mockResolvedValueOnce({ rows: [] });
      // 第二次：users（无）
      pool.query.mockResolvedValueOnce({ rows: [] });

      const block = await buildManifestBlock();

      expect(block).toContain('Brain 能力清单');
      expect(block).not.toContain('可用 open_id 发私信');
    });

    it('users DB 查询异常时静默降级，仍返回 manifest block', async () => {
      const manifest = { allActions: ['create_task'], allSkills: ['dev'], allSignals: [] };
      mockReadFile.mockResolvedValueOnce(JSON.stringify(manifest));
      // 第一次：groups 正常
      pool.query.mockResolvedValueOnce({ rows: [] });
      // 第二次：users 抛异常
      pool.query.mockRejectedValueOnce(new Error('feishu_users table not found'));

      const block = await buildManifestBlock();

      expect(block).toContain('Brain 能力清单');
      expect(block.length).toBeGreaterThan(0);
    });
  });
});
