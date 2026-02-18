/**
 * planner-content-aware.test.js
 *
 * 测试 planner.js 中的 applyContentAwareScore() 函数。
 * 验证内容感知评分逻辑：task_type 和 payload 内容影响任务优先级排序。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock db.js 和 focus.js，避免真实 DB 连接
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
  }
}));

vi.mock('../focus.js', () => ({
  getDailyFocus: vi.fn().mockResolvedValue(null)
}));

import { applyContentAwareScore } from '../planner.js';

describe('applyContentAwareScore', () => {
  it('applyContentAwareScore is a function', () => {
    expect(typeof applyContentAwareScore).toBe('function');
  });

  it('exploratory task gets +10 bonus', () => {
    const tasks = [
      { id: 'task-1', task_type: 'exploratory', payload: {} }
    ];
    const result = applyContentAwareScore(tasks);
    expect(result[0]._content_score_bonus).toBe(10);
  });

  it('dev task with wait_for_exploratory gets -20 penalty', () => {
    const tasks = [
      { id: 'task-2', task_type: 'dev', payload: { wait_for_exploratory: true } }
    ];
    const result = applyContentAwareScore(tasks);
    expect(result[0]._content_score_bonus).toBe(-20);
  });

  it('dev task with decomposition_mode=known gets +5 bonus', () => {
    const tasks = [
      { id: 'task-3', task_type: 'dev', payload: { decomposition_mode: 'known' } }
    ];
    const result = applyContentAwareScore(tasks);
    expect(result[0]._content_score_bonus).toBe(5);
  });

  it('task without payload gets 0 bonus', () => {
    const tasks = [
      { id: 'task-4', task_type: 'dev', payload: null }
    ];
    const result = applyContentAwareScore(tasks);
    expect(result[0]._content_score_bonus).toBe(0);
  });

  it('task without task_type or payload gets 0 bonus', () => {
    const tasks = [
      { id: 'task-5' }
    ];
    const result = applyContentAwareScore(tasks);
    expect(result[0]._content_score_bonus).toBe(0);
  });

  it('exploratory task排序高于同级dev task', () => {
    const tasks = [
      { id: 'dev-task', task_type: 'dev', payload: {}, phase: 'dev', status: 'queued', priority: 'P1' },
      { id: 'exp-task', task_type: 'exploratory', payload: {}, phase: 'exploratory', status: 'queued', priority: 'P1' }
    ];
    const result = applyContentAwareScore(tasks);
    // exploratory 得 +10，dev 得 0
    const expTask = result.find(t => t.id === 'exp-task');
    const devTask = result.find(t => t.id === 'dev-task');
    expect(expTask._content_score_bonus).toBeGreaterThan(devTask._content_score_bonus);
  });

  it('wait_for_exploratory dev task排序最后（bonus最低）', () => {
    const tasks = [
      { id: 'normal-dev', task_type: 'dev', payload: {}, phase: 'dev' },
      { id: 'known-dev', task_type: 'dev', payload: { decomposition_mode: 'known' }, phase: 'dev' },
      { id: 'wait-dev', task_type: 'dev', payload: { wait_for_exploratory: true }, phase: 'dev' }
    ];
    const result = applyContentAwareScore(tasks);
    const waitBonus = result.find(t => t.id === 'wait-dev')._content_score_bonus;
    const normalBonus = result.find(t => t.id === 'normal-dev')._content_score_bonus;
    const knownBonus = result.find(t => t.id === 'known-dev')._content_score_bonus;
    expect(waitBonus).toBeLessThan(normalBonus);
    expect(waitBonus).toBeLessThan(knownBonus);
  });

  it('logs content-aware scores at debug level', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const tasks = [
      { id: 'task-log', task_type: 'exploratory', payload: {} }
    ];
    applyContentAwareScore(tasks);
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('content-aware scores')
    );
    debugSpy.mockRestore();
  });

  it('returns array with same length as input', () => {
    const tasks = [
      { id: 'a', task_type: 'dev', payload: {} },
      { id: 'b', task_type: 'exploratory', payload: {} },
      { id: 'c', task_type: 'dev', payload: { wait_for_exploratory: true } }
    ];
    const result = applyContentAwareScore(tasks);
    expect(result).toHaveLength(3);
  });

  it('does not mutate original task objects', () => {
    const task = { id: 'immutable', task_type: 'exploratory', payload: {} };
    const tasks = [task];
    applyContentAwareScore(tasks);
    // 原始对象不应该有 _content_score_bonus
    expect(task._content_score_bonus).toBeUndefined();
  });
});
