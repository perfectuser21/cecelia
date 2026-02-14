import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn()
}));

// Import after mocking
const { cleanupWorktree } = await import('../executor.js');

describe('Executor Worktree Cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getWorktreePath', () => {
    it('should detect worktree path from git worktree list', async () => {
      execSync.mockReturnValueOnce(
        '/home/xx/perfect21/cecelia/core /path/to/worktree [cp-test-branch]\n' +
        '/home/xx/perfect21/cecelia/core-wt-uuid [cp-test-branch-2]'
      );

      // We can't directly test getWorktreePath since it's not exported,
      // but cleanupWorktree uses it internally
      const task = { branch: 'cp-test-branch' };

      // Mock hasUncommittedChanges to return false
      execSync.mockReturnValueOnce(''); // git status --porcelain

      // Mock successful cleanup commands
      execSync.mockReturnValueOnce(''); // git worktree remove
      execSync.mockReturnValueOnce(''); // git branch -D
      execSync.mockReturnValueOnce(''); // git push origin --delete

      await cleanupWorktree(task);

      // Verify git worktree list was called
      expect(execSync).toHaveBeenCalledWith('git worktree list', { encoding: 'utf-8' });
    });

    it('should return null if worktree not found', async () => {
      execSync.mockReturnValueOnce(
        '/home/xx/perfect21/cecelia/core [main]\n'
      );

      const task = { branch: 'cp-nonexistent' };
      await cleanupWorktree(task);

      // Should only call git worktree list, then return
      expect(execSync).toHaveBeenCalledTimes(1);
      expect(execSync).toHaveBeenCalledWith('git worktree list', { encoding: 'utf-8' });
    });
  });

  describe('hasUncommittedChanges', () => {
    it('should detect uncommitted changes', async () => {
      // Mock git worktree list
      execSync.mockReturnValueOnce(
        '/home/xx/perfect21/cecelia/core-wt-uuid [cp-test-branch]'
      );

      // Mock git status with changes
      execSync.mockReturnValueOnce(' M file.js\n?? new-file.js');

      const task = { branch: 'cp-test-branch' };
      await cleanupWorktree(task);

      // Should skip cleanup due to uncommitted changes
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('git -C'),
        expect.objectContaining({ encoding: 'utf-8' })
      );
      // Should NOT call git worktree remove
      expect(execSync).not.toHaveBeenCalledWith(
        expect.stringContaining('git worktree remove'),
        expect.anything()
      );
    });

    it('should return false when no uncommitted changes', async () => {
      // Mock git worktree list
      execSync.mockReturnValueOnce(
        '/home/xx/perfect21/cecelia/core-wt-uuid [cp-test-branch]'
      );

      // Mock git status with no changes
      execSync.mockReturnValueOnce('');

      // Mock successful cleanup
      execSync.mockReturnValueOnce(''); // git worktree remove
      execSync.mockReturnValueOnce(''); // git branch -D
      execSync.mockReturnValueOnce(''); // git push origin --delete

      const task = { branch: 'cp-test-branch' };
      await cleanupWorktree(task);

      // Should proceed with cleanup
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('git worktree remove'),
        expect.objectContaining({ encoding: 'utf-8' })
      );
    });
  });

  describe('cleanupWorktree', () => {
    it('should clean up worktree, local branch, and remote branch', async () => {
      // Mock git worktree list
      execSync.mockReturnValueOnce(
        '/home/xx/perfect21/cecelia/core-wt-uuid [cp-test-branch]'
      );

      // Mock git status (no changes)
      execSync.mockReturnValueOnce('');

      // Mock cleanup commands
      execSync.mockReturnValueOnce(''); // git worktree remove
      execSync.mockReturnValueOnce(''); // git branch -D
      execSync.mockReturnValueOnce(''); // git push origin --delete

      const task = { branch: 'cp-test-branch' };
      await cleanupWorktree(task);

      expect(execSync).toHaveBeenCalledWith(
        'git worktree remove "/home/xx/perfect21/cecelia/core-wt-uuid" --force',
        { encoding: 'utf-8' }
      );
      expect(execSync).toHaveBeenCalledWith(
        'git branch -D "cp-test-branch"',
        { encoding: 'utf-8' }
      );
      expect(execSync).toHaveBeenCalledWith(
        'git push origin --delete "cp-test-branch"',
        { encoding: 'utf-8', stdio: 'ignore' }
      );
    });

    it('should skip cleanup if not a cp-* branch', async () => {
      const task = { branch: 'main' };
      await cleanupWorktree(task);

      expect(execSync).not.toHaveBeenCalled();
    });

    it('should skip cleanup if branch name is missing', async () => {
      const task = {};
      await cleanupWorktree(task);

      expect(execSync).not.toHaveBeenCalled();
    });

    it('should skip cleanup if worktree has uncommitted changes', async () => {
      // Mock git worktree list
      execSync.mockReturnValueOnce(
        '/home/xx/perfect21/cecelia/core-wt-uuid [cp-test-branch]'
      );

      // Mock git status with changes
      execSync.mockReturnValueOnce(' M file.js');

      const task = { branch: 'cp-test-branch' };
      await cleanupWorktree(task);

      // Should NOT proceed to worktree removal
      expect(execSync).not.toHaveBeenCalledWith(
        expect.stringContaining('git worktree remove'),
        expect.anything()
      );
    });

    it('should handle worktree removal failure gracefully', async () => {
      // Mock git worktree list
      execSync.mockReturnValueOnce(
        '/home/xx/perfect21/cecelia/core-wt-uuid [cp-test-branch]'
      );

      // Mock git status (no changes)
      execSync.mockReturnValueOnce('');

      // Mock worktree remove failure
      execSync.mockImplementationOnce(() => {
        throw new Error('worktree removal failed');
      });

      const task = { branch: 'cp-test-branch' };
      await expect(cleanupWorktree(task)).resolves.not.toThrow();

      // Should NOT proceed to branch deletion after worktree failure
      expect(execSync).toHaveBeenCalledTimes(3); // worktree list, status, remove (failed)
    });

    it('should continue if local branch deletion fails', async () => {
      // Mock git worktree list
      execSync.mockReturnValueOnce(
        '/home/xx/perfect21/cecelia/core-wt-uuid [cp-test-branch]'
      );

      // Mock git status (no changes)
      execSync.mockReturnValueOnce('');

      // Mock successful worktree remove
      execSync.mockReturnValueOnce('');

      // Mock branch delete failure
      execSync.mockImplementationOnce(() => {
        throw new Error('branch deletion failed');
      });

      // Mock successful remote delete (should still be attempted)
      execSync.mockReturnValueOnce('');

      const task = { branch: 'cp-test-branch' };
      await expect(cleanupWorktree(task)).resolves.not.toThrow();

      // Should attempt remote deletion even after local branch failure
      expect(execSync).toHaveBeenCalledWith(
        'git push origin --delete "cp-test-branch"',
        { encoding: 'utf-8', stdio: 'ignore' }
      );
    });

    it('should ignore remote branch deletion failure', async () => {
      // Mock git worktree list
      execSync.mockReturnValueOnce(
        '/home/xx/perfect21/cecelia/core-wt-uuid [cp-test-branch]'
      );

      // Mock git status (no changes)
      execSync.mockReturnValueOnce('');

      // Mock successful worktree remove and local branch delete
      execSync.mockReturnValueOnce('');
      execSync.mockReturnValueOnce('');

      // Mock remote delete failure (e.g., already deleted by GitHub)
      execSync.mockImplementationOnce(() => {
        throw new Error('remote branch not found');
      });

      const task = { branch: 'cp-test-branch' };
      await expect(cleanupWorktree(task)).resolves.not.toThrow();
    });

    it('should handle branch from payload.branch', async () => {
      // Mock git worktree list
      execSync.mockReturnValueOnce(
        '/home/xx/perfect21/cecelia/core-wt-uuid [cp-payload-branch]'
      );

      // Mock git status (no changes)
      execSync.mockReturnValueOnce('');

      // Mock successful cleanup
      execSync.mockReturnValueOnce('');
      execSync.mockReturnValueOnce('');
      execSync.mockReturnValueOnce('');

      const task = { payload: { branch: 'cp-payload-branch' } };
      await cleanupWorktree(task);

      expect(execSync).toHaveBeenCalledWith(
        'git branch -D "cp-payload-branch"',
        { encoding: 'utf-8' }
      );
    });

    it('should only clean cp-* branches (security)', async () => {
      const testCases = [
        { branch: 'main' },
        { branch: 'develop' },
        { branch: 'feature/test' },
        { branch: 'fix/bug' },
        { branch: 'test-branch' }
      ];

      for (const task of testCases) {
        vi.clearAllMocks();
        await cleanupWorktree(task);
        expect(execSync).not.toHaveBeenCalled();
      }
    });

    it('should handle cp-* prefix validation', async () => {
      const validBranches = [
        'cp-test',
        'cp-02140730-cleanup',
        'cp-12345678-feature'
      ];

      for (const branch of validBranches) {
        vi.clearAllMocks();

        // Mock successful execution
        execSync.mockReturnValueOnce(`/path/to/wt [${branch}]`);
        execSync.mockReturnValueOnce(''); // no changes
        execSync.mockReturnValueOnce(''); // worktree remove
        execSync.mockReturnValueOnce(''); // branch delete
        execSync.mockReturnValueOnce(''); // remote delete

        await cleanupWorktree({ branch });

        expect(execSync).toHaveBeenCalled();
      }
    });
  });

  describe('error handling', () => {
    it('should not throw on git command errors', async () => {
      execSync.mockImplementation(() => {
        throw new Error('git error');
      });

      const task = { branch: 'cp-test-branch' };
      await expect(cleanupWorktree(task)).resolves.not.toThrow();
    });

    it('should handle null/undefined task gracefully', async () => {
      await expect(cleanupWorktree(null)).resolves.not.toThrow();
      await expect(cleanupWorktree(undefined)).resolves.not.toThrow();
    });
  });
});
