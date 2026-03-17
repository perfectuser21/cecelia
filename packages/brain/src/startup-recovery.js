/**
 * Startup Recovery - Brain 重启后的环境清理
 *
 * 职责：仅做三项环境清理，DB 孤儿任务恢复由 executor.js::syncOrphanTasksOnStartup 负责。
 *   - cleanupStaleWorktrees: 清理孤立 worktree 目录和元数据
 *   - cleanupStaleLockSlots: 释放无主 lock slot
 *   - cleanupStaleDevModeFiles: 删除死分支的 .dev-mode* 文件
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync, rmSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = process.env.REPO_ROOT || '/Users/administrator/perfect21/cecelia';
const WORKTREE_BASE = process.env.WORKTREE_BASE || '/Users/administrator/perfect21/cecelia/.claude/worktrees';
const LOCK_DIR = process.env.LOCK_DIR || '/tmp/cecelia-locks';

/**
 * 清理孤立的 git worktree 目录
 * 1. git worktree prune（清理无效元数据引用）
 * 2. 扫描 WORKTREE_BASE，删除不在 git worktree list 中的目录
 *
 * @param {{ repoRoot?: string, worktreeBase?: string }} [opts]
 * @returns {Promise<{ pruned: number, removed: number, errors: string[] }>}
 */
export async function cleanupStaleWorktrees({ repoRoot = REPO_ROOT, worktreeBase = WORKTREE_BASE } = {}) {
  const stats = { pruned: 0, removed: 0, errors: [] };

  // 1. git worktree prune
  try {
    execSync('git worktree prune', { cwd: repoRoot, timeout: 10000, stdio: 'pipe' });
    stats.pruned = 1;
    console.log('[StartupRecovery:cleanupStaleWorktrees] git worktree prune ok');
  } catch (e) {
    stats.errors.push(`prune: ${e.message}`);
    console.warn('[StartupRecovery:cleanupStaleWorktrees] prune failed:', e.message);
  }

  // 2. Get active worktree paths from git
  const activePaths = new Set();
  try {
    const output = execSync('git worktree list --porcelain', {
      cwd: repoRoot, timeout: 5000, encoding: 'utf-8', stdio: 'pipe',
    });
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        activePaths.add(line.slice(9).trim());
      }
    }
  } catch (e) {
    stats.errors.push(`worktree-list: ${e.message}`);
  }

  // 3. Scan WORKTREE_BASE and remove stale dirs
  if (existsSync(worktreeBase)) {
    let entries = [];
    try {
      entries = readdirSync(worktreeBase, { withFileTypes: true });
    } catch (e) {
      stats.errors.push(`scan: ${e.message}`);
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = join(worktreeBase, entry.name);
      if (!activePaths.has(fullPath)) {
        try {
          rmSync(fullPath, { recursive: true, force: true });
          stats.removed++;
          console.log('[StartupRecovery:cleanupStaleWorktrees] removed stale worktree dir:', fullPath,
            JSON.stringify({ cleanup_type: 'worktree_dir', path: fullPath, result: 'removed' }));
        } catch (e) {
          stats.errors.push(`rm:${fullPath}: ${e.message}`);
        }
      }
    }
  }

  console.log(`[StartupRecovery:cleanupStaleWorktrees] done worktrees_pruned=${stats.pruned} stale_removed=${stats.removed}`);
  return stats;
}

/**
 * 释放无主的 lock slot 目录
 * 扫描 /tmp/cecelia-locks/slot-*，检查 pid 是否存活，删除孤立 slot
 *
 * @param {{ lockDir?: string }} [opts]
 * @returns {Promise<{ slots_freed: number, errors: string[] }>}
 */
