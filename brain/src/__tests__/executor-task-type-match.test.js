/**
 * Tests for executor.js checkTaskTypeMatch function
 * DoD: suggest_task_type action — task_type 合理性检查
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock heavy dependencies before importing executor
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
  pool: { query: vi.fn() },
}));
vi.mock('node-fetch', () => ({ default: vi.fn() }));
vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(() => ({ pid: 1234, on: vi.fn(), stdout: { on: vi.fn() }, stderr: { on: vi.fn() } })),
}));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
    writeFileSync: vi.fn(),
  };
});

const { checkTaskTypeMatch } = await import('../executor.js');

describe('checkTaskTypeMatch', () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('warns when dev task has research keywords (调研)', () => {
    const task = { id: 'task-001', task_type: 'dev', title: '调研竞品方案' };
    checkTaskTypeMatch(task);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('suggest-task-type');
    expect(warnSpy.mock.calls[0][0]).toContain('task_type=dev');
    expect(warnSpy.mock.calls[0][0]).toContain('调研');
  });

  it('warns when dev task has research keywords (research)', () => {
    const task = { id: 'task-002', task_type: 'dev', title: 'Research API design patterns' };
    checkTaskTypeMatch(task);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('research');
  });

  it('warns when dev task has research keywords (探索)', () => {
    const task = { id: 'task-003', task_type: 'dev', title: '探索 LLM 路由方案' };
    checkTaskTypeMatch(task);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('探索');
  });

  it('warns when exploratory task has implementation keywords (实现)', () => {
    const task = { id: 'task-004', task_type: 'exploratory', title: '实现任务优先级算法' };
    checkTaskTypeMatch(task);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('suggest-task-type');
    expect(warnSpy.mock.calls[0][0]).toContain('task_type=exploratory');
    expect(warnSpy.mock.calls[0][0]).toContain('实现');
  });

  it('warns when exploratory task has implementation keywords (feat)', () => {
    const task = { id: 'task-005', task_type: 'exploratory', title: 'feat: add new dispatch logic' };
    checkTaskTypeMatch(task);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('feat');
  });

  it('warns when exploratory task has implementation keywords (fix)', () => {
    const task = { id: 'task-006', task_type: 'exploratory', title: 'fix executor crash bug' };
    checkTaskTypeMatch(task);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('does not warn for normal dev task without research keywords', () => {
    const task = { id: 'task-007', task_type: 'dev', title: '新增任务优先级算法' };
    checkTaskTypeMatch(task);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn for normal exploratory task without implementation keywords', () => {
    const task = { id: 'task-008', task_type: 'exploratory', title: '探索 LLM 路由方案' };
    checkTaskTypeMatch(task);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not block execution (returns undefined, does not throw)', () => {
    const task = { id: 'task-009', task_type: 'dev', title: '调研并实现新功能' };
    // should not throw, and returns undefined
    const result = checkTaskTypeMatch(task);
    expect(result).toBeUndefined();
  });

  it('handles task without id gracefully', () => {
    const task = { task_type: 'dev', title: '调研方案' };
    expect(() => checkTaskTypeMatch(task)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('unknown');
  });

  it('handles task with empty title gracefully', () => {
    const task = { id: 'task-010', task_type: 'dev', title: '' };
    expect(() => checkTaskTypeMatch(task)).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('handles task without title gracefully', () => {
    const task = { id: 'task-011', task_type: 'dev' };
    expect(() => checkTaskTypeMatch(task)).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('ignores other task_types (review, qa, research)', () => {
    ['review', 'qa', 'research', 'audit', 'talk'].forEach(type => {
      const task = { id: `task-${type}`, task_type: type, title: '调研并实现功能 fix feat' };
      expect(() => checkTaskTypeMatch(task)).not.toThrow();
    });
    // No warns for non-dev/non-exploratory types
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
