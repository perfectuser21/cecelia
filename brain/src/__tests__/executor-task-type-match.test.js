/**
 * Tests for executor.js checkTaskTypeMatch function
 * DoD: suggest_task_type action — task_type 合理性检查（仅 warning，不阻塞）
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

  it('does not block execution (returns undefined, does not throw)', () => {
    const task = { id: 'task-009', task_type: 'dev', title: '调研并实现新功能' };
    const result = checkTaskTypeMatch(task);
    expect(result).toBeUndefined();
  });

  it('handles task without id gracefully', () => {
    const task = { task_type: 'dev', title: '调研方案' };
    expect(() => checkTaskTypeMatch(task)).not.toThrow();
  });

  it('handles task with empty title gracefully', () => {
    const task = { id: 'task-010', task_type: 'dev', title: '' };
    expect(() => checkTaskTypeMatch(task)).not.toThrow();
  });

  it('handles task without title gracefully', () => {
    const task = { id: 'task-011', task_type: 'dev' };
    expect(() => checkTaskTypeMatch(task)).not.toThrow();
  });

  it('ignores other task_types (review, qa, research)', () => {
    ['review', 'qa', 'research', 'audit', 'talk'].forEach(type => {
      const task = { id: `task-${type}`, task_type: type, title: '调研并实现功能 fix feat' };
      expect(() => checkTaskTypeMatch(task)).not.toThrow();
    });
  });
});
