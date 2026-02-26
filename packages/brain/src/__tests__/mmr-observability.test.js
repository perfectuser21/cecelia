/**
 * MMR 重排 + 可观测性 测试 (Phase 3)
 *
 * 测试覆盖：
 * - mmrRerank: 基本排序、topK 截断、空输入、多样性保证
 * - buildMemoryContext: 使用 mmrRerank
 * - recordMemoryRetrieval: 可观测性事件写入
 * - 错误容忍：可观测性写入失败不影响主流程
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// Tests: mmrRerank (pure function, no mocks needed)
// ============================================================

import {
  mmrRerank,
  simpleDedup,
  jaccardSimilarity,
} from '../memory-retriever.js';

describe('mmrRerank', () => {
  it('should return empty array for empty input', () => {
    expect(mmrRerank([], 5)).toEqual([]);
    expect(mmrRerank(null, 5)).toEqual([]);
    expect(mmrRerank(undefined, 5)).toEqual([]);
  });

  it('should return empty array when topK is 0', () => {
    const candidates = [
      { text: 'hello world', finalScore: 1.0 },
    ];
    expect(mmrRerank(candidates, 0)).toEqual([]);
  });

  it('should return at most topK items', () => {
    const candidates = [
      { text: 'item one about auth', finalScore: 0.9 },
      { text: 'item two about network', finalScore: 0.8 },
      { text: 'item three about database', finalScore: 0.7 },
      { text: 'item four about cache', finalScore: 0.6 },
      { text: 'item five about logging', finalScore: 0.5 },
    ];
    const result = mmrRerank(candidates, 3);
    expect(result.length).toBe(3);
  });

  it('should select highest scored item first', () => {
    const candidates = [
      { text: 'low score item about testing', finalScore: 0.3 },
      { text: 'high score item about deployment', finalScore: 0.9 },
      { text: 'medium score item about monitoring', finalScore: 0.6 },
    ];
    const result = mmrRerank(candidates, 3);
    expect(result[0].finalScore).toBe(0.9);
  });

  it('should prefer diversity over duplicates', () => {
    // Two near-identical items and one different
    const candidates = [
      { text: 'auth error in login service causes failure', finalScore: 0.9 },
      { text: 'auth error in login service causes crash', finalScore: 0.85 },
      { text: 'network timeout in payment gateway', finalScore: 0.7 },
    ];
    const result = mmrRerank(candidates, 2);

    // First should be highest score
    expect(result[0].text).toContain('auth error');
    expect(result[0].finalScore).toBe(0.9);

    // Second should prefer diversity: network item over similar auth item
    expect(result[1].text).toContain('network timeout');
  });

  it('should handle all identical texts', () => {
    const candidates = [
      { text: 'same content here', finalScore: 0.9 },
      { text: 'same content here', finalScore: 0.8 },
      { text: 'same content here', finalScore: 0.7 },
    ];
    const result = mmrRerank(candidates, 3);
    expect(result.length).toBe(3);
    expect(result[0].finalScore).toBe(0.9);
  });

  it('should return all items when topK >= candidates.length', () => {
    const candidates = [
      { text: 'item alpha', finalScore: 0.5 },
      { text: 'item beta', finalScore: 0.3 },
    ];
    const result = mmrRerank(candidates, 10);
    expect(result.length).toBe(2);
  });

  it('should handle lambda=1.0 (pure relevance)', () => {
    const candidates = [
      { text: 'auth error login failure', finalScore: 0.9 },
      { text: 'auth error login crash', finalScore: 0.85 },
      { text: 'network timeout', finalScore: 0.7 },
    ];
    const result = mmrRerank(candidates, 3, 1.0);
    expect(result[0].finalScore).toBe(0.9);
    expect(result[1].finalScore).toBe(0.85);
    expect(result[2].finalScore).toBe(0.7);
  });

  it('should handle lambda=0.0 (pure diversity)', () => {
    const candidates = [
      { text: 'auth error login failure', finalScore: 0.9 },
      { text: 'auth error login crash', finalScore: 0.85 },
      { text: 'network timeout gateway error', finalScore: 0.7 },
    ];
    const result = mmrRerank(candidates, 3, 0.0);
    expect(result.length).toBe(3);
  });
});

describe('simpleDedup (backward compatibility)', () => {
  it('should still be exported and functional', () => {
    const scored = [
      { text: 'unique text about auth', finalScore: 0.9 },
      { text: 'unique text about auth errors', finalScore: 0.5 },
      { text: 'completely different content about networking', finalScore: 0.8 },
    ];
    const result = simpleDedup(scored, 0.8);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(scored.length);
  });
});

// ============================================================
// Tests: recordMemoryRetrieval (observability)
// ============================================================

describe('recordMemoryRetrieval', () => {
  let recordMemoryRetrieval;
  let mockDbPool;

  beforeEach(async () => {
    vi.resetModules();
    mockDbPool = { query: vi.fn() };

    vi.doMock('../db.js', () => ({ default: mockDbPool }));
    vi.doMock('../openai-client.js', () => ({
      generateEmbedding: vi.fn(),
    }));
    vi.doMock('../memory-retriever.js', () => ({
      buildMemoryContext: vi.fn().mockResolvedValue({ block: '', meta: {} }),
    }));
    vi.doMock('../learning.js', () => ({
      getRecentLearnings: vi.fn().mockResolvedValue([]),
      searchRelevantLearnings: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('../llm-caller.js', () => ({
      callLLM: vi.fn(),
    }));

    const mod = await import('../thalamus.js');
    recordMemoryRetrieval = mod.recordMemoryRetrieval;
  });

  it('should write memory_retrieval event to cecelia_events', async () => {
    mockDbPool.query.mockResolvedValue({ rows: [] });

    await recordMemoryRetrieval(mockDbPool, 'auth error query', 'execute', {
      candidates: 15,
      injected: 5,
      sources: ['task', 'task', 'learning', 'event', 'task'],
      tokenUsed: 600,
      tokenBudget: 800,
    }, 'task_failed');

    expect(mockDbPool.query).toHaveBeenCalledWith(
      expect.stringContaining('memory_retrieval'),
      expect.arrayContaining([expect.stringContaining('auth error query')])
    );

    const payload = JSON.parse(mockDbPool.query.mock.calls[0][1][0]);
    expect(payload.query).toBe('auth error query');
    expect(payload.mode).toBe('execute');
    expect(payload.candidates_count).toBe(15);
    expect(payload.injected_count).toBe(5);
    expect(payload.injected_sources).toEqual(['task', 'task', 'learning', 'event', 'task']);
    expect(payload.token_used).toBe(600);
    expect(payload.token_budget).toBe(800);
    expect(payload.trigger_event_type).toBe('task_failed');
    expect(payload.timestamp).toBeDefined();
  });

  it('should truncate query to 200 chars', async () => {
    mockDbPool.query.mockResolvedValue({ rows: [] });

    const longQuery = 'a'.repeat(500);
    await recordMemoryRetrieval(mockDbPool, longQuery, 'debug', {
      candidates: 3, injected: 1, sources: ['task'], tokenUsed: 100, tokenBudget: 800,
    }, 'alert');

    const payload = JSON.parse(mockDbPool.query.mock.calls[0][1][0]);
    expect(payload.query.length).toBe(200);
  });

  it('should handle null meta gracefully', async () => {
    mockDbPool.query.mockResolvedValue({ rows: [] });

    await recordMemoryRetrieval(mockDbPool, 'test query', 'execute', null, 'task_completed');

    const payload = JSON.parse(mockDbPool.query.mock.calls[0][1][0]);
    expect(payload.candidates_count).toBe(0);
    expect(payload.injected_count).toBe(0);
    expect(payload.injected_sources).toEqual([]);
    expect(payload.token_used).toBe(0);
  });

  it('should silently fail on DB error', async () => {
    mockDbPool.query.mockRejectedValue(new Error('DB connection lost'));

    await expect(
      recordMemoryRetrieval(mockDbPool, 'test', 'execute', { candidates: 1 }, 'alert')
    ).resolves.toBeUndefined();
  });

  it('should handle empty query', async () => {
    mockDbPool.query.mockResolvedValue({ rows: [] });

    await recordMemoryRetrieval(mockDbPool, '', 'plan', {
      candidates: 0, injected: 0, sources: [], tokenUsed: 0, tokenBudget: 800,
    }, 'task_completed');

    const payload = JSON.parse(mockDbPool.query.mock.calls[0][1][0]);
    expect(payload.query).toBe('');
    expect(payload.mode).toBe('plan');
  });
});

// ============================================================
// Tests: Integration — analyzeEvent records memory_retrieval
// ============================================================

describe('analyzeEvent memory_retrieval integration', () => {
  let analyzeEvent;
  let mockDbPool;
  let mockCallLLM;

  beforeEach(async () => {
    vi.resetModules();
    mockDbPool = { query: vi.fn() };
    mockCallLLM = vi.fn();

    vi.doMock('../db.js', () => ({ default: mockDbPool }));
    vi.doMock('../openai-client.js', () => ({
      generateEmbedding: vi.fn(),
    }));

    vi.doMock('../memory-retriever.js', () => ({
      buildMemoryContext: vi.fn().mockResolvedValue({
        block: '## test memory block',
        meta: {
          candidates: 10,
          injected: 3,
          tokenUsed: 400,
          tokenBudget: 800,
          sources: ['task', 'learning', 'event'],
        },
      }),
    }));
    vi.doMock('../learning.js', () => ({
      getRecentLearnings: vi.fn().mockResolvedValue([]),
      searchRelevantLearnings: vi.fn().mockResolvedValue([]),
    }));

    // Mock 统一 LLM 调用层
    vi.doMock('../llm-caller.js', () => ({
      callLLM: mockCallLLM,
    }));

    const mod = await import('../thalamus.js');
    analyzeEvent = mod.analyzeEvent;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call recordMemoryRetrieval after successful decision', async () => {
    // callLLM 返回包含 decision JSON 的文本
    const decisionJson = JSON.stringify({
      level: 1,
      rationale: 'Test reasoning for decision',
      confidence: 0.8,
      safety: false,
      actions: [{ type: 'log_event', params: { message: 'test' } }],
    });
    mockCallLLM.mockResolvedValue({
      text: '```json\n' + decisionJson + '\n```',
      model: 'test-model',
      provider: 'test',
      elapsed_ms: 50,
    });

    mockDbPool.query.mockResolvedValue({ rows: [] });

    const decision = await analyzeEvent({
      type: 'task_completed',
      payload: { task_id: 'test-1' },
    });

    expect(decision).toBeDefined();
    expect(decision.level).toBe(1);

    // Wait for fire-and-forget
    await new Promise(r => setTimeout(r, 50));

    // Check that memory_retrieval event was recorded
    const memoryRetrievalCalls = mockDbPool.query.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('memory_retrieval')
    );
    expect(memoryRetrievalCalls.length).toBe(1);
  });

  it('should not fail analyzeEvent if memory_retrieval recording fails', async () => {
    const decisionJson2 = JSON.stringify({
      level: 1,
      rationale: 'Test decision rationale',
      confidence: 0.8,
      safety: false,
      actions: [{ type: 'log_event', params: { message: 'test' } }],
    });
    mockCallLLM.mockResolvedValue({
      text: '```json\n' + decisionJson2 + '\n```',
      model: 'test-model',
      provider: 'test',
      elapsed_ms: 50,
    });

    mockDbPool.query.mockImplementation(async (sql) => {
      if (typeof sql === 'string' && sql.includes('memory_retrieval')) {
        throw new Error('DB write failed');
      }
      return { rows: [] };
    });

    const decision = await analyzeEvent({
      type: 'task_failed',
      payload: { task_id: 'test-2', error: 'timeout' },
    });

    expect(decision).toBeDefined();

    // Wait for fire-and-forget
    await new Promise(r => setTimeout(r, 50));
  });
});
