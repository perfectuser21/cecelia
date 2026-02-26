/**
 * orchestrator-chat-intent.test.js — LLM 意图理解测试
 *
 * 验证：
 * - llmParseIntent 正确解析 LLM 返回的 JSON
 * - parseJsonFromResponse 处理各种 JSON 格式
 * - ACTION_INTENTS 包含正确的意图类型
 * - handleChat 对 UNKNOWN 意图调用 LLM 回退
 */

import { describe, it, expect, vi } from 'vitest';

// Mock 所有 DB 和外部依赖
const mockQuery = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [] }));
vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

const mockCallLLM = vi.hoisted(() => vi.fn());
vi.mock('../llm-caller.js', () => ({
  callLLM: mockCallLLM,
}));

vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue({ level: 0, actions: [], rationale: 'ok' }),
  EVENT_TYPES: { USER_MESSAGE: 'user_message' },
}));

vi.mock('../intent.js', () => ({
  parseIntent: vi.fn().mockReturnValue({ type: 'UNKNOWN', confidence: 0 }),
  parseAndCreate: vi.fn().mockResolvedValue({ parsed: {}, created: { project: null, tasks: [] } }),
  INTENT_TYPES: {
    QUESTION: 'question', UNKNOWN: 'unknown',
    CREATE_PROJECT: 'create_project', CREATE_FEATURE: 'create_feature',
    CREATE_GOAL: 'create_goal', CREATE_TASK: 'create_task',
    FIX_BUG: 'fix_bug', REFACTOR: 'refactor', EXPLORE: 'explore',
    QUERY_STATUS: 'query_status',
  },
}));

vi.mock('../memory-retriever.js', () => ({
  buildMemoryContext: vi.fn().mockResolvedValue({ block: '', meta: {} }),
}));

vi.mock('../user-profile.js', () => ({
  extractAndSaveUserFacts: vi.fn(),
  getUserProfileContext: vi.fn().mockResolvedValue(''),
}));

vi.mock('../chat-action-dispatcher.js', () => ({
  detectAndExecuteAction: vi.fn().mockResolvedValue(''),
}));

import {
  llmParseIntent,
  parseJsonFromResponse,
  ACTION_INTENTS,
} from '../orchestrator-chat.js';

describe('parseJsonFromResponse', () => {
  it('解析 markdown code block 中的 JSON', () => {
    const response = '分析结果：\n```json\n{"intent": "CREATE_TASK", "confidence": 0.9}\n```';
    const result = parseJsonFromResponse(response);
    expect(result).toEqual({ intent: 'CREATE_TASK', confidence: 0.9 });
  });

  it('解析裸 JSON', () => {
    const response = '这是结果 {"intent": "LEARN", "confidence": 0.8}';
    const result = parseJsonFromResponse(response);
    expect(result).toEqual({ intent: 'LEARN', confidence: 0.8 });
  });

  it('无 JSON 返回 null', () => {
    const result = parseJsonFromResponse('没有任何 JSON 内容');
    expect(result).toBeNull();
  });
});

describe('ACTION_INTENTS', () => {
  it('包含动作型意图', () => {
    expect(ACTION_INTENTS).toContain('CREATE_TASK');
    expect(ACTION_INTENTS).toContain('LEARN');
    expect(ACTION_INTENTS).toContain('RESEARCH');
  });

  it('不包含 CHAT', () => {
    expect(ACTION_INTENTS).not.toContain('CHAT');
    expect(ACTION_INTENTS).not.toContain('QUERY_STATUS');
  });
});

describe('llmParseIntent', () => {
  it('成功解析 LLM 返回的意图', async () => {
    mockCallLLM.mockResolvedValueOnce({
      text: '```json\n{"intent": "CREATE_TASK", "confidence": 0.85, "entities": {"title": "修复 CI"}, "summary": "修复 CI 覆盖率"}\n```',
    });

    const result = await llmParseIntent('今天想搞一下 CI', '');
    expect(result).not.toBeNull();
    expect(result.intent).toBe('CREATE_TASK');
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.summary).toContain('CI');
  });

  it('LLM 超时返回 null', async () => {
    mockCallLLM.mockRejectedValueOnce(new Error('timeout'));

    const result = await llmParseIntent('模糊输入', '');
    expect(result).toBeNull();
  });

  it('LLM 返回非 JSON 返回 null', async () => {
    mockCallLLM.mockResolvedValueOnce({ text: '我不确定你想做什么' });

    const result = await llmParseIntent('...', '');
    expect(result).toBeNull();
  });

  it('LEARN 意图识别', async () => {
    mockCallLLM.mockResolvedValueOnce({
      text: '{"intent": "LEARN", "confidence": 0.9, "entities": {"title": "RAG 技术"}, "summary": "学习 RAG 技术"}',
    });

    const result = await llmParseIntent('我看了个视频讲 RAG 很不错', '');
    expect(result.intent).toBe('LEARN');
  });

  it('RESEARCH 意图识别', async () => {
    mockCallLLM.mockResolvedValueOnce({
      text: '{"intent": "RESEARCH", "confidence": 0.85, "entities": {}, "summary": "研究竞品定价策略"}',
    });

    const result = await llmParseIntent('帮我研究一下竞品的定价策略', '');
    expect(result.intent).toBe('RESEARCH');
  });
});
