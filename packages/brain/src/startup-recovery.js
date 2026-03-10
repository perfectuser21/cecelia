/**
 * Startup Recovery - Brain 重启后的孤儿任务恢复 + 环境清理
 *
 * 问题：Brain 重启时，status=in_progress 的任务因进程被终止无法回调，
 * 导致任务永久卡死（直到 monitor-loop 5 分钟后才发现）。
 *
 * 解决：Brain 启动时立即扫描并重置无心跳的孤儿任务为 queued 状态，
 * 让首次 tick 就能重新派发，而不是等待 5+ 分钟。
 *
 * 安全性：只重置 updated_at 超过 5 分钟的任务，防止误杀刚派发的任务。
 *
 * v2：新增启动时环境清理
 *   - cleanupStaleWorktrees: 清理孤立 worktree 目录和元数据
 *   - cleanupStaleLockSlots: 释放无主 lock slot
 *   - cleanupStaleDevModeFiles: 删除死分支的 .dev-mode* 文件
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync, rmSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { quarantineTask } from './quarantine.js';

const ORPHAN_THRESHOLD_MINUTES = 5;
const ORPHAN_MAX_RETRIES = 3; // retry_count >= this → quarantine instead of requeue
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
 * 扫描孤儿 in_progress 任务并按 retry_count 处理：
 *   retry_count < ORPHAN_MAX_RETRIES → requeue（status=queued, retry_count+1）
 *   retry_count >= ORPHAN_MAX_RETRIES → quarantine
 * 同时执行环境清理（worktree / lock / dev-mode）。
 *
 * @param {import('pg').Pool} pool - pg Pool 实例
 * @returns {Promise<{ requeued: Array<{id:string, title:string}>, quarantined: Array<{id:string, title:string}>, worktrees_pruned: number, slots_freed: number, devmode_cleaned: number, error?: string }>}
 */
export async function runStartupRecovery(pool) {
  // Environment cleanup (non-blocking, errors don't stop DB recovery)
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

  // DB orphan task recovery
  try {
    // 找出所有孤儿任务（含 retry_count）
    const orphanResult = await pool.query(`
      SELECT id, title, COALESCE(retry_count, 0) AS retry_count
      FROM tasks
      WHERE status = 'in_progress'
        AND updated_at < NOW() - INTERVAL '${ORPHAN_THRESHOLD_MINUTES} minutes'
    `);

    const orphans = orphanResult.rows;

    if (orphans.length === 0) {
      console.log('[StartupRecovery] No orphaned tasks found');
      return { requeued: [], quarantined: [], ...summary };
    }

    const toRequeue = orphans.filter(t => t.retry_count < ORPHAN_MAX_RETRIES);
    const toQuarantine = orphans.filter(t => t.retry_count >= ORPHAN_MAX_RETRIES);

    // Requeue eligible orphans
    let requeued = [];
    if (toRequeue.length > 0) {
      const requeueIds = toRequeue.map(t => t.id);
      const requeueResult = await pool.query(`
        UPDATE tasks
        SET status = 'queued',
            retry_count = retry_count + 1,
            started_at = NULL,
            updated_at = NOW()
        WHERE id = ANY($1::uuid[])
        RETURNING id, title, retry_count
      `, [requeueIds]);
      requeued = requeueResult.rows;

      // Cancel corresponding zombie run_events
      await pool.query(`
        UPDATE run_events
        SET status = 'cancelled', updated_at = NOW()
        WHERE task_id = ANY($1::uuid[])
          AND status = 'running'
      `, [requeueIds]);

      console.log(`[StartupRecovery] Re-queued ${requeued.length} orphaned tasks:`, requeueIds);
    }

    // Quarantine max-retry orphans
    const quarantined = [];
    for (const task of toQuarantine) {
      try {
        await quarantineTask(
          task.id,
          'startup_orphan_max_retries',
          { retry_count: task.retry_count }
        );
        quarantined.push({ id: task.id, title: task.title });
        console.log(`[StartupRecovery] Quarantined orphan (max retries=${task.retry_count}): ${task.id}`);
      } catch (qErr) {
        console.error(`[StartupRecovery] Failed to quarantine orphan ${task.id}:`, qErr.message);
      }
    }

    return { requeued, quarantined, ...summary };

  } catch (err) {
    // 恢复失败不能阻塞 Brain 启动
    console.error('[StartupRecovery] ERROR: DB query failed, skipping recovery:', err.message);
    return { requeued: [], quarantined: [], error: err.message, ...summary };
  }
}
