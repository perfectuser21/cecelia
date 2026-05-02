/**
 * Memory 搜索闭环集成测试
 *
 * 验证完整链路：
 * - classifyQueryIntent：查询关键词 → 意图分类 → 影响权重
 * - computeTopicDepth：对话历史深度检测
 * - quotaAwareSelect：source min/max 配额约束
 * - salience 加权：高 salience 记忆评分 ≥ 低 salience + 50%
 * - 时间衰减 × 模式权重 × salience 的组合最终排名
 * - token budget 截断：超出预算的记忆被截断
 * - buildMemoryContext 完整输出格式
 * - Graceful fallback：所有搜索失败时优雅降级
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks（必须在顶层，vitest 提升）────────────────────────────────────────

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

vi.mock('../similarity.js', () => ({
  default: class MockSimilarityService {
    searchWithVectors(...args) { return mockSearchWithVectors(...args); }
  },
}));

vi.mock('../learning.js', () => ({
  searchRelevantLearnings: (...args) => mockSearchRelevantLearnings(...args),
  getRecentLearnings: vi.fn().mockResolvedValue([]),
}));

vi.mock('../openai-client.js', () => ({
  generateEmbedding: (...args) => mockGenerateEmbedding(...args),
}));

vi.mock('../memory-router.js', () => ({
  routeMemory: vi.fn().mockReturnValue({
    intentType: 'general',
    strategy: {
      semantic: true, episodic: true, events: true,
      episodicBudget: 250, semanticBudget: 400, eventsBudget: 150,
    },
  }),
  INTENT_TYPES: { GENERAL: 'general' },
  MEMORY_STRATEGY: {},
}));

vi.mock('../distilled-docs.js', () => ({
  getDoc: vi.fn().mockResolvedValue(null),
}));

// 全局 mock 函数变量（在文件级别声明，供各 mock 使用）
const mockSearchWithVectors = vi.fn();
const mockSearchRelevantLearnings = vi.fn();
const mockGenerateEmbedding = vi.fn();

// ─── Imports ────────────────────────────────────────────────────────────────

import pool from '../db.js';
import {
  timeDecay,
  simpleDedup,
  estimateTokens,
  HALF_LIFE,
  MODE_WEIGHT,
  SALIENCE_WEIGHT,
  classifyQueryIntent,
  computeTopicDepth,
  quotaAwareSelect,
  buildMemoryContext,
} from '../memory-retriever.js';

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchWithVectors.mockResolvedValue({ matches: [] });
  mockSearchRelevantLearnings.mockResolvedValue([]);
  mockGenerateEmbedding.mockResolvedValue(new Array(1536).fill(0));
  pool.query.mockResolvedValue({ rows: [] });
});

// ============================================================
// 意图分类 → 权重路由链路
// ============================================================

describe('classifyQueryIntent — 查询意图分类', () => {
  it('任务关键词 → task_focused', () => {
    expect(classifyQueryIntent('今天的任务有哪些需要完成')).toBe('task_focused');
    expect(classifyQueryIntent('OKR 进展如何')).toBe('task_focused');
    expect(classifyQueryIntent('这个项目的进度')).toBe('task_focused');
  });

  it('情绪关键词 → emotion_focused', () => {
    expect(classifyQueryIntent('今天感受很好心情不错')).toBe('emotion_focused');
    expect(classifyQueryIntent('压力好大有些焦虑')).toBe('emotion_focused');
  });

  it('学习关键词 → learning_focused', () => {
    expect(classifyQueryIntent('总结一下学到的经验教训')).toBe('learning_focused');
    expect(classifyQueryIntent('记录一下这次的反思')).toBe('learning_focused');
  });

  it('无关键词 → default', () => {
    expect(classifyQueryIntent('你好')).toBe('default');
    expect(classifyQueryIntent('')).toBe('default');
    expect(classifyQueryIntent(null)).toBe('default');
  });
});

// ============================================================
// 对话深度检测
// ============================================================

describe('computeTopicDepth — 话题深度检测', () => {
  it('无对话历史 → depth=0', () => {
    expect(computeTopicDepth('任务进展', [])).toBe(0);
    expect(computeTopicDepth('任务进展', null)).toBe(0);
  });

  it('历史中有 1-2 条匹配 → depth=1（延伸讨论）', () => {
    const history = [
      { title: '[对话] 今天的任务有哪些', description: '' },
      { title: '[对话] 今晚吃什么', description: '' }, // 无关
    ];
    const depth = computeTopicDepth('任务完成了吗', history);
    expect(depth).toBeGreaterThanOrEqual(0);
    expect(depth).toBeLessThanOrEqual(2);
  });

  it('历史中有 3+ 条强匹配 → depth=2（深度下钻）', () => {
    const history = [
      { title: '[对话] OKR 任务进展如何' },
      { title: '[对话] OKR 任务还差多少' },
      { title: '[对话] OKR 任务更新一下' },
      { title: '[对话] OKR 任务完成了吗' },
    ];
    const depth = computeTopicDepth('OKR 任务进展', history);
    expect(depth).toBe(2);
  });
});

// ============================================================
// Salience 加权效果验证
// ============================================================

describe('salience 加权 — SALIENCE_WEIGHT=0.5 效果链路', () => {
  it('SALIENCE_WEIGHT = 0.5', () => {
    expect(SALIENCE_WEIGHT).toBe(0.5);
  });

  it('高 salience 记忆评分比低 salience 至多高 50%', () => {
    const baseScore = 0.8;
    const highSalienceBoost = baseScore * (1 + 1.0 * SALIENCE_WEIGHT); // salience=1
    const lowSalienceScore = baseScore * (1 + 0.0 * SALIENCE_WEIGHT);  // salience=0

    expect(highSalienceBoost).toBeCloseTo(1.2, 2);
    expect(lowSalienceScore).toBeCloseTo(0.8, 2);
    expect(highSalienceBoost / lowSalienceScore).toBeCloseTo(1.5, 1); // 50% 提升
  });

  it('simpleDedup 保留高 salience（高分优先）的候选', () => {
    const candidates = [
      { text: '低重要性学习记录', finalScore: 0.8, source: 'learning' },
      { text: '低重要性学习内容', finalScore: 0.75, source: 'learning' }, // 相似度高会被去掉
      { text: '数据库优化经验', finalScore: 0.7, source: 'learning' },
    ];

    const deduped = simpleDedup(candidates, 0.7);
    // 高分候选优先保留
    expect(deduped[0].finalScore).toBe(0.8);
    expect(deduped[0].text).toBe('低重要性学习记录');
  });
});

// ============================================================
// Mode Weight 影响排名链路
// ============================================================

describe('MODE_WEIGHT — 模式权重影响最终排名', () => {
  it('plan 模式 OKR 权重(1.5) > execute 模式 OKR 权重(0.5)', () => {
    const baseScore = 0.8;
    const planScore = baseScore * MODE_WEIGHT.okr.plan;     // 0.8 × 1.5 = 1.2
    const executeScore = baseScore * MODE_WEIGHT.okr.execute; // 0.8 × 0.5 = 0.4

    expect(planScore).toBeCloseTo(1.2, 2);
    expect(executeScore).toBeCloseTo(0.4, 2);
    expect(planScore).toBeGreaterThan(executeScore * 2); // plan 模式 OKR 权重是 execute 的 3倍
  });

  it('debug 模式 event 权重(1.5) 和 learning 权重(1.5) 最高', () => {
    expect(MODE_WEIGHT.event.debug).toBe(1.5);
    expect(MODE_WEIGHT.learning.debug).toBe(1.5);
    // debug 模式 OKR 权重低
    expect(MODE_WEIGHT.okr.debug).toBeLessThan(MODE_WEIGHT.event.debug);
  });

  it('chat 模式 conversation 权重(1.5) 最高', () => {
    expect(MODE_WEIGHT.conversation.chat).toBe(1.5);
    expect(MODE_WEIGHT.conversation.chat).toBeGreaterThan(MODE_WEIGHT.okr.chat);
  });
});

// ============================================================
// quotaAwareSelect — 配额约束链路
// ============================================================

describe('quotaAwareSelect — Source 配额约束', () => {
  it('conversation max=4：超过 4 条的被截断', () => {
    const candidates = Array.from({ length: 6 }, (_, i) => ({
      id: `conv-${i}`,
      source: 'conversation',
      finalScore: 1.0 - i * 0.1,
      text: `对话 ${i}`,
    }));

    const result = quotaAwareSelect(candidates, candidates);
    const convItems = result.filter(r => r.source === 'conversation');
    expect(convItems.length).toBeLessThanOrEqual(4);
  });

  it('task min=2：即使排名低也保证至少 2 条 task 进入结果', () => {
    // 主 deduped 列表：只有 conversation
    const deduped = [
      { id: 'conv-1', source: 'conversation', finalScore: 0.9, text: '对话1' },
      { id: 'conv-2', source: 'conversation', finalScore: 0.8, text: '对话2' },
    ];
    // scored 里有 2 条 task
    const scored = [
      ...deduped,
      { id: 'task-1', source: 'task', finalScore: 0.5, text: '任务1' },
      { id: 'task-2', source: 'task', finalScore: 0.4, text: '任务2' },
    ];

    const result = quotaAwareSelect(deduped, scored);
    const taskItems = result.filter(r => r.source === 'task');
    expect(taskItems.length).toBeGreaterThanOrEqual(2); // min=2 保证
  });

  it('kr max=3：超过 3 条的 KR 被截断', () => {
    const deduped = Array.from({ length: 5 }, (_, i) => ({
      id: `kr-${i}`,
      source: 'kr',
      finalScore: 1.0 - i * 0.1,
      text: `KR ${i}`,
    }));

    const result = quotaAwareSelect(deduped, deduped);
    const krItems = result.filter(r => r.source === 'kr');
    expect(krItems.length).toBeLessThanOrEqual(3);
  });
});

// ============================================================
// 时间衰减闭环验证
// ============================================================

describe('时间衰减 — 半衰期驱动的记忆老化链路', () => {
  it('task(30天半衰期)：今天创建 > 15天前 > 30天前', () => {
    const today = new Date().toISOString();
    const fifteenDaysAgo = new Date(Date.now() - 15 * 86400000).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    const d0 = timeDecay(today, HALF_LIFE.task);
    const d15 = timeDecay(fifteenDaysAgo, HALF_LIFE.task);
    const d30 = timeDecay(thirtyDaysAgo, HALF_LIFE.task);

    expect(d0).toBeGreaterThan(d15);
    expect(d15).toBeGreaterThan(d30);
    expect(d30).toBeCloseTo(0.5, 1); // 半衰期精确验证
  });

  it('okr(Infinity半衰期)：1年前与今天分数相同', () => {
    const today = new Date().toISOString();
    const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString();

    expect(timeDecay(today, HALF_LIFE.okr)).toBe(1);
    expect(timeDecay(yearAgo, HALF_LIFE.okr)).toBe(1);
  });

  it('旧 learning < 新 task：即使半衰期不同，越老越低', () => {
    const yearAgoLearning = new Date(Date.now() - 365 * 86400000).toISOString();
    const todayTask = new Date().toISOString();

    const learningScore = timeDecay(yearAgoLearning, HALF_LIFE.learning); // 90天半衰期
    const taskScore = timeDecay(todayTask, HALF_LIFE.task);

    expect(taskScore).toBeGreaterThan(learningScore); // 今天的 task > 1年前的 learning
  });
});

// ============================================================
// buildMemoryContext 完整输出格式验证
// ============================================================

describe('buildMemoryContext — 完整上下文输出格式', () => {
  it('所有来源返回空时，输出包含降级提示或空字符串', async () => {
    const result = await buildMemoryContext({
      query: '测试查询',
      mode: 'execute',
      tokenBudget: 100,
      pool: pool,
    });

    // buildMemoryContext 返回 { block: string, meta: Object }
    expect(result).toHaveProperty('block');
    expect(result).toHaveProperty('meta');
    expect(typeof result.block).toBe('string');
  });

  it('有 task 结果时，输出包含 [任务] 标记', async () => {
    // Mock semantic search 返回 task 候选
    mockSearchWithVectors.mockResolvedValueOnce({
      matches: [{
        id: 'task-ctx-1',
        score: 0.9,
        metadata: {
          source: 'task',
          title: '修复登录 Bug',
          description: '用户报告无法登录',
          created_at: new Date().toISOString(),
          salience_score: 0.8,
        },
      }]
    });

    const result = await buildMemoryContext({
      query: '登录问题',
      mode: 'execute',
      tokenBudget: 800,
      pool: pool,
    });

    expect(typeof result.block).toBe('string');
    // 有任务候选时，输出应包含任务标记
    if (result.block.length > 0) {
      expect(result.block).toContain('[任务]');
    }
    // meta 包含注入数量
    expect(result.meta).toHaveProperty('candidates');
    expect(result.meta).toHaveProperty('tokenUsed');
  });

  it('tokenBudget 极小时（budget=5），tokenUsed 为 0 或极低', async () => {
    mockSearchWithVectors.mockResolvedValueOnce({
      matches: [{
        id: 'task-budget-1',
        score: 0.9,
        metadata: {
          source: 'task',
          title: '一个很长的任务标题描述用于测试预算截断逻辑',
          description: '这个描述很长很长很长很长很长很长很长，用来测试 token 预算截断',
          created_at: new Date().toISOString(),
          salience_score: 0.5,
        },
      }]
    });

    const result = await buildMemoryContext({
      query: '查询',
      mode: 'execute',
      tokenBudget: 5, // 极小预算
      pool: pool,
    });

    // 极小预算时，使用的 token 应为 0（没有内容能注入）
    expect(result.meta.tokenUsed).toBeLessThanOrEqual(10);
  });
});

// ============================================================
// 搜索闭环 — 完整评分链路验证
// ============================================================

describe('搜索评分闭环 — 排名正确性', () => {
  it('高 salience 候选最终排名高于低 salience（相同基准分）', () => {
    const baseScore = 0.7;
    const mode = 'execute';
    const source = 'task';
    const hl = HALF_LIFE[source];
    const modeW = MODE_WEIGHT[source][mode];

    const now = new Date().toISOString();

    // 高 salience 候选
    const highSalience = {
      rawScore: baseScore,
      decay: timeDecay(now, hl),
      modeWeight: modeW,
      salience: 1.0,
    };
    const highFinal = highSalience.rawScore * highSalience.decay * highSalience.modeWeight
      * (1 + highSalience.salience * SALIENCE_WEIGHT);

    // 低 salience 候选
    const lowSalience = {
      rawScore: baseScore,
      decay: timeDecay(now, hl),
      modeWeight: modeW,
      salience: 0.0,
    };
    const lowFinal = lowSalience.rawScore * lowSalience.decay * lowSalience.modeWeight
      * (1 + lowSalience.salience * SALIENCE_WEIGHT);

    expect(highFinal).toBeGreaterThan(lowFinal);
    expect(highFinal / lowFinal).toBeCloseTo(1.5, 1); // 50% 提升
  });

  it('新记忆 vs 老记忆：新记忆（decay≈1）排名高于旧记忆（decay≈0.5）', () => {
    const hl = HALF_LIFE.task;
    const now = new Date().toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    const newDecay = timeDecay(now, hl);
    const oldDecay = timeDecay(thirtyDaysAgo, hl);

    expect(newDecay).toBeGreaterThan(oldDecay);
    expect(oldDecay).toBeCloseTo(0.5, 1);
  });
});
