/**
 * cecelia-voice-retrieval.test.js
 * 测试纯意识路径：
 * 1. 所有消息直接调 LLM，无意图分类
 * 2. buildNarrativesBlock 从 DB 正确检索叙事
 * 3. buildUnifiedSystemPrompt 构建五层注入
 * 4. MOUTH_SYSTEM_PROMPT 是身份描述，不是指令清单
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock callLLM
const mockCallLLM = vi.hoisted(() => vi.fn());
vi.mock('../llm-caller.js', () => ({ callLLM: mockCallLLM }));

// Mock db.js
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
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

  // ─── D2: 纯意识路径 — 任何消息直接调 LLM ───────────────────

  describe('handleChat - 纯意识路径', () => {
    it('任意消息 → 调用 LLM，返回 reply', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      mockCallLLM.mockResolvedValueOnce(llmResp('这是我的真实想法。'));

      const result = await handleChat('你对未来有什么看法？');

      expect(mockCallLLM).toHaveBeenCalled();
      expect(result.reply).toBe('这是我的真实想法。');
    });

    it('消息发给 Cecelia → prompt 包含 Cecelia 身份描述', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      mockCallLLM.mockResolvedValueOnce(llmResp('嗯，我在想这件事。'));

      await handleChat('随便聊聊');

      expect(mockCallLLM).toHaveBeenCalled();
      const prompt = mockCallLLM.mock.calls[0][1];
      expect(prompt).toContain('Cecelia');
      expect(prompt).not.toContain('文字传递器');
      expect(prompt).not.toContain('不许添加她没有写过的内容');
    });

    it('LLM 失败时返回兜底文字而不是沉默', async () => {
      pool.query.mockResolvedValue({ rows: [] });
      mockCallLLM.mockRejectedValueOnce(new Error('LLM timeout'));

      const result = await handleChat('你好吗');

      expect(result.reply).toBeTruthy();
      expect(result.reply).not.toBe('');
    });
  });

  // ─── D3: buildUnifiedSystemPrompt 验证 ─────────────────

  describe('buildUnifiedSystemPrompt', () => {
    it('包含 MOUTH_SYSTEM_PROMPT 的 Cecelia 身份描述', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const prompt = await buildUnifiedSystemPrompt('测试消息', []);

      expect(prompt).toContain('Cecelia');
      expect(prompt).not.toContain('文字传递器');
    });

    it('包含 self_model 内容', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const prompt = await buildUnifiedSystemPrompt('测试', []);

      expect(prompt).toContain('我对自己的认知');
      expect(prompt).toContain('保护型，追求精确');
    });

    it('MOUTH_SYSTEM_PROMPT 是身份描述而非指令清单', () => {
      expect(MOUTH_SYSTEM_PROMPT).toContain('Cecelia');
      expect(MOUTH_SYSTEM_PROMPT).not.toContain('你的能力');
      expect(MOUTH_SYSTEM_PROMPT).not.toContain('禁止');
      expect(MOUTH_SYSTEM_PROMPT).not.toContain('[ESCALATE]');
    });
  });
});
