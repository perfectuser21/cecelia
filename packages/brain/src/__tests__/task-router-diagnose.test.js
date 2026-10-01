/**
 * Tests for task-router diagnoseKR function
 * and enhanced routeTaskCreate logging
 */

import { describe, it, expect, vi } from 'vitest';
import { diagnoseKR, routeTaskCreate, SKILL_WHITELIST } from '../task-router.js';

// ==================== routeTaskCreate enhanced logging ====================

describe('routeTaskCreate - enhanced logging', () => {
  it('returns skill field in routing result', () => {
    const result = routeTaskCreate({ title: 'fix bug', task_type: 'dev' });
    expect(result).toHaveProperty('skill');
    expect(result.skill).toBe('/dev');
  });

  it('includes all context fields in result', () => {
    const result = routeTaskCreate({
      title: 'implement feature',
      task_type: 'dev',
      kr_id: 'kr-001',
      initiative_id: 'init-001'
    });
    expect(result.location).toBe('us');
    expect(result.task_type).toBe('dev');
    expect(result.skill).toBe('/dev');
    expect(result.execution_mode).toBeDefined();
  });

  it('handles missing optional context fields gracefully', () => {
    const result = routeTaskCreate({ task_type: 'review' });
    expect(result.skill).toBe('/code-review');
    expect(result.location).toBe('us');
  });

  it('uses default task_type=dev when not provided', () => {
    const result = routeTaskCreate({ title: 'some task' });
    expect(result.task_type).toBe('dev');
    expect(result.skill).toBe('/dev');
  });
});

// ==================== diagnoseKR ====================

describe('diagnoseKR — Project 直接任务', () => {
  function makePool({ projects = [{ id: 'proj-1', name: '项目', status: 'active' }], counts = {}, tasks = [] } = {}) {
    return { query: vi.fn(async sql => {
      expect(sql).not.toMatch(/okr_(projects|scopes|initiatives)/);
      if (sql.includes('FROM key_results')) return { rows: [{ id: 'kr-1', title: '目标', status: 'in_progress' }] };
      if (sql.includes('FROM projects')) return { rows: projects };
      if (sql.includes('COUNT(*)')) return { rows: [counts] };
      return { rows: tasks };
    }) };
  }
  it('目标不存在时返回 null', async () => {
    expect(await diagnoseKR('missing', { query: vi.fn(async () => ({ rows: [] })) })).toBeNull();
  });
  it('有活跃 Task 时健康，任务带路由', async () => {
    const pool = makePool({ counts: { task_count: '2', active_task_count: '1', completed_task_count: '1' },
      tasks: [{ id: 'task-1', title: '修复', task_type: 'dev', status: 'queued' }] });
    const result = await diagnoseKR('kr-1', pool);
    expect(result.summary).toMatchObject({ diagnosis: 'healthy', total_projects: 1, projects_with_active_tasks: 1 });
    expect(result.projects[0].tasks[0].routing.skill).toBe('/dev');
    expect(result.projects[0].task_count).toBe(2);
  });
  it.each([
    [{ task_count: '0' }, 'no_tasks_created'],
    [{ task_count: '2', completed_task_count: '2' }, 'all_tasks_completed_project_still_active'],
    [{ task_count: '2', failed_task_count: '2' }, 'all_tasks_failed'],
    [{ task_count: '2', completed_task_count: '1' }, 'no_active_tasks'],
  ])('直接子任务统计识别阻塞 %s', async (counts, reason) => {
    const result = await diagnoseKR('kr-1', makePool({ counts }));
    expect(result.dispatch_blockers[0]).toMatchObject({ project_id: 'proj-1', reason });
    expect(result.summary.diagnosis).toBe('blocked');
  });
  it('非 active 项目不误报缺任务', async () => {
    const result = await diagnoseKR('kr-1', makePool({ projects: [{ id: 'proj-1', name: '项目', status: 'completed' }] }));
    expect(result.dispatch_blockers).toEqual([]);
  });
  it('无项目时返回零统计', async () => {
    const result = await diagnoseKR('kr-1', makePool({ projects: [] }));
    expect(result.projects).toEqual([]);
    expect(result.summary.total_projects).toBe(0);
  });
});
