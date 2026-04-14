/**
 * packages/brain/src/execution.js
 * Harness execution module: pipeline lifecycle management.
 *
 * WS2: harness_cleanup handler — pipeline artifact cleanup (worktree + remote branch + /tmp).
 * WS1 (PR #2341): verdict retry + bridge crash detection (to be merged separately).
 */

import { execSync } from 'child_process';

// ── harness_cleanup Task Type ──────────────────────────────────────────────

export const HARNESS_CLEANUP_TASK_TYPE = 'harness_cleanup';

/**
 * executeHarnessCleanup — handler for harness_cleanup task type.
 *
 * Cleans up three artifact categories after pipeline completion:
 *   1. Worktree directory  — git worktree remove --force
 *   2. Remote branch       — git push origin --delete
 *   3. /tmp/cecelia-* temp files — rm -rf
 *
 * Each step runs independently; failures are collected but do not abort cleanup.
 *
 * @param {object} opts
 * @param {string} [opts.branch]       - Remote branch name to delete
 * @param {string} [opts.worktreePath] - Local worktree path to remove
 * @returns {Promise<{ cleaned: boolean, errors: string[] }>}
 */
export async function executeHarnessCleanup(opts = {}) {
  const { branch, worktreePath } = opts;
  const errors = [];

  // 1. Worktree cleanup: git worktree remove --force
  if (worktreePath) {
    try {
      execSync(`git worktree remove --force "${worktreePath}"`, { stdio: 'pipe' });
    } catch (err) {
      errors.push(`worktree remove failed: ${err.message}`);
    }
  }

  // 2. Remote branch deletion: git push origin --delete
  if (branch) {
    try {
      execSync(`git push origin --delete "${branch}"`, { stdio: 'pipe' });
    } catch (err) {
      errors.push(`remote branch delete failed: ${err.message}`);
    }
  }

  // 3. /tmp/cecelia-* temp files cleanup
  try {
    execSync('rm -rf /tmp/cecelia-* 2>/dev/null || true', { shell: true, stdio: 'pipe' });
  } catch (err) {
    errors.push(`/tmp/cecelia cleanup failed: ${err.message}`);
  }

  return { cleaned: true, errors };
}
