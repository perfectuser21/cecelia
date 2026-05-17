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
import { existsSync, readdirSync, rmSync, readFileSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { withLock } from './utils/cleanup-lock.js';

const REPO_ROOT = process.env.REPO_ROOT || '/Users/administrator/perfect21/cecelia';
const WORKTREE_BASE = process.env.WORKTREE_BASE || '/Users/administrator/perfect21/cecelia/.claude/worktrees';
const LOCK_DIR = process.env.LOCK_DIR || '/tmp/cecelia-locks';

// W7.3 Bug #E: 活跃 lock 时间窗（24h 内修改的 lock 视为活跃）
const ACTIVE_LOCK_WINDOW_MS = 24 * 3600 * 1000;

/**
 * W7.3 升级 (2026-05-07): 探测当前所有活跃 docker container 的 mount source 路径。
 *
 * 背景：W8 task-39d535f3 跑到 reviewer 阶段时 Brain 重启 → git worktree list
 * 拿不到 harness-v2/task-39d535f3（race）→ .dev-lock 保护未命中（harness
 * 容器不写 .dev-lock）→ 整个 worktree 目录被 rm -rf。
 *
 * docker 是这一类活跃 worktree 唯一可靠的真实信号源。
 *
 * 流程：
 *   1. `docker ps --format '{{.ID}}'` 拿全部活跃 container ID
 *   2. 对每个 container 调 `docker inspect --format '{{json .Mounts}}'`
 *   3. 收集所有 mount 的 Source 字段
 *
 * docker ps 抛错 → 整个函数抛错（让 caller 决定降级策略：
 * 保守跳过删除 vs 继续按既有逻辑删）。单个 container inspect 失败容忍
 * （可能 container 在我们 ps 后立即退出）。
 *
 * @returns {Set<string>} 全部活跃 container 的 mount source 路径集合
 * @throws {Error} docker ps 失败时
 */
export function getActiveContainerMountPaths() {
  const psOut = execSync("docker ps --format '{{.ID}}'", {
    timeout: 5000, encoding: 'utf-8', stdio: 'pipe',
  });
  const ids = String(psOut || '').split('\n').map(s => s.trim()).filter(Boolean);

  const paths = new Set();
  for (const id of ids) {
    let inspectOut;
    try {
      inspectOut = execSync(`docker inspect --format '{{json .Mounts}}' ${id}`, {
        timeout: 5000, encoding: 'utf-8', stdio: 'pipe',
      });
    } catch {
      continue;
    }
    let mounts;
    try {
      mounts = JSON.parse(String(inspectOut || '').trim() || '[]');
    } catch {
      continue;
    }
    if (!Array.isArray(mounts)) continue;
    for (const m of mounts) {
      if (m && typeof m.Source === 'string' && m.Source) {
        paths.add(m.Source);
      }
    }
  }
  return paths;
}

/**
 * W7.3 升级：判断 worktree 路径是否被某活跃 container mount。
 * 命中规则：worktree 路径等于 mount source，或 mount source 在 worktree 内部。
 * （前者覆盖整目录 mount，后者覆盖只 mount 子路径的场景。）
 *
 * @param {string} worktreePath
 * @param {Set<string>} activeMountPaths
 * @returns {string|null} 命中的 mount source，未命中返回 null
 */
function findContainerMountMatch(worktreePath, activeMountPaths) {
  if (!activeMountPaths || activeMountPaths.size === 0) return null;
  const wtNorm = worktreePath.replace(/\/+$/, '');
  for (const src of activeMountPaths) {
    if (!src) continue;
    if (src === wtNorm) return src;
    if (src.startsWith(wtNorm + '/')) return src;
    if (wtNorm.startsWith(src + '/')) return src; // mount 是 worktree 父目录的极端情况
  }
  return null;
}

/**
 * W7.3 Bug #E: 检测 worktree 是否含活跃 dev lock，命中则不应清理。
 *
 * 命中规则（任一满足即视为活跃，跳过删除）：
 *   1) <worktreePath>/.dev-lock 文件存在且 mtime 在 24h 内
 *   2) <worktreePath>/.dev-mode 或 .dev-mode.* 文件存在且 mtime 在 24h 内
 *
 * 设计动机：5/6 startup-recovery 误清 4 个正在使用的 cp-* worktree。
 * 24h 窗口足够覆盖一次正常 /dev 流程，超时则视为残留可清理。
 *
 * @param {string} worktreePath - worktree 根目录绝对路径
 * @returns {boolean} true = 含活跃 lock，应跳过清理
 */
export function hasActiveDevLock(worktreePath) {
  const now = Date.now();

  // 1) .dev-lock 在 worktree 根
  const lockPath = join(worktreePath, '.dev-lock');
  if (existsSync(lockPath)) {
    try {
      const mtime = statSync(lockPath).mtimeMs;
      if (now - mtime < ACTIVE_LOCK_WINDOW_MS) return true;
    } catch {
      // stat 失败 → 保守不视为活跃，继续检查 .dev-mode.*
    }
  }

  // 2) .dev-mode / .dev-mode.<branch> per-branch lock
  let entries = [];
  try {
    entries = readdirSync(worktreePath);
  } catch {
    return false; // 读不了 worktree → 不能判断，让上层走原 active-paths 逻辑
  }

  for (const raw of entries) {
    // 兼容两种返回：字符串（默认）或 Dirent 对象（withFileTypes:true）
    const name = typeof raw === 'string' ? raw : (raw && raw.name);
    if (typeof name !== 'string') continue;
    if (name !== '.dev-mode' && !name.startsWith('.dev-mode.')) continue;
    const fp = join(worktreePath, name);
    try {
      const mtime = statSync(fp).mtimeMs;
      if (now - mtime < ACTIVE_LOCK_WINDOW_MS) return true;
    } catch {
      // 单文件 stat 失败 → 跳过这一个，继续检查下一个
    }
  }

  return false;
}

/**
 * 清理孤立的 git worktree 目录
 * 1. git worktree prune（清理无效元数据引用）
 * 2. 扫描 WORKTREE_BASE，删除不在 git worktree list 中的目录
 *
 * @param {{ repoRoot?: string, worktreeBase?: string }} [opts]
 * @returns {Promise<{ pruned: number, removed: number, errors: string[] }>}
 */
export async function cleanupStaleWorktrees({ repoRoot = REPO_ROOT, worktreeBase = WORKTREE_BASE } = {}) {
  const stats = {
    pruned: 0,
    removed: 0,
    errors: [],
    skipped_locked: 0,
    skipped_active_lock: 0,
    skipped_active_container: 0,
    skipped_docker_probe: 0,
  };

  // Brain 启动时拿锁 — 与运行中的 zombie-cleaner / zombie-sweep / cecelia-run cleanup trap
  // 互斥，否则 git worktree prune 期间别人 worktree remove 会撕坏 .git/worktrees 元数据
  const result = await withLock({}, async () => {
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

    // 3. W7.3 升级 (2026-05-07): docker container 活跃性 probe（在扫目录前一次性调）
    // probe 失败 → 保守降级：所有 stale dir 跳过删除（不抛错，仅 warn）。
    let activeMountPaths = null;
    let dockerProbeFailed = false;
    try {
      activeMountPaths = getActiveContainerMountPaths();
    } catch (e) {
      dockerProbeFailed = true;
      console.warn('[StartupRecovery:cleanupStaleWorktrees] docker probe failed, conservatively skipping all worktree deletions:', e.message);
    }

    // 4. Scan WORKTREE_BASE and remove stale dirs
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
          // W7.3 升级：docker probe 失败 → 保守跳过（杜绝误删活跃 harness worktree）
          if (dockerProbeFailed) {
            stats.skipped_docker_probe++;
            console.warn('[StartupRecovery:cleanupStaleWorktrees] skip due to docker probe failure:', fullPath,
              JSON.stringify({ cleanup_type: 'worktree_dir', path: fullPath, result: 'skipped_docker_probe' }));
            continue;
          }
          // W7.3 升级：worktree 是某活跃 container 的 mount source → 跳过
          const mountMatch = findContainerMountMatch(fullPath, activeMountPaths);
          if (mountMatch) {
            stats.skipped_active_container++;
            console.log('[StartupRecovery] skipped active container worktree:', fullPath, '(mount:', mountMatch, ')',
              JSON.stringify({ cleanup_type: 'worktree_dir', path: fullPath, result: 'skipped_active_container', mount_source: mountMatch }));
            continue;
          }
          // W7.3 Bug #E: 含活跃 .dev-lock / .dev-mode.* 的 worktree 不删
          // (5/6 误清 4 个 cp-* worktree 事故根因)
          if (hasActiveDevLock(fullPath)) {
            stats.skipped_active_lock++;
            console.log('[StartupRecovery:cleanupStaleWorktrees] skip active-lock worktree:', fullPath,
              JSON.stringify({ cleanup_type: 'worktree_dir', path: fullPath, result: 'skipped_active_lock' }));
            continue;
          }
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
    return true;
  });

  if (result === null) {
    stats.skipped_locked = 1;
    stats.errors.push('cleanup-lock contention, startup-recovery skipped this round');
    console.warn('[StartupRecovery:cleanupStaleWorktrees] cleanup-lock contention — skipping worktree cleanup at startup (will retry next zombie-sweep tick)');
  }

  console.log(`[StartupRecovery:cleanupStaleWorktrees] done worktrees_pruned=${stats.pruned} stale_removed=${stats.removed} skipped_locked=${stats.skipped_locked} skipped_active_lock=${stats.skipped_active_lock} skipped_active_container=${stats.skipped_active_container} skipped_docker_probe=${stats.skipped_docker_probe}`);
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
  // Any queued task still claimed by THIS process's ID must be a leftover from a
  // previous crashed run (Docker Brain always starts as PID 7, so claimerId recurs).
  // Clear them unconditionally — we haven't made any claims yet at startup.
  const selfClaimerId = process.env.BRAIN_RUNNER_ID || `brain-tick-${process.pid}`;

  try {
    // Step 1: Clear all claims by this process's claimerId (previous-crash leftovers).
    // 同时覆盖 status='queued' 与 'paused' — 后者诞生于 Brain 派发后任务进 in_progress
    // 又被 quarantine/eviction/fail 转入 paused 但 claimed_by 没释放的死锁场景
    // （5/3 实测 28 个 paused 任务被 brain-tick-7 锁 19 天）。
    const selfResult = await pool.query(
      `UPDATE tasks
          SET claimed_by = NULL, claimed_at = NULL
        WHERE status IN ('queued', 'paused')
          AND claimed_by = $1
      RETURNING id, status`,
      [selfClaimerId]
    );
    if (selfResult.rowCount > 0) {
      const byStatus = selfResult.rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
      console.log(
        `[StartupRecovery:cleanupStaleClaims] cleared ${selfResult.rowCount} self-PID claims (${selfClaimerId}) by_status=${JSON.stringify(byStatus)}`,
        JSON.stringify({ cleanup_type: 'self_pid_claim', cleaned: selfResult.rowCount, by_status: byStatus })
      );
      stats.cleaned += selfResult.rowCount;
    }

    // Step 2: Clear stale claims from other claimerIds (time-window based).
    // 同覆盖 paused —— 防 brain-tick-N 离线后 paused+claimed_by 永久死锁。
    const { rows } = await pool.query(
      `SELECT id, claimed_by, claimed_at, status
         FROM tasks
        WHERE status IN ('queued', 'paused')
          AND claimed_by IS NOT NULL
          AND claimed_by != $1
          AND (claimed_at IS NULL OR claimed_at < NOW() - ($2::int * INTERVAL '1 minute'))`,
      [selfClaimerId, staleMinutes]
    );

    if (rows.length === 0) {
      if (stats.cleaned === 0) {
        console.log('[StartupRecovery:cleanupStaleClaims] no stale claims found');
      }
      return stats;
    }

    const taskIds = rows.map(r => r.id);
    const result = await pool.query(
      `UPDATE tasks
          SET claimed_by = NULL,
              claimed_at = NULL
        WHERE id = ANY($1::uuid[])
      RETURNING id`,
      [taskIds]
    );

    const otherCleaned = result.rowCount || 0;
    stats.cleaned += otherCleaned;
    const sample = rows.slice(0, 5).map(r => `${r.id}@${r.claimed_by}`);
    console.log(
      `[StartupRecovery:cleanupStaleClaims] cleared ${otherCleaned} stale claims from other pids (staleMinutes=${staleMinutes})`,
      JSON.stringify({ cleanup_type: 'stale_claim', cleaned: otherCleaned, sample })
    );
  } catch (e) {
    stats.errors.push(e.message);
    console.warn('[StartupRecovery:cleanupStaleClaims] failed:', e.message);
  }

  return stats;
}
