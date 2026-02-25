/**
 * 测试 vectorSearch() 中 capabilities 搜索路径
 *
 * DoD 映射：
 * - vectorSearch 查 capabilities → "返回 capability 结果"
 * - score > 0.5 → "score 阈值"
 * - 无 embedding 跳过 → "跳过无 embedding"
 * - task 搜索不受影响 → "task 路径不变"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import SimilarityService from '../similarity.js';

// Mock openai-client 避免真实 API 调用
vi.mock('../openai-client.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0.1))
}));

function makePool(taskRows = [], capRows = []) {
  return {
    query: vi.fn().mockImplementation((sql) => {
      if (sql.includes('FROM capabilities')) {
        return Promise.resolve({ rows: capRows });
      }
      if (sql.includes('FROM tasks')) {
        return Promise.resolve({ rows: taskRows });
      }
      return Promise.resolve({ rows: [] });
    })
  };
}

describe('vectorSearch — capabilities 搜索', () => {
  it('返回 capability 结果（level=capability）', async () => {
    const pool = makePool([], [
      { id: 'circuit-breaker', name: '熔断保护系统', description: '按服务熔断', current_stage: 3, vector_score: 0.67 }
    ]);
    const sim = new SimilarityService(pool);
    const { matches } = await sim.vectorSearch(new Array(1536).fill(0.1));

    expect(matches.length).toBe(1);
    expect(matches[0].level).toBe('capability');
    expect(matches[0].title).toBe('熔断保护系统');
  });

  it('score 字段正确传递', async () => {
    const pool = makePool([], [
      { id: 'cap-1', name: '测试能力', description: '', current_stage: 2, vector_score: 0.72 }
    ]);
    const sim = new SimilarityService(pool);
    const { matches } = await sim.vectorSearch(new Array(1536).fill(0.1));

    expect(matches[0].score).toBeCloseTo(0.72);
  });

  it('无 embedding 的 capabilities 不出现（查询带 WHERE embedding IS NOT NULL）', async () => {
    const pool = makePool();
    const sim = new SimilarityService(pool);
    await sim.vectorSearch(new Array(1536).fill(0.1));

    const capCall = pool.query.mock.calls.find(([sql]) => sql.includes('FROM capabilities'));
    expect(capCall).toBeDefined();
    expect(capCall[0]).toContain('embedding IS NOT NULL');
  });

  it('task 搜索路径不受影响', async () => {
    const pool = makePool(
      [{ id: 'task-1', title: '任务A', description: '', status: 'completed', metadata: null, project_id: null, vector_score: 0.5 }],
      [{ id: 'cap-1', name: '能力A', description: '', current_stage: 1, vector_score: 0.6 }]
    );
    const sim = new SimilarityService(pool);
    const { matches } = await sim.vectorSearch(new Array(1536).fill(0.1));

    const taskMatch = matches.find(m => m.level === 'task');
    const capMatch = matches.find(m => m.level === 'capability');
    expect(taskMatch).toBeDefined();
    expect(capMatch).toBeDefined();
  });

  it('结果按 score 降序合并排序', async () => {
    const pool = makePool(
      [{ id: 'task-1', title: '低分任务', description: '', status: 'completed', metadata: null, project_id: null, vector_score: 0.3 }],
      [{ id: 'cap-1', name: '高分能力', description: '', current_stage: 3, vector_score: 0.8 }]
    );
    const sim = new SimilarityService(pool);
    const { matches } = await sim.vectorSearch(new Array(1536).fill(0.1));

    expect(matches[0].score).toBeGreaterThan(matches[1].score);
    expect(matches[0].level).toBe('capability');
  });
});