export async function cleanupStaleLockSlots({ lockDir = LOCK_DIR } = {}) {
  const stats = { slots_freed: 0, errors: [] };

  if (!existsSync(lockDir)) return stats;

  let entries = [];
  try {
    entries = readdirSync(lockDir, { withFileTypes: true });
  } catch (e) {
    stats.errors.push(e.message);
    return stats;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('slot-')) continue;

    const slotDir = join(lockDir, entry.name);
    const infoPath = join(slotDir, 'info.json');
    let isOrphan = true; // default: no info.json = orphan

    if (existsSync(infoPath)) {
      try {
        const info = JSON.parse(readFileSync(infoPath, 'utf-8'));
        const pid = info.pid || info.child_pid;
        if (pid) {
          try {
            process.kill(pid, 0); // throws ESRCH if dead, EPERM if alive but no permission
            isOrphan = false;     // process alive
          } catch (killErr) {
            // ESRCH = no such process → orphan; EPERM = exists → not orphan
            isOrphan = killErr.code !== 'EPERM';
          }
        }
      } catch {
        // corrupt info.json → treat as orphan
      }
    }

    if (isOrphan) {
      try {
        rmSync(slotDir, { recursive: true, force: true });
        stats.slots_freed++;
        console.log('[StartupRecovery:cleanupStaleLockSlots] freed orphan slot:', entry.name,
          JSON.stringify({ cleanup_type: 'lock_slot', path: slotDir, result: 'freed' }));
      } catch (e) {
        stats.errors.push(`rm:${slotDir}: ${e.message}`);
      }
    }
  }

  console.log(`[StartupRecovery:cleanupStaleLockSlots] done slots_freed=${stats.slots_freed}`);
  return stats;
}

/**
 * 清理 repo 根目录的 .dev-mode.* / .dev-lock.* 残留文件
 * 对应分支已删除 → 删除文件
 *
 * @param {{ repoRoot?: string }} [opts]
 * @returns {Promise<{ devmode_cleaned: number, errors: string[] }>}
 */
export async function cleanupStaleDevModeFiles({ repoRoot = REPO_ROOT } = {}) {
  const stats = { devmode_cleaned: 0, errors: [] };

  let entries = [];
  try {
    entries = readdirSync(repoRoot);
  } catch (e) {
    stats.errors.push(e.message);
    return stats;
  }

  const devFiles = entries.filter(f => f.startsWith('.dev-mode.') || f.startsWith('.dev-lock.'));

  for (const filename of devFiles) {
    let branch = null;
    if (filename.startsWith('.dev-mode.')) {
      branch = filename.slice('.dev-mode.'.length);
    } else if (filename.startsWith('.dev-lock.')) {
      branch = filename.slice('.dev-lock.'.length);
    }

    if (!branch) continue;

    try {
      const result = execSync(`git branch --list "${branch}"`, {
        cwd: repoRoot, timeout: 5000, encoding: 'utf-8', stdio: 'pipe',
      });

      if (result.trim() === '') {
        const filePath = join(repoRoot, filename);
        unlinkSync(filePath);
        stats.devmode_cleaned++;
        console.log('[StartupRecovery:cleanupStaleDevModeFiles] removed:', filename,
          JSON.stringify({ cleanup_type: 'devmode_file', path: filePath, result: 'removed' }));
      }
    } catch (e) {
      stats.errors.push(`branch-check:${branch}: ${e.message}`);
      console.warn('[StartupRecovery:cleanupStaleDevModeFiles] branch check failed, skipping:', filename);
    }
  }

  console.log(`[StartupRecovery:cleanupStaleDevModeFiles] done devmode_cleaned=${stats.devmode_cleaned}`);
  return stats;
}

/**
 * 执行启动时环境清理（不含 DB 孤儿任务恢复）
 * DB 孤儿任务恢复由 executor.js::syncOrphanTasksOnStartup 负责
 * @returns {Promise<{ worktrees_pruned: number, slots_freed: number, devmode_cleaned: number }>}
 */
export async function runStartupRecovery() {
  const [wtStats, slotStats, devStats] = await Promise.all([
    cleanupStaleWorktrees().catch(e => ({ pruned: 0, removed: 0, errors: [e.message] })),
    cleanupStaleLockSlots().catch(e => ({ slots_freed: 0, errors: [e.message] })),
    cleanupStaleDevModeFiles().catch(e => ({ devmode_cleaned: 0, errors: [e.message] })),
  ]);

  const summary = {
    worktrees_pruned: wtStats.removed,
    slots_freed: slotStats.slots_freed,
    devmode_cleaned: devStats.devmode_cleaned,
  };

  console.log('[StartupRecovery] Cleanup summary:', JSON.stringify(summary));
  return summary;
}
