/**
 * Tests for Memory Retriever - source 配额 + 动态权重 + token 预算提升
 *
 * 覆盖：
 * Q1: CHAT_TOKEN_BUDGET = 2500
 * Q2: classifyQueryIntent - 意图分类
 * Q3: quotaAwareSelect - conversation 上限 4 条
 * Q4: quotaAwareSelect - task 最少 2 条
 * Q5: quotaAwareSelect - learning 最少 2 条
 * Q6: 动态权重叠加影响 finalScore
 * Q7: buildMemoryContext chat 模式使用 CHAT_TOKEN_BUDGET
 * Q8: buildMemoryContext 注入结果中 conversation ≤ 4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  CHAT_TOKEN_BUDGET,
  SOURCE_QUOTA,
  INTENT_WEIGHT_MULTIPLIER,
  classifyQueryIntent,
  quotaAwareSelect,
  buildMemoryContext,
} from '../memory-retriever.js';

// ---- Mocks ----

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

const mockSearchWithVectors = vi.fn();
vi.mock('../similarity.js', () => ({
  default: class {
    searchWithVectors(...args) { return mockSearchWithVectors(...args); }
  },
}));

const mockSearchRelevantLearnings = vi.fn();
vi.mock('../learning.js', () => ({
  searchRelevantLearnings: (...args) => mockSearchRelevantLearnings(...args),
  getRecentLearnings: vi.fn().mockResolvedValue([]),
}));

const mockGenerateEmbedding = vi.fn();
vi.mock('../openai-client.js', () => ({
  generateEmbedding: (...args) => mockGenerateEmbedding(...args),
}));

vi.mock('../memory-router.js', () => ({
  routeMemory: vi.fn().mockReturnValue({
    intentType: 'general',
    strategy: { semantic: true, episodic: false, events: true, episodicBudget: 250, semanticBudget: 400, eventsBudget: 150 },
  }),
  INTENT_TYPES: {},
  MEMORY_STRATEGY: {},
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchWithVectors.mockResolvedValue({ matches: [] });
  mockSearchRelevantLearnings.mockResolvedValue([]);
  mockQuery.mockResolvedValue({ rows: [] });
  mockGenerateEmbedding.mockResolvedValue(new Array(1536).fill(0));
});

// ============================================================
// Q1: 常量配置
// ============================================================

describe('CHAT_TOKEN_BUDGET', () => {
  it('Q1-1: CHAT_TOKEN_BUDGET 为 2500', () => {
    expect(CHAT_TOKEN_BUDGET).toBe(2500);
  });

  it('Q1-2: SOURCE_QUOTA conversation.max = 4', () => {
    expect(SOURCE_QUOTA.conversation.max).toBe(4);
  });

  it('Q1-3: SOURCE_QUOTA task.min = 2', () => {
    expect(SOURCE_QUOTA.task.min).toBe(2);
  });

  it('Q1-4: SOURCE_QUOTA learning.min = 2', () => {
    expect(SOURCE_QUOTA.learning.min).toBe(2);
  });

  it('Q1-5: INTENT_WEIGHT_MULTIPLIER task_focused 提升 task 权重', () => {
    expect(INTENT_WEIGHT_MULTIPLIER.task_focused.task).toBe(1.5);
    expect(INTENT_WEIGHT_MULTIPLIER.task_focused.conversation).toBe(0.6);
  });

  it('Q1-6: INTENT_WEIGHT_MULTIPLIER learning_focused 提升 learning 权重', () => {
    expect(INTENT_WEIGHT_MULTIPLIER.learning_focused.learning).toBe(2.0);
  });
});

// ============================================================
// Q2: classifyQueryIntent
// ============================================================

describe('classifyQueryIntent', () => {
  it('Q2-1: 含"任务"关键词 → task_focused', () => {
    expect(classifyQueryIntent('今天的任务进展怎么样')).toBe('task_focused');
  });

  it('Q2-2: 含"目标"关键词 → task_focused', () => {
    expect(classifyQueryIntent('我们的 OKR 目标完成了多少')).toBe('task_focused');
  });

  it('Q2-3: 含"感受"关键词 → emotion_focused', () => {
    expect(classifyQueryIntent('你最近感受如何')).toBe('emotion_focused');
  });

  it('Q2-4: 含"情绪"关键词 → emotion_focused', () => {
    expect(classifyQueryIntent('你的情绪状态怎么样')).toBe('emotion_focused');
  });

  it('Q2-5: 含"学到"关键词 → learning_focused', () => {
    expect(classifyQueryIntent('你学到了什么经验')).toBe('learning_focused');
  });

  it('Q2-6: 含"总结"关键词 → learning_focused', () => {
    expect(classifyQueryIntent('帮我总结一下今天的教训')).toBe('learning_focused');
  });

  it('Q2-7: 无关键词 → default', () => {
    expect(classifyQueryIntent('你好')).toBe('default');
    expect(classifyQueryIntent('在吗')).toBe('default');
  });

  it('Q2-8: 空字符串 → default', () => {
    expect(classifyQueryIntent('')).toBe('default');
    expect(classifyQueryIntent(null)).toBe('default');
  });
});

// ============================================================
// Q3: quotaAwareSelect - conversation 上限
// ============================================================

describe('quotaAwareSelect - conversation 上限', () => {
  it('Q3-1: 6 条 conversation 候选只保留 4 条', () => {
    const scored = Array.from({ length: 6 }, (_, i) => ({
      id: `conv-${i}`,
      source: 'conversation',
      finalScore: 0.9 - i * 0.1,
    }));
    const result = quotaAwareSelect(scored, scored);
    const convCount = result.filter(r => r.source === 'conversation').length;
    expect(convCount).toBeLessThanOrEqual(4);
  });

  it('Q3-2: 3 条 conversation 不受影响（未达上限）', () => {
    const scored = [
      { id: 'c1', source: 'conversation', finalScore: 0.9 },
      { id: 'c2', source: 'conversation', finalScore: 0.8 },
      { id: 'c3', source: 'conversation', finalScore: 0.7 },
    ];
    const result = quotaAwareSelect(scored, scored);
    const convCount = result.filter(r => r.source === 'conversation').length;
    expect(convCount).toBe(3);
  });
});

// ============================================================
// Q4: quotaAwareSelect - task 最小配额
// ============================================================

describe('quotaAwareSelect - task 最小配额', () => {
  it('Q4-1: MMR 结果无 task 时从 scored 补充到 2 条', () => {
    // deduped 全是 conversation（high score）
    const deduped = [
      { id: 'c1', source: 'conversation', finalScore: 0.95 },
      { id: 'c2', source: 'conversation', finalScore: 0.90 },
      { id: 'c3', source: 'conversation', finalScore: 0.85 },
    ];
    // scored 有 task 候选
    const scored = [
      ...deduped,
      { id: 't1', source: 'task', finalScore: 0.5 },
      { id: 't2', source: 'task', finalScore: 0.4 },
    ];
    const result = quotaAwareSelect(deduped, scored);
    const taskCount = result.filter(r => r.source === 'task').length;
    expect(taskCount).toBeGreaterThanOrEqual(2);
  });

  it('Q4-2: 只有 1 条 task 候选时，最多补充到 1 条（不超出可用数量）', () => {
    const deduped = [{ id: 'c1', source: 'conversation', finalScore: 0.9 }];
    const scored = [
      ...deduped,
      { id: 't1', source: 'task', finalScore: 0.5 },
    ];
    const result = quotaAwareSelect(deduped, scored);
    const taskCount = result.filter(r => r.source === 'task').length;
    expect(taskCount).toBe(1); // 只有 1 条可用，取 1 条
  });

  it('Q4-3: deduped 已有 2 条 task 时不重复添加', () => {
    const deduped = [
      { id: 't1', source: 'task', finalScore: 0.9 },
      { id: 't2', source: 'task', finalScore: 0.8 },
    ];
    const scored = [...deduped, { id: 't3', source: 'task', finalScore: 0.5 }];
    const result = quotaAwareSelect(deduped, scored);
    const taskCount = result.filter(r => r.source === 'task').length;
    // 满足最小配额即可，不强制拉满
    expect(taskCount).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// Q5: quotaAwareSelect - learning 最小配额
// ============================================================

describe('quotaAwareSelect - learning 最小配额', () => {
  it('Q5-1: deduped 无 learning 时从 scored 补充到 2 条', () => {
    const deduped = [
      { id: 'c1', source: 'conversation', finalScore: 0.95 },
      { id: 'c2', source: 'conversation', finalScore: 0.90 },
    ];
    const scored = [
      ...deduped,
      { id: 'l1', source: 'learning', finalScore: 0.4 },
      { id: 'l2', source: 'learning', finalScore: 0.3 },
    ];
    const result = quotaAwareSelect(deduped, scored);
    const learnCount = result.filter(r => r.source === 'learning').length;
    expect(learnCount).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// Q6: 动态权重影响评分
// ============================================================

describe('动态权重 - INTENT_WEIGHT_MULTIPLIER', () => {
  it('Q6-1: task_focused 时 task 得分×1.5', () => {
    const multipliers = INTENT_WEIGHT_MULTIPLIER.task_focused;
    expect(multipliers.task).toBe(1.5);

    // 模拟一个基础 task 得分 0.5，乘以 1.5 后 = 0.75
    const baseScore = 0.5;
    expect(baseScore * multipliers.task).toBeCloseTo(0.75);
  });

  it('Q6-2: emotion_focused 时 conversation 得分×1.5，task 得分×0.6', () => {
    const multipliers = INTENT_WEIGHT_MULTIPLIER.emotion_focused;
    expect(multipliers.conversation).toBe(1.5);
    expect(multipliers.task).toBe(0.6);
  });

  it('Q6-3: learning_focused 时 learning 得分×2.0', () => {
    const multipliers = INTENT_WEIGHT_MULTIPLIER.learning_focused;
    expect(multipliers.learning).toBe(2.0);
  });

  it('Q6-4: default 时没有额外倍数', () => {
    const multipliers = INTENT_WEIGHT_MULTIPLIER.default;
    expect(multipliers).toEqual({});
  });
});

// ============================================================
// Q7: buildMemoryContext chat 模式 tokenBudget
// ============================================================

describe('buildMemoryContext - chat 模式 tokenBudget', () => {
  it('Q7-1: chat 模式下 meta.tokenBudget = CHAT_TOKEN_BUDGET（当外部传入时）', async () => {
    mockSearchWithVectors.mockResolvedValue({ matches: [] });
    mockQuery.mockResolvedValue({ rows: [] });

    const { meta } = await buildMemoryContext({
      query: '你好',
      mode: 'chat',
      tokenBudget: CHAT_TOKEN_BUDGET,
      pool: { query: mockQuery },
    });

    expect(meta.tokenBudget).toBe(CHAT_TOKEN_BUDGET);
  });

  it('Q7-2: 2500 预算下能注入更多内容（vs 1000）', async () => {
    // 创建 20 条中等长度候选
    const matches = Array.from({ length: 20 }, (_, i) => ({
      id: `${i}`,
      level: 'task',
      title: `任务${i}: 实现功能描述`,
      description: `这是第${i}个任务的详细描述，包含实现细节和验收标准。`,
      score: 0.9 - i * 0.02,
      created_at: new Date().toISOString(),
      status: 'completed',
    }));

    mockSearchWithVectors.mockResolvedValue({ matches });
    mockQuery.mockResolvedValue({ rows: [] });

    const { meta: meta1000 } = await buildMemoryContext({
      query: '任务进展',
      mode: 'execute',
      tokenBudget: 1000,
      pool: { query: mockQuery },
    });

    vi.clearAllMocks();
    mockSearchWithVectors.mockResolvedValue({ matches });
    mockQuery.mockResolvedValue({ rows: [] });

    const { meta: meta2500 } = await buildMemoryContext({
      query: '任务进展',
      mode: 'execute',
      tokenBudget: 2500,
      pool: { query: mockQuery },
    });

    // 2500 预算下应该能注入更多
    expect(meta2500.injected).toBeGreaterThanOrEqual(meta1000.injected);
  });
});

// ============================================================
// Q8: buildMemoryContext 集成 - conversation 上限约束
// ============================================================

describe('buildMemoryContext - conversation 上限', () => {
  it('Q8-1: 即使有 10 条 conversation 候选，注入数 ≤ 4', async () => {
    // conversation 候选 10 条
    const convRows = Array.from({ length: 10 }, (_, i) => ({
      id: `conv-event-${i}`,
      payload: JSON.stringify({
        user_message: `用户消息${i} 这是一条较长的对话内容`,
        reply: `Cecelia 回复${i} 包含了详细的分析和建议`,
      }),
      created_at: new Date(Date.now() - i * 3600000).toISOString(),
    }));

    mockSearchWithVectors.mockResolvedValue({ matches: [] });
    mockSearchRelevantLearnings.mockResolvedValue([]);

    // mockQuery: orchestrator_chat 查询 → 10 条对话
    mockQuery.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('orchestrator_chat')) {
        return Promise.resolve({ rows: convRows });
      }
      return Promise.resolve({ rows: [] });
    });

    const { meta } = await buildMemoryContext({
      query: '最近聊了什么',
      mode: 'chat',
      tokenBudget: CHAT_TOKEN_BUDGET,
      pool: { query: mockQuery },
    });

    const convSourceCount = meta.sources.filter(s => s === 'conversation').length;
    expect(convSourceCount).toBeLessThanOrEqual(4);
  });

  it('Q8-2: meta.intentType 反映查询意图分类', async () => {
    mockSearchWithVectors.mockResolvedValue({ matches: [] });
    mockQuery.mockResolvedValue({ rows: [] });

    const { meta } = await buildMemoryContext({
      query: '今天的任务有哪些',
      mode: 'chat',
      tokenBudget: CHAT_TOKEN_BUDGET,
      pool: { query: mockQuery },
    });

    expect(meta.intentType).toBe('task_focused');
  });

  it('Q8-3: 情绪类查询 intentType = emotion_focused', async () => {
    mockSearchWithVectors.mockResolvedValue({ matches: [] });
    mockQuery.mockResolvedValue({ rows: [] });

    const { meta } = await buildMemoryContext({
      query: '你今天感受怎么样',
      mode: 'chat',
      tokenBudget: CHAT_TOKEN_BUDGET,
      pool: { query: mockQuery },
    });

    expect(meta.intentType).toBe('emotion_focused');
  });
});
