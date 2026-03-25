/**
 * Integration Test: memory-router ↔ memory-retriever 跨模块集成
 *
 * 验证 routeMemory（memory-router.js）与 buildMemoryContext（memory-retriever.js）
 * 的联动行为：不同意图类型 → 不同 DB 查询策略。
 *
 * 与单元测试的区别：
 *   - 单元测试：各模块独立测试（完全 mock）
 *   - 本集成测试：两模块真实导入，只 mock DB/embedding 外部依赖
 *   - 验证：routeMemory 的路由决策是否真实影响 buildMemoryContext 的 DB 查询行为
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock 外部依赖（非测试目标）────────────────────────────────────────────

// Mock DB pool — 捕获执行的 SQL 查询
const mockQueries = [];
const mockPool = {
  query: vi.fn(async (sql, _params) => {
    mockQueries.push(typeof sql === 'string' ? sql : sql.text || String(sql));
    return { rows: [] };
  }),
};
vi.mock('../../db.js', () => ({ default: mockPool }));

// Mock openai-client — 返回固定 embedding 向量
vi.mock('../../openai-client.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

// Mock similarity.js — 包含 searchWithVectors 方法
vi.mock('../../similarity.js', () => ({
  default: class MockSimilarityService {
    constructor(_pool) {}
    async searchWithVectors(_query, _opts) { return []; }
    async search(_query, _opts) { return []; }
  },
}));

// Mock learning.js — 非测试目标
vi.mock('../../learning.js', () => ({
  searchRelevantLearnings: vi.fn().mockResolvedValue([]),
  getRecentLearnings: vi.fn().mockResolvedValue([]),
}));

// Mock distilled-docs.js — 非测试目标
vi.mock('../../distilled-docs.js', () => ({
  getDoc: vi.fn().mockResolvedValue(null),
}));

// Mock embedding-service.js — 非测试目标
vi.mock('../../embedding-service.js', () => ({
  generateTaskEmbeddingAsync: vi.fn(),
  searchByEmbedding: vi.fn().mockResolvedValue([]),
}));

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

describe('Memory Router ↔ Retriever 跨模块集成', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueries.length = 0;
  });

  // ─── 1. routeMemory 意图识别 ──────────────────────────────────────────────

  describe('routeMemory 意图识别（集成前置验证）', () => {
    it('SELF_REFLECTION: 识别自我反思类消息', async () => {
      const { routeMemory, INTENT_TYPES, MEMORY_STRATEGY } = await import('../../memory-router.js');

      const result = routeMemory('你在想什么', 'chat');

      expect(result.intentType).toBe(INTENT_TYPES.SELF_REFLECTION);
      expect(result.strategy).toEqual(MEMORY_STRATEGY[INTENT_TYPES.SELF_REFLECTION]);
      expect(result.strategy.episodic).toBe(true);
      expect(result.strategy.semantic).toBe(false);
    });

    it('STATUS_CHECK: 识别系统状态类消息', async () => {
      const { routeMemory, INTENT_TYPES, MEMORY_STRATEGY } = await import('../../memory-router.js');

      const result = routeMemory('系统状态告警', 'chat');

      expect(result.intentType).toBe(INTENT_TYPES.STATUS_CHECK);
      expect(result.strategy).toEqual(MEMORY_STRATEGY[INTENT_TYPES.STATUS_CHECK]);
      expect(result.strategy.semantic).toBe(false);
      expect(result.strategy.events).toBe(true);
    });

    it('TASK_QUERY: 识别任务查询类消息', async () => {
      const { routeMemory, INTENT_TYPES } = await import('../../memory-router.js');

      const result = routeMemory('上次任务进度怎么样了', 'chat');

      expect(result.intentType).toBe(INTENT_TYPES.TASK_QUERY);
      expect(result.strategy.semantic).toBe(true);
    });

    it('GENERAL: 无明确意图时回退到 general 策略', async () => {
      const { routeMemory, INTENT_TYPES } = await import('../../memory-router.js');

      const result = routeMemory('你好', 'chat');

      expect(result.intentType).toBe(INTENT_TYPES.GENERAL);
      // GENERAL 策略均衡开启所有维度
      expect(result.strategy.semantic).toBe(true);
      expect(result.strategy.episodic).toBe(true);
      expect(result.strategy.events).toBe(true);
    });
  });

  // ─── 2. routeMemory → buildMemoryContext 跨模块联动 ──────────────────────

  describe('routeMemory → buildMemoryContext 策略传递', () => {
    it('SELF_REFLECTION 查询：buildMemoryContext 激活 episodic 路径（memory_stream 查询）', async () => {
      const { buildMemoryContext } = await import('../../memory-retriever.js');

      // 'chat' 模式 + '你在想什么' → SELF_REFLECTION → episodic=true
      await buildMemoryContext({
        query: '你在想什么',
        mode: 'chat',
        tokenBudget: 200,
        pool: mockPool,
      });

      // 验证：episodic 路径触发了 memory_stream 查询
      const episodicQuery = mockPool.query.mock.calls.some(
        ([sql]) => typeof sql === 'string' && sql.includes('memory_stream')
      );
      expect(episodicQuery).toBe(true);
    });

    it('STATUS_CHECK 查询：buildMemoryContext 不触发 episodic memory_stream 查询', async () => {
      const { buildMemoryContext } = await import('../../memory-retriever.js');

      // '系统状态' → STATUS_CHECK → events=true, episodic=false
      await buildMemoryContext({
        query: '系统状态告警',
        mode: 'chat',
        tokenBudget: 200,
        pool: mockPool,
      });

      // STATUS_CHECK: episodic=false → 不应有带 embedding 的 memory_stream 查询
      // 对比 SELF_REFLECTION：有 memory_stream 查询（episodic=true）
      // STATUS_CHECK: memory_stream 的 cosine similarity 查询（embedding IS NOT NULL）不应出现
      const embeddingMemoryStreamQuery = mockPool.query.mock.calls.some(
        ([sql]) => typeof sql === 'string' &&
          sql.includes('memory_stream') &&
          sql.includes('embedding')
      );
      expect(embeddingMemoryStreamQuery).toBe(false);
    });

    it('buildMemoryContext 返回 block 和 meta 结构（跨模块追踪）', async () => {
      const { buildMemoryContext } = await import('../../memory-retriever.js');

      const result = await buildMemoryContext({
        query: '你在想什么',
        mode: 'chat',
        tokenBudget: 300,
        pool: mockPool,
      });

      // 验证返回结构有 block 和 meta
      expect(result).toHaveProperty('block');
      expect(result).toHaveProperty('meta');
      expect(typeof result.block).toBe('string');
    });

    it('TASK_QUERY：buildMemoryContext 尝试语义搜索路径（searchRelevantLearnings 被调用）', async () => {
      const { buildMemoryContext } = await import('../../memory-retriever.js');
      const { searchRelevantLearnings } = await import('../../learning.js');

      await buildMemoryContext({
        query: '任务经验教训学习',
        mode: 'execute',
        tokenBudget: 400,
        pool: mockPool,
      });

      // TASK_QUERY: semantic=true → searchSemanticMemory 被激活
      // searchSemanticMemory 内部调用 searchRelevantLearnings（learnings 语义搜索）
      // 对比 STATUS_CHECK（semantic=false）：searchRelevantLearnings 不会被调用
      expect(searchRelevantLearnings).toHaveBeenCalled();
    });
  });

  // ─── 3. MEMORY_STRATEGY 配置完整性验证 ────────────────────────────────────

  describe('MEMORY_STRATEGY 配置验证', () => {
    it('所有意图类型都有完整的策略配置', async () => {
      const { INTENT_TYPES, MEMORY_STRATEGY } = await import('../../memory-router.js');

      for (const intentType of Object.values(INTENT_TYPES)) {
        const strategy = MEMORY_STRATEGY[intentType];
        expect(strategy).toBeDefined();
        expect(typeof strategy.semantic).toBe('boolean');
        expect(typeof strategy.episodic).toBe('boolean');
        expect(typeof strategy.events).toBe('boolean');
        expect(typeof strategy.episodicBudget).toBe('number');
        expect(typeof strategy.semanticBudget).toBe('number');
        expect(typeof strategy.eventsBudget).toBe('number');
      }
    });

    it('SELF_REFLECTION 策略：episodic 优先，semantic=false', async () => {
      const { INTENT_TYPES, MEMORY_STRATEGY } = await import('../../memory-router.js');

      const strategy = MEMORY_STRATEGY[INTENT_TYPES.SELF_REFLECTION];
      expect(strategy.episodic).toBe(true);
      expect(strategy.semantic).toBe(false);
      expect(strategy.episodicBudget).toBeGreaterThan(0);
      expect(strategy.semanticBudget).toBe(0);
    });

    it('STATUS_CHECK 策略：只启用 events，禁用 semantic 和 episodic', async () => {
      const { INTENT_TYPES, MEMORY_STRATEGY } = await import('../../memory-router.js');

      const strategy = MEMORY_STRATEGY[INTENT_TYPES.STATUS_CHECK];
      expect(strategy.events).toBe(true);
      expect(strategy.semantic).toBe(false);
      expect(strategy.episodic).toBe(false);
    });
  });
});
