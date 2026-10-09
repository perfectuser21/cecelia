/**
 * KR Progress Calculator 测试（棒5，决策 ee4842a6/3feeae3e，接力棒链 2afa6d69）
 *
 * kr-progress.js 委托 project-progress.js 算聚合，自己只负责"要不要写 key_results.progress"：
 *   - KR 有 project → 写 progress + metadata.progress_source='projects_v1'
 *   - KR 无 project → 不覆盖现值，直接回读
 *
 * project-progress.js 自身的聚合公式测试见 __tests__/project-progress.test.js；
 * 真库场景（cancelled 任务排除、DB 真写入）见
 * __tests__/integration/kr-progress-project-aggregation.integration.test.js。
 */

import { describe, it, expect, vi } from 'vitest';
import { updateKrProgress, syncAllKrProgress } from '../kr-progress.js';

function makeMockPool({ projects = [], taskStats = [], currentProgress = 0 } = {}) {
  return {
    query: vi.fn(async (sql) => {
      if (/FROM\s+projects\b/.test(sql)) return { rows: projects };
      if (/FROM\s+tasks\b/.test(sql)) return { rows: taskStats };
      if (/SELECT progress FROM key_results/.test(sql)) return { rows: [{ progress: currentProgress }] };
      if (/UPDATE key_results/.test(sql)) return { rows: [] };
      return { rows: [] };
    }),
  };
}

describe('updateKrProgress', () => {
  it('krId 为 null 时不查库，恒返回零变化', async () => {
    const pool = { query: vi.fn() };
    const result = await updateKrProgress(pool, null);
    expect(result).toEqual({ krId: null, progress: 0, completed: 0, total: 0 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('KR 无 project 时不写库，直接回读现值', async () => {
    const pool = makeMockPool({ projects: [], currentProgress: 42 });
    const result = await updateKrProgress(pool, 'kr-1');
    expect(result).toEqual({ krId: 'kr-1', progress: 42, completed: 0, total: 0 });
    // 没有 UPDATE 调用
    const updateCalls = pool.query.mock.calls.filter(([sql]) => /UPDATE key_results/.test(sql));
    expect(updateCalls).toHaveLength(0);
  });

  it('KR 有 project 时按平均进度写 key_results.progress + progress_source 标记', async () => {
    const pool = makeMockPool({
      projects: [
        { id: 'p1', name: 'P1', status: 'active', kr_id: 'kr-1' },
        { id: 'p2', name: 'P2', status: 'active', kr_id: 'kr-1' },
      ],
      taskStats: [
        { project_id: 'p1', total: 3, done: 2 },
        { project_id: 'p2', total: 2, done: 2 },
      ],
    });
    const result = await updateKrProgress(pool, 'kr-1');
    expect(result.krId).toBe('kr-1');
    expect(result.progress).toBe(83);
    expect(result.completed).toBe(1); // 只有 p2 达到 100
    expect(result.total).toBe(2);

    const updateCall = pool.query.mock.calls.find(([sql]) => /UPDATE key_results/.test(sql));
    expect(updateCall).toBeTruthy();
    expect(updateCall[1]).toEqual(['kr-1', 83]);
    expect(updateCall[0]).toContain('progress_source');
  });
});

describe('syncAllKrProgress', () => {
  it('排除已启用 kr_verifier 和 completed/cancelled 的 KR', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (/SELECT id FROM key_results/.test(sql)) return { rows: [{ id: 'kr-1' }] };
        if (/SELECT progress FROM key_results/.test(sql)) return { rows: [{ progress: 0 }] };
        if (/FROM\s+projects\b/.test(sql)) return { rows: [] };
        return { rows: [] };
      }),
    };
    const result = await syncAllKrProgress(pool);
    expect(result.updated).toBe(0); // kr-1 无 project，total=0，不计入 results
    const krQuery = pool.query.mock.calls[0][0];
    expect(krQuery).toContain("status NOT IN ('completed', 'cancelled')");
    expect(krQuery).toContain('kr_verifiers');
  });

  it('有 project 的 KR 计入 updated', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (/SELECT id FROM key_results/.test(sql)) return { rows: [{ id: 'kr-1' }] };
        if (/FROM\s+projects\b/.test(sql)) {
          return { rows: [{ id: 'p1', name: 'P1', status: 'completed', kr_id: 'kr-1' }] };
        }
        if (/FROM\s+tasks\b/.test(sql)) return { rows: [] };
        return { rows: [] };
      }),
    };
    const result = await syncAllKrProgress(pool);
    expect(result.updated).toBe(1);
    expect(result.results[0].krId).toBe('kr-1');
  });
});
