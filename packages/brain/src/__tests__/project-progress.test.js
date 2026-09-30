/**
 * project-progress.js 单元测试（棒5，接力棒链 2afa6d69，决策 ee4842a6/3feeae3e）
 *
 * mock pool：验证聚合公式本身（project 完成率 / KR 平均）和边界（无 project、无任务）。
 * 真库场景（cancelled 任务真被排除、写 key_results.progress）见
 * __tests__/integration/kr-progress-project-aggregation.integration.test.js。
 */

import { describe, it, expect, vi } from 'vitest';
import {
  getProjectsForKrBatch,
  getProjectsForKr,
  computeKrProgressFromProjects,
} from '../project-progress.js';

function makeMockPool({ projects = [], taskStats = [] } = {}) {
  return {
    query: vi.fn(async (sql) => {
      if (/FROM\s+projects\b/.test(sql)) {
        return { rows: projects };
      }
      if (/FROM\s+tasks\b/.test(sql)) {
        return { rows: taskStats };
      }
      return { rows: [] };
    }),
  };
}

describe('getProjectsForKrBatch', () => {
  it('krIds 为空数组时不查库，返回 {}', async () => {
    const pool = { query: vi.fn() };
    const result = await getProjectsForKrBatch(pool, []);
    expect(result).toEqual({});
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('某 KR 下无 project 时不发第二条任务统计查询', async () => {
    const pool = makeMockPool({ projects: [] });
    const result = await getProjectsForKrBatch(pool, ['kr-1']);
    expect(result).toEqual({});
    // 只发了一次 FROM projects 查询，没有 FROM tasks 查询
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('project 有任务时按 completed/completed_no_pr 占比算进度', async () => {
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
    const byKr = await getProjectsForKrBatch(pool, ['kr-1']);
    const p1 = byKr['kr-1'].find((p) => p.id === 'p1');
    const p2 = byKr['kr-1'].find((p) => p.id === 'p2');
    expect(p1.progress).toBeCloseTo(66.67, 1);
    expect(p1.task_total).toBe(3);
    expect(p1.task_done).toBe(2);
    expect(p2.progress).toBe(100);
  });

  it('project 无任务时按 status 映射：completed→100，其它→0', async () => {
    const pool = makeMockPool({
      projects: [
        { id: 'p1', name: 'P1', status: 'completed', kr_id: 'kr-1' },
        { id: 'p2', name: 'P2', status: 'active', kr_id: 'kr-1' },
        { id: 'p3', name: 'P3', status: 'planning', kr_id: 'kr-1' },
      ],
      taskStats: [],
    });
    const byKr = await getProjectsForKrBatch(pool, ['kr-1']);
    const byId = Object.fromEntries(byKr['kr-1'].map((p) => [p.id, p]));
    expect(byId.p1.progress).toBe(100);
    expect(byId.p2.progress).toBe(0);
    expect(byId.p3.progress).toBe(0);
  });

  it('多个 KR 各自分桶', async () => {
    const pool = makeMockPool({
      projects: [
        { id: 'p1', name: 'P1', status: 'active', kr_id: 'kr-1' },
        { id: 'p2', name: 'P2', status: 'active', kr_id: 'kr-2' },
      ],
      taskStats: [],
    });
    const byKr = await getProjectsForKrBatch(pool, ['kr-1', 'kr-2']);
    expect(byKr['kr-1']).toHaveLength(1);
    expect(byKr['kr-2']).toHaveLength(1);
    expect(byKr['kr-1'][0].id).toBe('p1');
    expect(byKr['kr-2'][0].id).toBe('p2');
  });
});

describe('getProjectsForKr', () => {
  it('krId 为空时不查库，返回空数组', async () => {
    const pool = { query: vi.fn() };
    const result = await getProjectsForKr(pool, null);
    expect(result).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('computeKrProgressFromProjects', () => {
  it('无 project 时 hasProjects=false，progress=null', async () => {
    const pool = makeMockPool({ projects: [] });
    const result = await computeKrProgressFromProjects(pool, 'kr-1');
    expect(result.hasProjects).toBe(false);
    expect(result.progress).toBeNull();
    expect(result.projectCount).toBe(0);
  });

  it('KR 进度 = 各 project 进度算术平均（等权），四舍五入取整', async () => {
    const pool = makeMockPool({
      projects: [
        { id: 'p1', name: 'P1', status: 'active', kr_id: 'kr-1' },
        { id: 'p2', name: 'P2', status: 'active', kr_id: 'kr-1' },
      ],
      taskStats: [
        { project_id: 'p1', total: 3, done: 2 }, // 66.67
        { project_id: 'p2', total: 2, done: 2 }, // 100
      ],
    });
    const result = await computeKrProgressFromProjects(pool, 'kr-1');
    expect(result.hasProjects).toBe(true);
    expect(result.projectCount).toBe(2);
    // (66.67 + 100) / 2 = 83.335 → round → 83
    expect(result.progress).toBe(83);
  });
});
