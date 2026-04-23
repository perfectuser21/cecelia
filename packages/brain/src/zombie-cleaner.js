/**
 * Zombie Cleaner — 僵尸资源自动清理
 *
 * 三项清理职责：
 *   R1: Stale Slot 自动回收（pid 已死 >60s 的 lock slot 目录）
 *   R2: Git Worktree 孤儿清扫（无活跃任务对应且存在 >30min 的 worktree）
 *   R3: 连接池健康由 db.js getPoolHealth() 提供，metrics.js 纳入监控
 *
 * 设计原则：
 *   - 每步独立 try/catch，单步失败不影响其他步骤
 *   - 只清理已确认死亡的资源，不干扰正在运行的任务
 *   - 所有操作有日志记录，可审计
 */

import { existsSync, readFileSync, rmSync, statSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { resolveTaskPids } from './watchdog.js';
import { removeActiveProcess } from './executor.js';

const LOCK_DIR = process.env.LOCK_DIR || '/tmp/cecelia-locks';
const WORKTREE_BASE = process.env.WORKTREE_BASE || `${process.env.HOME}/worktrees/cecelia`;
const REPO_ROOT = process.env.REPO_ROOT || '/Users/administrator/perfect21/cecelia';

// 保护阈值
const STALE_SLOT_MIN_AGE_MS = 60 * 1000;           // slot 至少死亡 60 秒才清理
const ORPHAN_WORKTREE_MIN_AGE_MS = 30 * 60 * 1000; // worktree 至少孤儿 30 分钟才清理
const ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * R1: 清理 stale slot 目录（pid 已死超过 60 秒）
 *
 * @returns {{ reclaimed: number, errors: string[] }}
 */
function cleanupStaleSlots() {
  const result = { reclaimed: 0, errors: [] };

  let staleSlots;
  try {
    ({ staleSlots } = resolveTaskPids());
  } catch (err) {
    result.errors.push(`resolveTaskPids: ${err.message}`);
    return result;
  }

  if (!staleSlots || staleSlots.length === 0) {
    return result;
  }

  const now = Date.now();

  for (const { slot, taskId } of staleSlots) {
    const slotDir = join(LOCK_DIR, slot);

    try {
      if (!existsSync(slotDir)) {
        // Slot dir already gone, just clean activeProcesses
        removeActiveProcess(taskId);
        continue;
      }

      // 保护：检查 slot 目录的最后修改时间，防止竞态
      let mtime;
      try {
        mtime = statSync(slotDir).mtimeMs;
      } catch (e) {
        result.errors.push(`stat(${slot}): ${e.message}`);
        continue;
      }

      const ageMs = now - mtime;
      if (ageMs < STALE_SLOT_MIN_AGE_MS) {
        console.log(`[zombie-cleaner] Slot ${slot} (task=${taskId}) pid dead but age=${Math.round(ageMs / 1000)}s < 60s, skipping`);
        continue;
      }

      console.log(`[zombie-cleaner] Reclaiming stale slot: dir=${slotDir} task=${taskId} age=${Math.round(ageMs / 1000)}s`);

      rmSync(slotDir, { recursive: true, force: true });
      removeActiveProcess(taskId);

      result.reclaimed++;
      console.log(`[zombie-cleaner] Stale slot reclaimed: ${slot} (task=${taskId})`);
    } catch (err) {
      result.errors.push(`slot(${slot}): ${err.message}`);
    }
  }

  if (result.errors.length > 0) {
    console.warn(`[zombie-cleaner] cleanupStaleSlots completed with errors:`, result.errors);
  }

  return result;
}

/**
 * 从 worktree 目录中提取关联的 task_id。
 * 读取 .dev-mode 文件中的 UUID 格式 task_id。
 *
 * @param {string} wtPath - Worktree 目录路径
 * @returns {string|null} - task_id 或 null
 */
function findTaskIdForWorktree(wtPath) {
  try {
    const devModePath = join(wtPath, '.dev-mode');
    if (existsSync(devModePath)) {
      const content = readFileSync(devModePath, 'utf-8');
      // 尝试提取 UUID 格式的 task_id（Brain 任务 ID 格式）
      const taskMatch = content.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
      if (taskMatch) return taskMatch[1];
    }
  } catch {
    // ignore: file may not exist or be unreadable
  }
  return null;
}

/**
 * 判断 worktree 是否活跃（依据 .dev-mode* 文件 mtime < ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS）。
 * 覆盖老 `.dev-mode` 无后缀格式和新 `.dev-mode.${branch}` 格式（v19.0.0 cwd-as-key 起）。
 * Phase B2-bis: fix findTaskIdForWorktree 文件名不匹配 bug —— 改用 mtime 判活跃而非依赖文件内容解析 UUID。
 *
 * @param {string} wtPath - Worktree 目录路径
 * @returns {boolean} - true 如果任一 .dev-mode* 文件 mtime < 24h
 */
function isWorktreeActive(wtPath) {
  try {
    const now = Date.now();
    const entries = readdirSync(wtPath).filter(f => f.startsWith('.dev-mode'));
    for (const name of entries) {
      try {
        const mtimeMs = statSync(join(wtPath, name)).mtimeMs;
        if (now - mtimeMs < ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS) {
          return true;
        }
      } catch { /* continue on stat error */ }
    }
  } catch { /* readdir failed, treat as inactive */ }
  return false;
}

/**
 * R2: 清理孤儿 git worktree（无活跃任务对应且存在 >30min）
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<{ removed: number, errors: string[] }>}
 */
async function cleanupOrphanWorktrees(pool) {
  const result = { removed: 0, errors: [] };

  // 1. 获取当前所有 git worktree 路径（porcelain 格式）
  let worktreePaths;
  try {
    const raw = execSync('git worktree list --porcelain', {
      cwd: REPO_ROOT,
      timeout: 10000,
      encoding: 'utf-8',
    });
    // 每个 worktree 块以 "worktree <path>" 开头
    worktreePaths = raw
      .split('\n\n')
      .map(block => {
        const match = block.match(/^worktree (.+)/m);
        return match ? match[1].trim() : null;
      })
      .filter(Boolean);
  } catch (err) {
    result.errors.push(`git worktree list: ${err.message}`);
    return result;
  }

  // 过滤出在 WORKTREE_BASE 下的 worktree（排除主仓库和 /tmp 等）
  const managedWorktrees = worktreePaths.filter(p => p.startsWith(WORKTREE_BASE));

  if (managedWorktrees.length === 0) {
    return result;
  }

  // 2. 获取当前活跃任务
  let activeTasks = new Set();
  try {
    const queryResult = await pool.query(
      "SELECT id FROM tasks WHERE status = 'in_progress'"
    );
    for (const row of queryResult.rows) {
      activeTasks.add(row.id);
    }
  } catch (err) {
    result.errors.push(`db query: ${err.message}`);
    return result;
  }

  const now = Date.now();

  // 3. 扫描每个 managed worktree，判断是否为孤儿
  for (const wtPath of managedWorktrees) {
    try {
      if (!existsSync(wtPath)) continue;

      // 检查 worktree 年龄
      let mtime;
      try {
        mtime = statSync(wtPath).mtimeMs;
      } catch (e) {
        result.errors.push(`stat(${wtPath}): ${e.message}`);
        continue;
      }

      const ageMs = now - mtime;
      if (ageMs < ORPHAN_WORKTREE_MIN_AGE_MS) {
        continue; // 太新，跳过
      }

      // 活跃信号预检（Phase B2-bis）：.dev-mode* mtime fresh → 跳过
      if (isWorktreeActive(wtPath)) {
        continue;
      }

      // 老格式 .dev-mode 向后兼容：findTaskIdForWorktree + activeTasks 双回退
      const taskId = findTaskIdForWorktree(wtPath);
      if (taskId && activeTasks.has(taskId)) {
        continue; // 有对应活跃任务，不清理
      }

      const ageMin = Math.round(ageMs / 60000);
      console.log(`[zombie-cleaner] Orphan worktree: ${wtPath} age=${ageMin}min taskId=${taskId || 'unknown'}`);

      // git worktree remove --force
      try {
        execSync(`git worktree remove --force "${wtPath}"`, {
          cwd: REPO_ROOT,
          timeout: 15000,
          stdio: 'pipe',
        });
        result.removed++;
        console.log(`[zombie-cleaner] Orphan worktree removed: ${wtPath}`);
      } catch (_removeErr) {
        // Fallback: 手动删除
        try {
          rmSync(wtPath, { recursive: true, force: true });
          execSync('git worktree prune', { cwd: REPO_ROOT, timeout: 5000, stdio: 'pipe' });
          result.removed++;
          console.log(`[zombie-cleaner] Orphan worktree removed (fallback): ${wtPath}`);
        } catch (fallbackErr) {
          result.errors.push(`remove(${wtPath}): ${fallbackErr.message}`);
        }
      }
    } catch (err) {
      result.errors.push(`worktree(${wtPath}): ${err.message}`);
    }
  }

  if (result.errors.length > 0) {
    console.warn(`[zombie-cleaner] cleanupOrphanWorktrees completed with errors:`, result.errors);
  }

  return result;
}

/**
 * 统一清理入口 (R1 + R2)
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @returns {Promise<{ slotsReclaimed: number, worktreesRemoved: number, timestamp: string, errors: string[] }>}
 */
async function runZombieCleanup(pool) {
  const startTs = Date.now();
  console.log('[zombie-cleaner] Starting zombie resource cleanup...');

  const report = {
    slotsReclaimed: 0,
    worktreesRemoved: 0,
    timestamp: new Date(startTs).toISOString(),
    errors: [],
  };

  // R1: Stale slot 清理
  try {
    const slotResult = cleanupStaleSlots();
    report.slotsReclaimed = slotResult.reclaimed;
    report.errors.push(...slotResult.errors);
  } catch (err) {
    report.errors.push(`stale-slots: ${err.message}`);
  }

  // R2: 孤儿 worktree 清理
  try {
    const wtResult = await cleanupOrphanWorktrees(pool);
    report.worktreesRemoved = wtResult.removed;
    report.errors.push(...wtResult.errors);
  } catch (err) {
    report.errors.push(`orphan-worktrees: ${err.message}`);
  }

  const durationMs = Date.now() - startTs;
  console.log(
    `[zombie-cleaner] Cleanup done in ${durationMs}ms: ` +
    `slots=${report.slotsReclaimed} worktrees=${report.worktreesRemoved} errors=${report.errors.length}`
  );

  return report;
}

export {
  cleanupStaleSlots,
  cleanupOrphanWorktrees,
  runZombieCleanup,
  findTaskIdForWorktree,
  isWorktreeActive,
  STALE_SLOT_MIN_AGE_MS,
  ORPHAN_WORKTREE_MIN_AGE_MS,
  ACTIVE_WORKTREE_SIGNAL_THRESHOLD_MS,
};
