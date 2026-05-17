/**
 * entity-linker.test.js — OKR/Task 实体链接测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

import { findRelatedGoal, findRelatedProject, linkEntities, _extractKeywords } from '../entity-linker.js';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('extractKeywords', () => {
  it('提取中文关键词', () => {
    const kws = _extractKeywords('给 Cecelia 加记忆功能');
    expect(kws.length).toBeGreaterThan(0);
    expect(kws.some(k => k.includes('Cecelia') || k.includes('记忆'))).toBe(true);
  });

  it('提取英文关键词', () => {
    const kws = _extractKeywords('fix the CI coverage issue');
    expect(kws).toContain('fix');
    expect(kws).toContain('CI');
    expect(kws).toContain('coverage');
  });

  it('空文本返回空数组', () => {
    expect(_extractKeywords('')).toEqual([]);
  });
});

describe('findRelatedGoal', () => {
  it('关键词匹配找到正确 goal', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'g1', title: 'CI 覆盖率 100%' }],
    });

    const result = await findRelatedGoal('CI coverage');
    expect(result).toEqual({ id: 'g1', title: 'CI 覆盖率 100%' });
  });

  it('无匹配时返回 null', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await findRelatedGoal('完全不相关的内容 xyz');
    expect(result).toBeNull();
  });

  it('空输入返回 null', async () => {
    const result = await findRelatedGoal('');
    expect(result).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('DB 异常返回 null', async () => {
    mockQuery.mockRejectedValue(new Error('connection error'));

    const result = await findRelatedGoal('CI coverage');
    expect(result).toBeNull();
  });
});

describe('findRelatedProject', () => {
  it('关键词匹配找到正确 project', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'p1', name: 'Cecelia Brain' }],
    });

    const result = await findRelatedProject('Cecelia');
    expect(result).toEqual({ id: 'p1', name: 'Cecelia Brain' });
  });

  it('无匹配返回 null', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await findRelatedProject('不存在的项目');
    expect(result).toBeNull();
  });
});

describe('linkEntities', () => {
  it('综合链接 goal + project', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'g1', title: 'Task Intelligence' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'Cecelia Brain' }] });

    const result = await linkEntities(
      { summary: 'Cecelia Task Intelligence', entities: {} },
      ''
    );
    expect(result.goal_id).toBe('g1');
    expect(result.project_id).toBe('p1');
  });

  it('无 llmIntent 时使用 fallbackText', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await linkEntities(null, 'CI 任务');
    expect(result).toEqual({ goal_id: null, project_id: null });
    // 至少尝试查询了
    expect(mockQuery).toHaveBeenCalled();
  });

  it('两者都空时返回 null', async () => {
    const result = await linkEntities(null, '');
    expect(result).toEqual({ goal_id: null, project_id: null });
  });
});
