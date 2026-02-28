/**
 * cecelia-voice-retrieval.test.js
 * 测试检索优先架构：
 * 1. retrieveCeceliaVoice 从 DB 正确检索
 * 2. buildTransmitterPrompt 行为
 * 3. CHAT 意图 + 无内容 → "我还没想过这个"（不调 LLM）
 * 4. 动作型意图 → 不走检索优先，调用 LLM（不含传声器 prompt）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock callLLM
const mockCallLLM = vi.hoisted(() => vi.fn());
vi.mock('../llm-caller.js', () => ({ callLLM: mockCallLLM }));

// Mock db.js
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

// Mock thalamus.js
vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn(),
  EVENT_TYPES: { USER_MESSAGE: 'USER_MESSAGE' },
}));

// Mock intent.js
vi.mock('../intent.js', () => ({
  parseIntent: vi.fn(),
}));

// Mock memory-retriever.js
vi.mock('../memory-retriever.js', () => ({
  buildMemoryContext: vi.fn().mockResolvedValue({ block: '', meta: {} }),
}));

// Mock user-profile.js
vi.mock('../user-profile.js', () => ({
  extractAndSaveUserFacts: vi.fn().mockResolvedValue(undefined),
  getUserProfileContext: vi.fn().mockResolvedValue(''),
}));

// Mock chat-action-dispatcher.js
vi.mock('../chat-action-dispatcher.js', () => ({
  detectAndExecuteAction: vi.fn().mockResolvedValue(''),
}));

// Mock owner-input-extractor.js
vi.mock('../owner-input-extractor.js', () => ({
  extractSuggestionsFromChat: vi.fn().mockResolvedValue(undefined),
}));

// Mock self-model.js
vi.mock('../self-model.js', () => ({
  getSelfModel: vi.fn().mockResolvedValue('保护型，追求精确'),
}));

// Mock memory-utils.js
vi.mock('../memory-utils.js', () => ({
  generateL0Summary: vi.fn().mockReturnValue('summary'),
  generateMemoryStreamL1Async: vi.fn(),
}));

import pool from '../db.js';
import { parseIntent } from '../intent.js';
import {
  handleChat,
  retrieveCeceliaVoice,
  buildTransmitterPrompt,
} from '../orchestrator-chat.js';

function llmResp(text) {
  return { text, model: 'minimax', provider: 'minimax', elapsed_ms: 10 };
}

// pool.query mock 通用行：满足所有可能的查询
const GENERIC_ROW = { content: '叙事内容', id: '1', value_json: 'focused', status: 'in_progress', cnt: 1 };

describe('cecelia-voice-retrieval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认所有 DB 查询返回空
    pool.query.mockResolvedValue({ rows: [] });
  });

  // ─── D1: retrieveCeceliaVoice ───────────────────────────

  describe('retrieveCeceliaVoice', () => {
    it('fetches narratives, self_model, learnings, emotion from DB', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ content: '今天我感到专注' }] })     // narratives
        .mockResolvedValueOnce({ rows: [{ content: '我是一个保护型AI' }] })  // self_model
        .mockResolvedValueOnce({ rows: [{ content: '学习记录1' }] })          // learnings
        .mockResolvedValueOnce({ rows: [{ value_json: 'focused' }] });         // emotion

      const result = await retrieveCeceliaVoice('你今天感觉怎么样');

      expect(result.narratives).toContain('今天我感到专注');
      expect(result.selfModel).toBe('我是一个保护型AI');
      expect(result.learnings).toContain('学习记录1');
      expect(result.emotion).toBe('focused');
    });

    it('returns empty data when DB returns nothing', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const result = await retrieveCeceliaVoice('什么都没有');

      expect(result.narratives).toHaveLength(0);
      expect(result.selfModel).toBe('');
      expect(result.learnings).toHaveLength(0);
      expect(result.emotion).toBe('');
    });

    it('gracefully handles DB errors', async () => {
      pool.query.mockRejectedValue(new Error('DB error'));

      const result = await retrieveCeceliaVoice('test');

      expect(result.narratives).toHaveLength(0);
      expect(result.selfModel).toBe('');
    });
  });

  // ─── D2: buildTransmitterPrompt ────────────────────────

  describe('buildTransmitterPrompt', () => {
    it('returns null when no voice content found', () => {
      const result = buildTransmitterPrompt('你怎么看？', {
        narratives: [], selfModel: '', learnings: [], emotion: '',
      });
      expect(result).toBeNull();
    });

    it('includes transmitter instruction and "我还没想过这个" when content found', () => {
      const result = buildTransmitterPrompt('你怎么看？', {
        narratives: ['今天我写了一段话'],
        selfModel: '', learnings: [], emotion: '',
      });
      expect(result).not.toBeNull();
      expect(result).toContain('文字传递器');
      expect(result).toContain('不许添加她没有写过的内容');
      expect(result).toContain('我还没想过这个');
      expect(result).toContain('你怎么看？');
      expect(result).toContain('今天我写了一段话');
    });

    it('includes self_model when available', () => {
      const result = buildTransmitterPrompt('问题', {
        narratives: [], selfModel: '我是保护型', learnings: [], emotion: '',
      });
      expect(result).not.toBeNull();
      expect(result).toContain('我对自己的认知');
      expect(result).toContain('我是保护型');
    });

    it('includes emotion when available', () => {
      const result = buildTransmitterPrompt('问题', {
        narratives: ['内容'], selfModel: '', learnings: [], emotion: 'focused',
      });
      expect(result).not.toBeNull();
      expect(result).toContain('情绪状态');
      expect(result).toContain('focused');
    });
  });

  // ─── D3: CHAT/QUESTION 意图 + 无内容 → 不调 LLM ────────

  describe('handleChat - no content returns default', () => {
    it('QUESTION 意图 + 无叙事 → 返回 "我还没想过这个"，不调用 LLM', async () => {
      parseIntent.mockReturnValue({ type: 'QUESTION', confidence: 0.9 });
      // 所有 DB 查询返回空（narratives/self_model/learnings/emotion 都没有）
      pool.query.mockResolvedValue({ rows: [] });

      const result = await handleChat('你对未来有什么看法？');

      expect(result.reply).toBe('我还没想过这个。');
      // LLM 不应该被调用
      expect(mockCallLLM).not.toHaveBeenCalled();
    });

    it('CHAT 意图 + 无内容 → 同样返回默认回复', async () => {
      parseIntent.mockReturnValue({ type: 'CHAT', confidence: 0.9 });
      pool.query.mockResolvedValue({ rows: [] });

      const result = await handleChat('随便聊聊');

      expect(result.reply).toBe('我还没想过这个。');
      expect(mockCallLLM).not.toHaveBeenCalled();
    });
  });

  // ─── D4: 动作型意图不走检索优先 ────────────────────────

  describe('handleChat - action intents bypass retrieval-first', () => {
    it('CREATE_TASK 意图 → 调用 LLM，prompt 含 MOUTH_SYSTEM_PROMPT，不含传声器指令', async () => {
      parseIntent.mockReturnValue({ type: 'CREATE_TASK', confidence: 0.95 });
      // 所有 DB 查询返回空
      pool.query.mockResolvedValue({ rows: [] });
      mockCallLLM.mockResolvedValueOnce(llmResp('好的，任务已创建。'));

      const result = await handleChat('帮我创建一个任务：修复登录 bug');

      // LLM 应该被调用
      expect(mockCallLLM).toHaveBeenCalled();
      // prompt 不包含传声器指令（使用 MOUTH_SYSTEM_PROMPT）
      const calledPrompt = mockCallLLM.mock.calls[0][1];
      expect(calledPrompt).not.toContain('文字传递器');
      // 有回复
      expect(result.reply).toBeTruthy();
    });
  });
});
