/**
 * KR Convergence Engine 单元测试
 *
 * 测试评分逻辑的正确性，包括边界情况：
 * - 0 个 KR
 * - 全部 0 分（无进度、无项目、无任务）
 * - 并列分排序
 * - 进度高 → 分高
 * - 无项目 → 分低
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({
  default: null,
}));

import { computeKrConvergence } from '../kr-convergence.js';

function makeMockPool(responses) {
  return {
    query: vi.fn(async (sql) => {
      if (sql.includes('FROM key_results')) {
        return { rows: responses.krs || [] };
      }
      if (sql.includes('FROM okr_projects') && !sql.includes('tasks')) {
        return { rows: responses.projectCounts || [] };
      }
      if (sql.includes('tasks')) {
        return { rows: responses.taskCounts || [] };
      }
      return { rows: [] };
    }),
  };
}

describe('computeKrConvergence', () => {
  describe('边界情况', () => {
    it('0 个 KR 时返回空 top3 和空 pause_candidates', async () => {
      const pool = makeMockPool({ krs: [] });
      const result = await computeKrConvergence(pool);

      expect(result.active_kr_count).toBe(0);
      expect(result.top3).toEqual([]);
      expect(result.pause_candidates).toEqual([]);
      expect(result.all_ranked).toEqual([]);
      expect(result.computed_at).toBeTruthy();
    });

    it('全部 0 分（无进度、无项目、无任务、无指标）时 score 为 0', async () => {
      const krs = [
        { id: 'kr-1', title: 'KR 1', status: 'active', progress: 0, priority: 'P1', metadata: {} },
        { id: 'kr-2', title: 'KR 2', status: 'active', progress: 0, priority: 'P1', metadata: null },
      ];
      const pool = makeMockPool({ krs, projectCounts: [], taskCounts: [] });
      const result = await computeKrConvergence(pool);

      expect(result.active_kr_count).toBe(2);
      result.top3.forEach(kr => {
        expect(kr.score).toBe(0);
      });
    });

    it('只有 1 个 KR 时 top3 长度为 1，pause_candidates 为空', async () => {
      const krs = [
        { id: 'kr-1', title: '管家闭环', status: 'active', progress: 13, priority: 'P1', metadata: { metric_current: '4' } },
      ];
      const pool = makeMockPool({ krs, projectCounts: [], taskCounts: [] });
      const result = await computeKrConvergence(pool);

      expect(result.top3).toHaveLength(1);
      expect(result.pause_candidates).toHaveLength(0);
    });
  });

  describe('评分逻辑', () => {
    it('进度高的 KR 得分高于进度低的 KR', async () => {
      const krs = [
        { id: 'kr-low', title: 'KR 低进度', status: 'active', progress: 0, priority: 'P1', metadata: {} },
        { id: 'kr-high', title: 'KR 高进度', status: 'active', progress: 80, priority: 'P1', metadata: {} },
      ];
      const pool = makeMockPool({ krs, projectCounts: [], taskCounts: [] });
      const result = await computeKrConvergence(pool);

      const highKr = result.all_ranked.find(k => k.id === 'kr-high');
      const lowKr = result.all_ranked.find(k => k.id === 'kr-low');
      expect(highKr.score).toBeGreaterThan(lowKr.score);
      expect(highKr.rank).toBeLessThan(lowKr.rank);
    });

    it('有关联项目的 KR 得分高于无项目的 KR（其他条件相同）', async () => {
      const krs = [
        { id: 'kr-no-proj', title: 'KR 无项目', status: 'active', progress: 0, priority: 'P1', metadata: {} },
        { id: 'kr-has-proj', title: 'KR 有项目', status: 'active', progress: 0, priority: 'P1', metadata: {} },
      ];
      const projectCounts = [{ kr_id: 'kr-has-proj', project_count: '5' }];
      const pool = makeMockPool({ krs, projectCounts, taskCounts: [] });
      const result = await computeKrConvergence(pool);

      const withProj = result.all_ranked.find(k => k.id === 'kr-has-proj');
      const noProj = result.all_ranked.find(k => k.id === 'kr-no-proj');
      expect(withProj.score).toBeGreaterThan(noProj.score);
    });

    it('有指标动量（metric_current > 0）的 KR 得分更高', async () => {
      const krs = [
        { id: 'kr-no-metric', title: 'KR 无指标', status: 'active', progress: 0, priority: 'P1', metadata: { metric_current: '0' } },
        { id: 'kr-has-metric', title: 'KR 有指标', status: 'active', progress: 0, priority: 'P1', metadata: { metric_current: '4' } },
      ];
      const pool = makeMockPool({ krs, projectCounts: [], taskCounts: [] });
      const result = await computeKrConvergence(pool);

      const withMetric = result.all_ranked.find(k => k.id === 'kr-has-metric');
      const noMetric = result.all_ranked.find(k => k.id === 'kr-no-metric');
      expect(withMetric.score).toBeGreaterThan(noMetric.score);
    });

    it('并列分时 rank 连续递增，不跳号', async () => {
      const krs = [
        { id: 'kr-1', title: 'KR 1', status: 'active', progress: 0, priority: 'P1', metadata: {} },
        { id: 'kr-2', title: 'KR 2', status: 'active', progress: 0, priority: 'P1', metadata: {} },
        { id: 'kr-3', title: 'KR 3', status: 'active', progress: 0, priority: 'P1', metadata: {} },
      ];
      const pool = makeMockPool({ krs, projectCounts: [], taskCounts: [] });
      const result = await computeKrConvergence(pool);

      const ranks = result.all_ranked.map(k => k.rank);
      expect(ranks).toEqual([1, 2, 3]);
    });
  });

  describe('输出结构', () => {
    it('top3 中每个 KR 包含必要字段', async () => {
      const krs = [
        { id: 'kr-1', title: '管家闭环', status: 'active', progress: 13, priority: 'P1', metadata: { metric_current: '4' } },
        { id: 'kr-2', title: '系统稳定', status: 'active', progress: 0, priority: 'P1', metadata: {} },
        { id: 'kr-3', title: '数据闭环', status: 'active', progress: 0, priority: 'P1', metadata: {} },
        { id: 'kr-4', title: '自动发布', status: 'active', progress: 0, priority: 'P1', metadata: {} },
      ];
      const pool = makeMockPool({ krs, projectCounts: [], taskCounts: [] });
      const result = await computeKrConvergence(pool);

      expect(result.top3.length).toBeLessThanOrEqual(3);
      result.top3.forEach(kr => {
        expect(kr).toHaveProperty('id');
        expect(kr).toHaveProperty('title');
        expect(kr).toHaveProperty('score');
        expect(kr).toHaveProperty('rank');
        expect(kr).toHaveProperty('reason');
        expect(kr).toHaveProperty('progress');
      });
    });

    it('pause_candidates 包含 suggestion 字段（值为"暂停"或"降级"）', async () => {
      const krs = Array.from({ length: 5 }, (_, i) => ({
        id: `kr-${i}`,
        title: `KR ${i}`,
        status: 'active',
        progress: i * 5,
        priority: 'P1',
        metadata: {},
      }));
      const pool = makeMockPool({ krs, projectCounts: [], taskCounts: [] });
      const result = await computeKrConvergence(pool);

      expect(result.pause_candidates.length).toBeGreaterThan(0);
      result.pause_candidates.forEach(kr => {
        expect(['暂停', '降级']).toContain(kr.suggestion);
        expect(kr).toHaveProperty('reason');
      });
    });

    it('top3 长度不超过 3，active_kr_count 正确', async () => {
      const krs = Array.from({ length: 7 }, (_, i) => ({
        id: `kr-${i}`,
        title: `KR ${i}`,
        status: 'active',
        progress: i * 10,
        priority: 'P1',
        metadata: {},
      }));
      const pool = makeMockPool({ krs, projectCounts: [], taskCounts: [] });
      const result = await computeKrConvergence(pool);

      expect(result.top3.length).toBeLessThanOrEqual(3);
      expect(result.active_kr_count).toBe(7);
    });
  });
});
