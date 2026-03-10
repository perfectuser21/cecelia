/**
 * project-compare 单元测试
 * 覆盖：正常路径（JSON/Markdown）、输入验证、项目不存在
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
}));

vi.mock('../db.js', () => ({ default: mockPool }));

import { generateCompareReport, getCompareMetrics } from '../project-compare.js';

const PROJECT_A = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  name: 'Project Alpha',
  type: 'initiative',
  status: 'active',
  created_at: new Date(),
  updated_at: new Date(),
};
const PROJECT_B = {
  id: 'bbbbbbbb-0000-0000-0000-000000000002',
  name: 'Project Beta',
  type: 'project',
  status: 'active',
  created_at: new Date(),
  updated_at: new Date(),
};

const TASK_STATS_A = {
  project_id: PROJECT_A.id,
  total: '10',
  completed: '7',
  in_progress: '2',
  queued: '1',
  failed: '0',
  quarantined: '0',
  p0_in_progress: '1',
  recent_active: '3',
};

const TASK_STATS_B = {
  project_id: PROJECT_B.id,
  total: '5',
  completed: '1',
  in_progress: '0',
  queued: '4',
  failed: '1',
  quarantined: '0',
  p0_in_progress: '0',
  recent_active: '0',
};

describe('generateCompareReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('返回正确的 JSON 对比报告', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [PROJECT_A, PROJECT_B] })  // projects query
      .mockResolvedValueOnce({ rows: [TASK_STATS_A, TASK_STATS_B] }); // tasks query

    const report = await generateCompareReport({
      project_ids: [PROJECT_A.id, PROJECT_B.id],
    });

    expect(report.format).toBe('json');
    expect(report.generated_at).toBeTruthy();
    expect(report.projects).toHaveLength(2);
    expect(report.summary).toBeTruthy();
    expect(report.markdown).toBeUndefined();

    const alpha = report.projects.find(p => p.id === PROJECT_A.id);
    expect(alpha).toBeTruthy();
    expect(alpha.task_stats.total).toBe(10);
    expect(alpha.task_stats.completion_rate).toBe(0.7);
    expect(alpha.score).toBeGreaterThan(0);
    expect(alpha.strengths).toBeInstanceOf(Array);
    expect(alpha.weaknesses).toBeInstanceOf(Array);
  });

  it('format=markdown 时返回 markdown 字段', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [PROJECT_A, PROJECT_B] })
      .mockResolvedValueOnce({ rows: [TASK_STATS_A, TASK_STATS_B] });

    const report = await generateCompareReport({
      project_ids: [PROJECT_A.id, PROJECT_B.id],
      format: 'markdown',
    });

    expect(report.format).toBe('markdown');
    expect(report.markdown).toBeTruthy();
    expect(report.markdown).toContain('# 项目对比报告');
    expect(report.markdown).toContain('Project Alpha');
    expect(report.markdown).toContain('## 总结');
  });

  it('project_ids 少于 2 个时抛出 400 错误', async () => {
    await expect(
      generateCompareReport({ project_ids: ['only-one-id'] })
    ).rejects.toMatchObject({
      message: expect.stringContaining('at least 2'),
      status: 400,
    });
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('project_ids 为空数组时抛出 400 错误', async () => {
    await expect(
      generateCompareReport({ project_ids: [] })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('project_ids 不是数组时抛出 400 错误', async () => {
    await expect(
      generateCompareReport({ project_ids: null })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('不存在的 project_id 时抛出 400 错误', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [PROJECT_A], // 只返回 A，B 不存在
    });

    await expect(
      generateCompareReport({
        project_ids: [PROJECT_A.id, 'nonexistent-uuid'],
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining('not found'),
      status: 400,
    });
  });

  it('无任务的项目评分为 40 分（无失败/隔离加 20 分，其余 0）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [PROJECT_A, PROJECT_B] })
      .mockResolvedValueOnce({ rows: [] }); // 无任务统计

    const report = await generateCompareReport({
      project_ids: [PROJECT_A.id, PROJECT_B.id],
    });

    for (const p of report.projects) {
      expect(p.score).toBe(20); // total=0 → completion 0分，no blocker 20分，p0 0分，activity 0分
    }
  });

  it('结果按评分降序排列', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [PROJECT_B, PROJECT_A] }) // B 先返回
      .mockResolvedValueOnce({ rows: [TASK_STATS_A, TASK_STATS_B] });

    const report = await generateCompareReport({
      project_ids: [PROJECT_A.id, PROJECT_B.id],
    });

    // Alpha 分数高，应排第一
    expect(report.projects[0].score).toBeGreaterThanOrEqual(report.projects[1].score);
  });

  it('summary 提到最高分项目', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [PROJECT_A, PROJECT_B] })
      .mockResolvedValueOnce({ rows: [TASK_STATS_A, TASK_STATS_B] });

    const report = await generateCompareReport({
      project_ids: [PROJECT_A.id, PROJECT_B.id],
    });

    expect(report.summary).toContain(report.projects[0].name);
  });
});

const PROJECT_A_KR = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  name: 'Project Alpha',
  type: 'initiative',
  status: 'active',
  kr_id: 'krrrrrr-0000-0000-0000-000000000010',
  kr_goal_id: 'krrrrrr-0000-0000-0000-000000000010',
  kr_title: 'KR: 提升任务完成率',
  kr_progress: '75',
};

const PROJECT_B_NOKR = {
  id: 'bbbbbbbb-0000-0000-0000-000000000002',
  name: 'Project Beta',
  type: 'project',
  status: 'active',
  kr_id: null,
  kr_goal_id: null,
  kr_title: null,
  kr_progress: null,
};

describe('getCompareMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正常路径：返回含 kr 和 trend 的项目数组', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [PROJECT_A_KR, PROJECT_B_NOKR] }) // 项目+KR
      .mockResolvedValueOnce({ rows: [TASK_STATS_A, TASK_STATS_B] })   // 任务统计
      .mockResolvedValueOnce({ rows: [                                  // 趋势
        { project_id: PROJECT_A_KR.id, week: '2026-W10', completed: '3' },
        { project_id: PROJECT_A_KR.id, week: '2026-W11', completed: '4' },
      ] });

    const result = await getCompareMetrics({
      project_ids: [PROJECT_A_KR.id, PROJECT_B_NOKR.id],
    });

    expect(result.projects).toHaveLength(2);
    const alpha = result.projects.find(p => p.id === PROJECT_A_KR.id);
    expect(alpha.kr).not.toBeNull();
    expect(alpha.kr.progress).toBe(75);
    expect(Number.isInteger(alpha.kr.progress)).toBe(true);
    expect(alpha.trend).toBeInstanceOf(Array);
    expect(alpha.trend[0]).toMatchObject({ week: '2026-W10', completed: 3 });
  });

  it('kr_id 为 null 时 kr 字段为 null', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [PROJECT_A_KR, PROJECT_B_NOKR] })
      .mockResolvedValueOnce({ rows: [TASK_STATS_A, TASK_STATS_B] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await getCompareMetrics({
      project_ids: [PROJECT_A_KR.id, PROJECT_B_NOKR.id],
    });

    const beta = result.projects.find(p => p.id === PROJECT_B_NOKR.id);
    expect(beta.kr).toBeNull();
    expect(beta.trend).toEqual([]);
  });

  it('project_ids 少于 2 个时抛出 status:400 错误', async () => {
    await expect(
      getCompareMetrics({ project_ids: ['only-one'] })
    ).rejects.toMatchObject({ status: 400 });
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});
