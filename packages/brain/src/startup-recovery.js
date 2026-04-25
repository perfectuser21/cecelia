/**
 * Startup Recovery - Brain 重启后的环境清理
 *
 * DB 孤儿任务恢复由 executor.js::syncOrphanTasksOnStartup 统一负责，
 * 该函数执行进程检测，区分可重试 vs 真实失败，避免简单 requeue 覆盖智能逻辑。
 *
 * 本模块职责：
 *   - cleanupStaleWorktrees: 清理孤立 worktree 目录和元数据
 *   - cleanupStaleLockSlots: 释放无主 lock slot
 *   - cleanupStaleDevModeFiles: 删除死分支的 .dev-mode* 文件
 *   - cleanupStaleClaims: 释放 Brain 崩前被 claim 住但没真正执行的 queued task
 *
 * 注意：runStartupRecovery 不接受 pool、不访问 DB（测试强约束）。
 * cleanupStaleClaims 由 server 启动流程单独 import + 显式调用（和 syncOrphanTasksOnStartup 并列），
 * 不纳入 runStartupRecovery 的串联清理。
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
 * 执行环境清理（worktree / lock slot / dev-mode 文件）
 * DB 孤儿任务恢复由 executor.js::syncOrphanTasksOnStartup 负责（在 initTickLoop 前显式调用）
 * @returns {Promise<{ worktrees_pruned: number, slots_freed: number, devmode_cleaned: number }>}
 */
export async function runStartupRecovery() {
  // Environment cleanup (non-blocking, errors logged but don't stop startup)
  const [wtStats, slotStats, devStats] = await Promise.all([
    cleanupStaleWorktrees().catch(e => ({ pruned: 0, removed: 0, errors: [e.message] })),
    cleanupStaleLockSlots().catch(e => ({ slots_freed: 0, errors: [e.message] })),
    cleanupStaleDevModeFiles().catch(e => ({ devmode_cleaned: 0, errors: [e.message] })),
  ]);

  const result = {
    worktrees_pruned: wtStats.removed,
    slots_freed: slotStats.slots_freed,
    devmode_cleaned: devStats.devmode_cleaned,
  };

  console.log('[StartupRecovery] Cleanup summary:', JSON.stringify(result));
  return result;
}

/**
 * 清理 Brain 崩前 claim 但没跑完的 queued task。
 *
 * 背景：dispatcher 选 task 时用 `WHERE claimed_by IS NULL`，
 * 若 Brain 崩前写入了 claimed_by='brain-tick-N' 且 status='queued'，
 * 新 Brain 启动后这些任务将永远无法再被派发（死锁）。
 *
 * 判定 stale 的条件（任一满足）：
 *   1. claimed_at 为空（老字段或异常写入）
 *   2. claimed_at 早于 NOW() - staleMinutes
 *
 * 清理动作：UPDATE tasks SET claimed_by=NULL, claimed_at=NULL WHERE ...
 *   不改 status — 保持 'queued'，交给 dispatcher 重新选。
 *
 * @param {object} pool - pg Pool 实例（由 caller 注入，本模块不持有 pool）
 * @param {{ staleMinutes?: number }} [opts]
 * @returns {Promise<{ cleaned: number, errors: string[] }>}
 */
export async function cleanupStaleClaims(pool, opts = {}) {
  const stats = { cleaned: 0, errors: [] };
  if (!pool || typeof pool.query !== 'function') {
    stats.errors.push('pool not provided');
    return stats;
  }

  const staleMinutes = Number.isFinite(opts.staleMinutes) ? opts.staleMinutes : 60;

  try {
    // 1. 扫描 queued + claimed_by 非空的 task
    const { rows } = await pool.query(
      `SELECT id, claimed_by, claimed_at
         FROM tasks
        WHERE status = 'queued'
          AND claimed_by IS NOT NULL
          AND (claimed_at IS NULL OR claimed_at < NOW() - ($1::int * INTERVAL '1 minute'))`,
      [staleMinutes]
    );

    if (rows.length === 0) {
      console.log('[StartupRecovery:cleanupStaleClaims] no stale claims found');
      return stats;
    }

    // 2. 批量清空 claimed_by / claimed_at
    const taskIds = rows.map(r => r.id);
    const result = await pool.query(
      `UPDATE tasks
          SET claimed_by = NULL,
              claimed_at = NULL
        WHERE id = ANY($1::uuid[])
      RETURNING id`,
      [taskIds]
    );

    stats.cleaned = result.rowCount || 0;
    const sample = rows.slice(0, 5).map(r => `${r.id}@${r.claimed_by}`);
    console.log(
      `[StartupRecovery:cleanupStaleClaims] cleared ${stats.cleaned} stale claims (staleMinutes=${staleMinutes})`,
      JSON.stringify({ cleanup_type: 'stale_claim', cleaned: stats.cleaned, sample })
    );
  } catch (e) {
    stats.errors.push(e.message);
    console.warn('[StartupRecovery:cleanupStaleClaims] failed:', e.message);
  }

  return stats;
}
