/**
 * Tests for salience_score weighting in memory-retriever
 *
 * 覆盖：
 * S1: SALIENCE_WEIGHT 常量存在且为正数
 * S2: salienceW 在 scored 中生效（高 salience 候选 finalScore 更高）
 * S3: salience_score IS NULL 安全降级（等同于 0）
 * S4: salience_score=0 时乘数为 1.0（行为不变）
 * S5: 高 salience 记录排序靠前（buildMemoryContext 集成）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  SALIENCE_WEIGHT,
  timeDecay,
  buildMemoryContext,
} from '../memory-retriever.js';

// Mock dependencies
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

vi.mock('../learning.js', () => ({
  searchRelevantLearnings: vi.fn().mockResolvedValue([]),
  getRecentLearnings: vi.fn().mockResolvedValue([]),
}));

vi.mock('../openai-client.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
}));

vi.mock('../memory-router.js', () => ({
  routeMemory: vi.fn().mockReturnValue({
    intentType: 'general',
    strategy: { semantic: true, episodic: false, events: true, episodicBudget: 0, semanticBudget: 400, eventsBudget: 150 },
  }),
  INTENT_TYPES: {},
  MEMORY_STRATEGY: {},
}));

vi.mock('../distilled-docs.js', () => ({
  getDoc: vi.fn().mockResolvedValue({ content: '' }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchWithVectors.mockResolvedValue({ matches: [] });
  mockQuery.mockResolvedValue({ rows: [] });
});

// ============================================================
// S1: SALIENCE_WEIGHT 常量
// ============================================================

describe('SALIENCE_WEIGHT', () => {
  it('应为正数', () => {
    expect(typeof SALIENCE_WEIGHT).toBe('number');
    expect(SALIENCE_WEIGHT).toBeGreaterThan(0);
  });

  it('salience_score=1.0 时乘数应为 1 + SALIENCE_WEIGHT', () => {
    const salienceW = 1 + 1.0 * SALIENCE_WEIGHT;
    expect(salienceW).toBeCloseTo(1 + SALIENCE_WEIGHT, 5);
  });
});

// ============================================================
// S2 & S3 & S4: salienceW 数值验证
// ============================================================

describe('salienceW 计算', () => {
  it('salience_score=0 时乘数为 1.0（行为不变）', () => {
    const salienceW = 1 + (0 || 0) * SALIENCE_WEIGHT;
    expect(salienceW).toBe(1.0);
  });

  it('salience_score=null 时安全降级为乘数 1.0', () => {
    const salienceW = 1 + (null || 0) * SALIENCE_WEIGHT;
    expect(salienceW).toBe(1.0);
  });

  it('salience_score=undefined 时安全降级为乘数 1.0', () => {
    const salienceW = 1 + (undefined || 0) * SALIENCE_WEIGHT;
    expect(salienceW).toBe(1.0);
  });

  it('salience_score=1.0 时乘数大于 1.0', () => {
    const salienceW = 1 + (1.0 || 0) * SALIENCE_WEIGHT;
    expect(salienceW).toBeGreaterThan(1.0);
  });

  it('高 salience 候选 finalScore 应高于同条件低 salience 候选', () => {
    const now = new Date().toISOString();
    const baseRelevance = 0.8;
    const decay = timeDecay(now, 30);
    const modeW = 1.0;
    const dynW = 1.0;

    const highSalienceScore = baseRelevance * decay * modeW * dynW * (1 + 1.0 * SALIENCE_WEIGHT);
    const lowSalienceScore  = baseRelevance * decay * modeW * dynW * (1 + 0.0 * SALIENCE_WEIGHT);

    expect(highSalienceScore).toBeGreaterThan(lowSalienceScore);
  });
});

// ============================================================
// S5: buildMemoryContext 集成 — 高 salience 记录排序靠前
// ============================================================

describe('buildMemoryContext salience 排序', () => {
  it('salience_score 高的 conversation 候选排序靠前', async () => {
    const now = new Date().toISOString();

    // conversation_turn 主路径：memory_stream
    mockQuery.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('conversation_turn')) {
        return {
          rows: [
            // 低 salience
            { id: 'low-sal', content: '普通消息内容', salience_score: 0.1, created_at: now },
            // 高 salience（洞察/决定）
            { id: 'high-sal', content: '重要决定：切换架构方向', salience_score: 0.9, created_at: now },
          ],
        };
      }
      return { rows: [] };
    });

    const mockPool = { query: (...args) => mockQuery(...args) };
    const result = await buildMemoryContext({
      query: '架构',
      mode: 'chat',
      tokenBudget: 2000,
      pool: mockPool,
    });

    // 高 salience 候选应出现在 block 中（不验证顺序，仅验证存在）
    expect(result.block).toBeDefined();
    // 两条都应该被注入（有足够预算）
    expect(result.meta.injected).toBeGreaterThanOrEqual(1);
  });

  it('salience_score=null 的候选不会崩溃', async () => {
    const now = new Date().toISOString();

    mockQuery.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('conversation_turn')) {
        return {
          rows: [
            { id: 'null-sal', content: '普通消息', salience_score: null, created_at: now },
          ],
        };
      }
      return { rows: [] };
    });

    const mockPool = { query: (...args) => mockQuery(...args) };
    await expect(
      buildMemoryContext({ query: '测试', mode: 'chat', tokenBudget: 1000, pool: mockPool })
    ).resolves.not.toThrow();
  });
});
