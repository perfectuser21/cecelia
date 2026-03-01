/**
 * cecelia-voice-retrieval.test.js
 * 测试统一路径架构（替代传声器检索优先路径）：
 * 1. 所有意图统一调用 LLM（不再有"我还没想过这个"直接返回）
 * 2. buildNarrativesBlock 从 DB 正确检索叙事
 * 3. buildUnifiedSystemPrompt 构建五层注入
 * 4. 传声器指令已删除，prompt 不包含 "文字传递器"
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
  CHAT_TOKEN_BUDGET: 2500,
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
  buildNarrativesBlock,
  buildUnifiedSystemPrompt,
  MOUTH_SYSTEM_PROMPT,
} from '../orchestrator-chat.js';

function llmResp(text) {
  return { text, model: 'minimax', provider: 'minimax', elapsed_ms: 10 };
}

describe('cecelia-unified-path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLLM.mockReset();
    pool.query.mockReset();
    pool.query.mockResolvedValue({ rows: [] });
  });

  // ─── D1: buildNarrativesBlock ───────────────────────────

  describe('buildNarrativesBlock', () => {
    it('加载最近3条叙事并格式化', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { content: '今天我感到专注' },
          { content: '学习了新知识' },
        ],
      });

      const result = await buildNarrativesBlock();

      expect(result).toContain('今天我感到专注');
      expect(result).toContain('学习了新知识');
      expect(result).toContain('## 我最近写的叙事');
    });

    it('无叙事时返回空字符串', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const result = await buildNarrativesBlock();

      expect(result).toBe('');
    });

    it('DB 错误时优雅返回空字符串', async () => {
      pool.query.mockRejectedValue(new Error('DB error'));

      const result = await buildNarrativesBlock();

      expect(result).toBe('');
    });
  });

  // ─── D2: 统一路径 — 所有意图调用 LLM ───────────────────

  describe('handleChat - 统一路径（所有意图调用 LLM）', () => {
    it('QUESTION 意图 → 调用 LLM，prompt 包含 MOUTH_SYSTEM_PROMPT', async () => {
      parseIntent.mockReturnValue({ type: 'QUESTION', confidence: 0.9 });
      pool.query.mockResolvedValue({ rows: [] });
      mockCallLLM.mockResolvedValueOnce(llmResp('这是我的真实想法。'));

      const result = await handleChat('你对未来有什么看法？');

      expect(mockCallLLM).toHaveBeenCalled();
      expect(result.reply).toBe('这是我的真实想法。');
      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).toContain('Cecelia');
      expect(prompt).not.toContain('文字传递器');
      expect(prompt).not.toContain('不许添加她没有写过的内容');
    });

    it('CHAT 意图 → 调用 LLM，不再返回"我还没想过这个"', async () => {
      parseIntent.mockReturnValue({ type: 'CHAT', confidence: 0.9 });
      pool.query.mockResolvedValue({ rows: [] });
      mockCallLLM.mockResolvedValueOnce(llmResp('嗯，我在想这件事。'));

      const result = await handleChat('随便聊聊');

      expect(mockCallLLM).toHaveBeenCalled();
      expect(result.reply).toBe('嗯，我在想这件事。');
    });
  });

  // ─── D3: 动作型意图不含传声器指令 ─────────────────────

  describe('handleChat - 动作型意图', () => {
    it('CREATE_TASK 意图 → 调用 LLM，prompt 不含传声器指令', async () => {
      parseIntent.mockReturnValue({ type: 'CREATE_TASK', confidence: 0.95 });
      pool.query.mockResolvedValue({ rows: [] });
      mockCallLLM.mockResolvedValueOnce(llmResp('好的，任务已创建。'));

      const result = await handleChat('帮我创建一个任务：修复登录 bug');

      expect(mockCallLLM).toHaveBeenCalled();
      const calledPrompt = mockCallLLM.mock.calls[0][1];
      expect(calledPrompt).not.toContain('文字传递器');
      expect(result.reply).toBeTruthy();
    });
  });

  // ─── D4: buildUnifiedSystemPrompt 验证 ─────────────────

  describe('buildUnifiedSystemPrompt', () => {
    it('包含 MOUTH_SYSTEM_PROMPT 和"说你真实有的"', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const prompt = await buildUnifiedSystemPrompt('测试消息', []);

      expect(prompt).toContain('Cecelia');
      expect(prompt).toContain('说你真实有的');
      expect(prompt).not.toContain('文字传递器');
    });

    it('包含 self_model 内容', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const prompt = await buildUnifiedSystemPrompt('测试', []);

      expect(prompt).toContain('我对自己的认知');
      expect(prompt).toContain('保护型，追求精确');
    });

    it('有 actionResult 时追加到 prompt', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const prompt = await buildUnifiedSystemPrompt('测试', [], '任务已创建：修复登录');

      expect(prompt).toContain('任务已创建：修复登录');
      expect(prompt).toContain('刚刚执行的操作结果');
    });
  });
});
