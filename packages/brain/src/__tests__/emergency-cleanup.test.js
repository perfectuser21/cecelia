import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs and child_process before importing
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { emergencyCleanup, findWorktreeForTask } from '../emergency-cleanup.js';
import { existsSync, readFileSync, rmSync, readdirSync } from 'fs';
import { execSync } from 'child_process';

describe('emergencyCleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cleans worktree, lock slot, and dev-mode', () => {
    const infoJson = JSON.stringify({ task_id: 'task-1', pid: 12345, worktree_path: '/home/xx/perfect21/cecelia/.claude/worktrees/test-wt' });
    existsSync.mockImplementation((path) => {
      if (path.includes('info.json')) return true;
      if (path.includes('test-wt')) return true;
      if (path.includes('.dev-mode')) return true;
      if (path.includes('slot-0')) return true;
      return false;
    });
    readFileSync.mockReturnValue(infoJson);
    execSync.mockReturnValue('');
    rmSync.mockReturnValue(undefined);

    const result = emergencyCleanup('task-1', 'slot-0');

    expect(result.worktree).toBe(true);
    expect(result.lock).toBe(true);
    expect(result.devMode).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('handles missing slot gracefully', () => {
    existsSync.mockReturnValue(false);

    const result = emergencyCleanup('task-2', 'slot-99');

    expect(result.worktree).toBe(false);
    expect(result.lock).toBe(false);
    expect(result.errors).toHaveLength(0);
  });

  it('does not spawn long-running processes', () => {
    existsSync.mockReturnValue(false);

    emergencyCleanup('task-3', 'slot-1');

    // execSync is synchronous by definition - verify no spawn/exec calls
    for (const call of execSync.mock.calls) {
      // All calls should have timeout
      expect(call[1]?.timeout).toBeLessThanOrEqual(15000);
    }
  });

  it('falls back to rmSync when git worktree remove fails', () => {
    const infoJson = JSON.stringify({ task_id: 'task-4', pid: 111, worktree_path: '/tmp/test-wt' });
    existsSync.mockImplementation((path) => {
      if (path.includes('info.json')) return true;
      if (path.includes('test-wt')) return true;
      if (path.includes('slot-2')) return true;
      return false;
    });
    readFileSync.mockReturnValue(infoJson);
    execSync.mockImplementation((cmd) => {
      if (cmd.includes('worktree remove')) throw new Error('git error');
      return '';
    });
    rmSync.mockReturnValue(undefined);

    const result = emergencyCleanup('task-4', 'slot-2');

    expect(result.worktree).toBe(true); // fallback succeeded
    expect(result.lock).toBe(true);
  });
});

describe('findWorktreeForTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds worktree by taskId in .dev-mode', () => {
    existsSync.mockImplementation((path) => {
      if (path.includes('worktrees')) return true;
      if (path.includes('.dev-mode')) return true;
      return false;
    });
    readdirSync.mockReturnValue([
      { name: 'my-task', isDirectory: () => true },
    ]);
    readFileSync.mockReturnValue('dev\ntask_id: task-123\n');

    const result = findWorktreeForTask('task-123');
    expect(result).toContain('my-task');
  });

  it('returns null when no worktree found', () => {
    existsSync.mockReturnValue(false);
    const result = findWorktreeForTask('nonexistent');
    expect(result).toBeNull();
  });
});
