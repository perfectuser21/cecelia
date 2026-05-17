/**
 * memory-selection-log.test.js
 * 验证 memory-retriever.js 结构化 log 输出和 fetchStatus 分类
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 依赖
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../similarity.js', () => ({
  default: vi.fn().mockImplementation(() => ({
    searchWithVectors: vi.fn().mockResolvedValue({ matches: [] }),
  })),
}));
vi.mock('../learning.js', () => ({
  searchRelevantLearnings: vi.fn().mockResolvedValue([]),
}));
vi.mock('../memory-router.js', () => ({
  routeMemory: vi.fn().mockReturnValue({
    strategy: { semantic: true, episodic: false, events: true, episodicBudget: 0 },
  }),
}));
vi.mock('../memory-utils.js', () => ({
  generateL0Summary: vi.fn().mockReturnValue('summary'),
  generateMemoryStreamL1Async: vi.fn(),
}));
vi.mock('../openai-client.js', () => ({
  generateEmbedding: vi.fn().mockRejectedValue(new Error('no key')),
}));

import {
  buildMemoryContext,
  CHAT_TOKEN_BUDGET,
} from '../memory-retriever.js';

// 创建一个 mock pool 工厂
function makePool(queryImpl) {
  return { query: vi.fn(queryImpl || (() => Promise.resolve({ rows: [] }))) };
}

describe('_classifyError（通过 buildMemoryContext 间接验证）', () => {
  it('too many clients → errors 含 pool_exhausted', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const pool = makePool(() => Promise.reject(new Error('sorry, too many clients already')));

    await buildMemoryContext({ query: '测试', mode: 'chat', tokenBudget: 2500, pool });

    const calls = consoleSpy.mock.calls.filter(c => c[0] === '[memory]');
    expect(calls.length).toBeGreaterThan(0);
    const logged = JSON.parse(calls[0][1]);
    expect(logged.errors).toContain('conversation:pool_exhausted');
    consoleSpy.mockRestore();
  });

  it('其他 DB 错误 → errors 含 db_error', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const pool = makePool(() => Promise.reject(new Error('connection refused')));

    await buildMemoryContext({ query: '测试', mode: 'chat', tokenBudget: 2500, pool });

    const calls = consoleSpy.mock.calls.filter(c => c[0] === '[memory]');
    const logged = JSON.parse(calls[0][1]);
    expect(logged.errors).toContain('conversation:db_error');
    consoleSpy.mockRestore();
  });
});

describe('buildMemoryContext - 结构化 log 输出', () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('每次调用必须打 [memory] log', async () => {
    const pool = makePool();
    await buildMemoryContext({ query: '任务进展', mode: 'chat', tokenBudget: CHAT_TOKEN_BUDGET, pool });

    const memoryLogs = consoleSpy.mock.calls.filter(c => c[0] === '[memory]');
    expect(memoryLogs.length).toBeGreaterThanOrEqual(1);
  });

  it('log 包含 tag: memory_selection', async () => {
    const pool = makePool();
    await buildMemoryContext({ query: '任务进展', mode: 'chat', tokenBudget: CHAT_TOKEN_BUDGET, pool });

    const logged = JSON.parse(consoleSpy.mock.calls.find(c => c[0] === '[memory]')[1]);
    expect(logged.tag).toBe('memory_selection');
  });

  it('log 包含 intentType', async () => {
    const pool = makePool();
    await buildMemoryContext({ query: '任务进展', mode: 'chat', tokenBudget: CHAT_TOKEN_BUDGET, pool });

    const logged = JSON.parse(consoleSpy.mock.calls.find(c => c[0] === '[memory]')[1]);
    expect(logged).toHaveProperty('intentType');
    expect(logged.intentType).toBe('task_focused');
  });

  it('log 包含 tokenBudget 和 tokenUsed', async () => {
    const pool = makePool();
    await buildMemoryContext({ query: '测试', mode: 'chat', tokenBudget: 2500, pool });

    const logged = JSON.parse(consoleSpy.mock.calls.find(c => c[0] === '[memory]')[1]);
    expect(logged.tokenBudget).toBe(2500);
    expect(typeof logged.tokenUsed).toBe('number');
  });

  it('log 包含 candidateTotal 和 injectedTotal', async () => {
    const pool = makePool();
    await buildMemoryContext({ query: '测试', mode: 'chat', tokenBudget: 2500, pool });

    const logged = JSON.parse(consoleSpy.mock.calls.find(c => c[0] === '[memory]')[1]);
    expect(typeof logged.candidateTotal).toBe('number');
    expect(typeof logged.injectedTotal).toBe('number');
  });

  it('log 包含 embeddingMode', async () => {
    const pool = makePool();
    await buildMemoryContext({ query: '测试', mode: 'chat', tokenBudget: 2500, pool });

    const logged = JSON.parse(consoleSpy.mock.calls.find(c => c[0] === '[memory]')[1]);
    expect(['openai', 'jaccard']).toContain(logged.embeddingMode);
  });

  it('log 包含 fetch.semantic.fetchStatus', async () => {
    const pool = makePool();
    await buildMemoryContext({ query: '测试', mode: 'chat', tokenBudget: 2500, pool });

    const logged = JSON.parse(consoleSpy.mock.calls.find(c => c[0] === '[memory]')[1]);
    expect(logged.fetch).toBeDefined();
    expect(logged.fetch.semantic).toBeDefined();
    expect(typeof logged.fetch.semantic.fetchStatus).toBe('string');
  });

  it('log 包含 fetch.conversation.fetchStatus', async () => {
    const pool = makePool();
    await buildMemoryContext({ query: '测试', mode: 'chat', tokenBudget: 2500, pool });

    const logged = JSON.parse(consoleSpy.mock.calls.find(c => c[0] === '[memory]')[1]);
    expect(logged.fetch.conversation).toBeDefined();
    expect(typeof logged.fetch.conversation.fetchStatus).toBe('string');
  });

  it('log 包含 fetch.profile.fetchStatus', async () => {
    const pool = makePool();
    await buildMemoryContext({ query: '测试', mode: 'chat', tokenBudget: 2500, pool });

    const logged = JSON.parse(consoleSpy.mock.calls.find(c => c[0] === '[memory]')[1]);
    expect(logged.fetch.profile).toBeDefined();
    expect(typeof logged.fetch.profile.fetchStatus).toBe('string');
  });

  it('log 包含 selected 字段', async () => {
    const pool = makePool();
    await buildMemoryContext({ query: '测试', mode: 'chat', tokenBudget: 2500, pool });

    const logged = JSON.parse(consoleSpy.mock.calls.find(c => c[0] === '[memory]')[1]);
    expect(logged).toHaveProperty('selected');
    expect(typeof logged.selected).toBe('object');
  });

  it('log 包含 errors 数组', async () => {
    const pool = makePool();
    await buildMemoryContext({ query: '测试', mode: 'chat', tokenBudget: 2500, pool });

    const logged = JSON.parse(consoleSpy.mock.calls.find(c => c[0] === '[memory]')[1]);
    expect(Array.isArray(logged.errors)).toBe(true);
  });

  it('非 chat 模式下 conversation/episodic fetchStatus 为 disabled', async () => {
    const pool = makePool();
    await buildMemoryContext({ query: '测试', mode: 'execute', tokenBudget: 800, pool });

    const logged = JSON.parse(consoleSpy.mock.calls.find(c => c[0] === '[memory]')[1]);
    expect(logged.fetch.conversation.fetchStatus).toBe('disabled');
    expect(logged.fetch.episodic.fetchStatus).toBe('disabled');
  });

  it('有数据注入时 selected 有对应 source 统计', async () => {
    // Mock conversation 返回数据
    const pool = makePool((sql) => {
      if (typeof sql === 'string' && sql.includes('orchestrator_chat')) {
        return Promise.resolve({
          rows: [
            { id: '1', payload: JSON.stringify({ user_message: '测试问题', reply: '测试回复' }), created_at: new Date().toISOString() },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    await buildMemoryContext({ query: '测试', mode: 'chat', tokenBudget: 2500, pool });

    const logged = JSON.parse(consoleSpy.mock.calls.find(c => c[0] === '[memory]')[1]);
    // selected 可能有 conversation 条目
    if (logged.injectedTotal > 0) {
      const hasSomeSource = Object.keys(logged.selected).length > 0;
      expect(hasSomeSource).toBe(true);
    }
  });

  it('pool_exhausted 不在 errors 且数据是 no_results 时 errors 为空', async () => {
    // 正常 pool，但无数据
    const pool = makePool(() => Promise.resolve({ rows: [] }));
    await buildMemoryContext({ query: '测试', mode: 'chat', tokenBudget: 2500, pool });

    const logged = JSON.parse(consoleSpy.mock.calls.find(c => c[0] === '[memory]')[1]);
    expect(logged.errors).toHaveLength(0);
  });
});
