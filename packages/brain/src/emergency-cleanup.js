/**
 * Emergency Cleanup — Brain 应激机制 Phase 2
 *
 * Watchdog kill 进程后（Phase 1），立即调用此模块清理残留：
 *   - git worktree remove（防止磁盘占用累积）
 *   - lock slot 清理（释放 /tmp/cecelia-locks/slot-N）
 *   - .dev-mode 文件清理
 *
 * 设计原则：
 *   - 全部 execSync，零额外内存开销
 *   - 每步独立 try/catch，一步失败不影响其他步骤
 *   - 纯同步，不 spawn 长期子进程
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';

const LOCK_DIR = process.env.LOCK_DIR || '/tmp/cecelia-locks';
const WORKTREE_BASE = process.env.WORKTREE_BASE || '/home/xx/perfect21/cecelia/.claude/worktrees';
const REPO_ROOT = process.env.REPO_ROOT || '/home/xx/perfect21/cecelia';

/**
 * Phase 2 emergency cleanup after watchdog kills a task process.
 *
 * @param {string} taskId - The killed task ID
 * @param {string} slot - Lock slot name (e.g. 'slot-0')
 * @returns {{ worktree: boolean, lock: boolean, devMode: boolean, errors: string[] }}
 */
function emergencyCleanup(taskId, slot) {
  const result = { worktree: false, lock: false, devMode: false, errors: [] };

  // 1. Find and remove git worktree associated with this slot
  try {
    const slotDir = join(LOCK_DIR, slot);
    const infoPath = join(slotDir, 'info.json');
    let worktreePath = null;

    if (existsSync(infoPath)) {
      try {
        const info = JSON.parse(readFileSync(infoPath, 'utf-8'));
        worktreePath = info.worktree_path || null;
      } catch { /* corrupt json */ }
    }

    // If no worktree_path in info.json, try to find by scanning worktrees
    if (!worktreePath) {
      worktreePath = findWorktreeForTask(taskId);
    }

    if (worktreePath && existsSync(worktreePath)) {
      // Clean .dev-mode before removing worktree
      const devModePath = join(worktreePath, '.dev-mode');
      if (existsSync(devModePath)) {
        try {
          rmSync(devModePath);
          result.devMode = true;
        } catch (e) {
          result.errors.push(`devMode: ${e.message}`);
        }
      }

      // git worktree remove --force
      try {
        execSync(`git worktree remove --force "${worktreePath}"`, {
          cwd: REPO_ROOT,
          timeout: 15000,
          stdio: 'pipe',
        });
        result.worktree = true;
      } catch (e) {
        // Fallback: manual removal if git command fails
        try {
          rmSync(worktreePath, { recursive: true, force: true });
          // Also prune stale worktree refs
          execSync('git worktree prune', { cwd: REPO_ROOT, timeout: 5000, stdio: 'pipe' });
          result.worktree = true;
        } catch (e2) {
          result.errors.push(`worktree: ${e2.message}`);
        }
      }
    }
  } catch (e) {
    result.errors.push(`worktree-scan: ${e.message}`);
  }

  // 2. Clean lock slot directory
  try {
    const slotDir = join(LOCK_DIR, slot);
    if (existsSync(slotDir)) {
      rmSync(slotDir, { recursive: true, force: true });
      result.lock = true;
    }
  } catch (e) {
    result.errors.push(`lock: ${e.message}`);
  }

  if (result.errors.length > 0) {
    console.warn(`[emergency-cleanup] task=${taskId} slot=${slot} errors:`, result.errors);
  } else {
    console.log(`[emergency-cleanup] task=${taskId} slot=${slot} cleaned (wt=${result.worktree} lock=${result.lock} dev=${result.devMode})`);
  }

  return result;
}

/**
 * Find worktree directory for a given taskId by scanning worktree directories.
 * Looks for .dev-mode files or info.json references.
 */
function findWorktreeForTask(taskId) {
  try {
    if (!existsSync(WORKTREE_BASE)) return null;
    const entries = readdirSync(WORKTREE_BASE, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const wtPath = join(WORKTREE_BASE, entry.name);
      const devMode = join(wtPath, '.dev-mode');
      if (existsSync(devMode)) {
        try {
          const content = readFileSync(devMode, 'utf-8');
          if (content.includes(taskId)) return wtPath;
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return null;
}

export { emergencyCleanup, findWorktreeForTask };
