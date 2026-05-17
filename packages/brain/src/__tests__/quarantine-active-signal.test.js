/**
 * quarantine-active-signal 单元测试。
 * 5 cases：fresh match / stale match / no match / invalid input / 多文件混合。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReaddirSync = vi.fn();
const mockStatSync = vi.fn();
vi.mock('fs', () => ({
  readdirSync: (...args) => mockReaddirSync(...args),
  statSync: (...args) => mockStatSync(...args),
}));

const TASK_ID = '76530023-19bd-4879-a5f0-77161fe1162e';
const TASK_PREFIX = '76530023';
const WORKTREE_ROOT = '/Users/administrator/worktrees/cecelia';
const MAIN_REPO = '/Users/administrator/perfect21/cecelia';

function setupFs(layout) {
  // layout: { [dirPath]: [filenames], files: { [fullPath]: { mtimeMs } } }
  mockReaddirSync.mockImplementation((dir) => layout.dirs?.[dir] ?? []);
  mockStatSync.mockImplementation((fullPath) => {
    const f = layout.files?.[fullPath];
    if (!f) throw new Error(`ENOENT: ${fullPath}`);
    return { mtimeMs: f.mtimeMs };
  });
}

describe('hasActiveSignal', () => {
  beforeEach(() => {
    mockReaddirSync.mockReset();
    mockStatSync.mockReset();
  });

  it('case 1: fresh match → active', async () => {
    const now = Date.now();
    const filename = `.dev-mode.cp-0423201624-${TASK_PREFIX}-phase-a`;
    setupFs({
      dirs: {
        [MAIN_REPO]: [],
        [WORKTREE_ROOT]: ['wt1'],
        [`${WORKTREE_ROOT}/wt1`]: [filename],
      },
      files: {
        [`${WORKTREE_ROOT}/wt1/${filename}`]: { mtimeMs: now - 30_000 },
      },
    });
    const { hasActiveSignal } = await import('../quarantine-active-signal.js');
    const res = await hasActiveSignal(TASK_ID);
    expect(res.active).toBe(true);
    expect(res.reason).toBe('dev_mode_mtime_fresh');
    expect(res.source).toContain(filename);
    expect(res.ageMs).toBeGreaterThanOrEqual(29_000);
    expect(res.ageMs).toBeLessThan(31_000);
  });

  it('case 2: stale match (mtime > 90s) → inactive', async () => {
    const now = Date.now();
    const filename = `.dev-mode.cp-0423201624-${TASK_PREFIX}-phase-a`;
    setupFs({
      dirs: {
        [MAIN_REPO]: [],
        [WORKTREE_ROOT]: ['wt1'],
        [`${WORKTREE_ROOT}/wt1`]: [filename],
      },
      files: {
        [`${WORKTREE_ROOT}/wt1/${filename}`]: { mtimeMs: now - 120_000 },
      },
    });
    const { hasActiveSignal } = await import('../quarantine-active-signal.js');
    const res = await hasActiveSignal(TASK_ID);
    expect(res.active).toBe(false);
    expect(res.reason).toBe('no_fresh_dev_mode');
    expect(res.source).toBeNull();
  });

  it('case 3: no match → inactive', async () => {
    const now = Date.now();
    setupFs({
      dirs: {
        [MAIN_REPO]: [],
        [WORKTREE_ROOT]: ['wt1'],
        [`${WORKTREE_ROOT}/wt1`]: ['.dev-mode.cp-0423221250-c36991e7-phase-b2'],
      },
      files: {
        [`${WORKTREE_ROOT}/wt1/.dev-mode.cp-0423221250-c36991e7-phase-b2`]: { mtimeMs: now - 10_000 },
      },
    });
    const { hasActiveSignal } = await import('../quarantine-active-signal.js');
    const res = await hasActiveSignal(TASK_ID);
    expect(res.active).toBe(false);
    expect(res.reason).toBe('no_fresh_dev_mode');
  });

  it('case 4: invalid taskId → inactive', async () => {
    const { hasActiveSignal } = await import('../quarantine-active-signal.js');
    const res1 = await hasActiveSignal(null);
    expect(res1.active).toBe(false);
    expect(res1.reason).toBe('invalid_task_id');
    const res2 = await hasActiveSignal('');
    expect(res2.active).toBe(false);
    expect(res2.reason).toBe('invalid_task_id');
  });

  it('case 5: 多文件混合（常态）→ 只命中 fresh + match', async () => {
    const now = Date.now();
    const matchFilename = `.dev-mode.cp-0423201624-${TASK_PREFIX}-phase-a`;
    setupFs({
      dirs: {
        [MAIN_REPO]: [],
        [WORKTREE_ROOT]: ['wtA', 'wtB', 'wtC'],
        [`${WORKTREE_ROOT}/wtA`]: ['.dev-mode.cp-0420-stalebranch'],                // stale mismatch
        [`${WORKTREE_ROOT}/wtB`]: ['.dev-mode.cp-0423221250-c36991e7-phase-b2'],     // fresh mismatch
        [`${WORKTREE_ROOT}/wtC`]: [matchFilename],                                    // fresh match
      },
      files: {
        [`${WORKTREE_ROOT}/wtA/.dev-mode.cp-0420-stalebranch`]: { mtimeMs: now - 3600_000 },
        [`${WORKTREE_ROOT}/wtB/.dev-mode.cp-0423221250-c36991e7-phase-b2`]: { mtimeMs: now - 5_000 },
        [`${WORKTREE_ROOT}/wtC/${matchFilename}`]: { mtimeMs: now - 10_000 },
      },
    });
    const { hasActiveSignal } = await import('../quarantine-active-signal.js');
    const res = await hasActiveSignal(TASK_ID);
    expect(res.active).toBe(true);
    expect(res.source).toContain(matchFilename);
    expect(res.source).not.toContain('stalebranch');
    expect(res.source).not.toContain('c36991e7');
  });
});
