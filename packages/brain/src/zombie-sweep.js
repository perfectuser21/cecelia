/**
 * Zombie Sweep Module
 *
 * 主动周期性巡检，三维清理：
 * 1. Stale Worktree  — 对应任务已完成/失败的 git worktree
 * 2. Orphan Process  — 无对应 DB 任务的 claude agent 进程
 * 3. Stale Lock Slot — 对应进程已消亡的 /tmp/cecelia-locks/slot-*
 *
 * 安全规则：
 * - 当前 worktree（self）不删
 * - 30 分钟内创建的 worktree 有 grace period
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync, rmSync, readFileSync, statSync } from 'fs';
import path from 'path';
import pool from './db.js';
import { emit } from './event-bus.js';
import { getActiveProcesses } from './executor.js';

const GRACE_PERIOD_MS = 30 * 60 * 1000; // 30 minutes
const LOCK_SLOT_DIR = '/tmp/cecelia-locks';

/**
 * Check if a PID is alive using kill -0
 * @param {number} pid
 * @returns {boolean}
 */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the main repo root path
 * @returns {string|null}
 */
function getMainRepoPath() {
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      timeout: 5000
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Get the current worktree path (self)
 * @returns {string|null}
 */
function getCurrentWorktreePath() {
  try {
    return process.cwd();
  } catch {
    return null;
  }
}

/**
 * Parse `git worktree list --porcelain` output
 * @param {string} output
 * @returns {Array<{path: string, branch: string, bare: boolean}>}
 */
function parseWorktreeList(output) {
  const worktrees = [];
  const blocks = output.trim().split('\n\n');

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const wt = {};
    for (const line of lines) {
      if (line.startsWith('worktree ')) wt.path = line.slice(9);
      else if (line.startsWith('branch ')) wt.branch = line.slice(7).replace('refs/heads/', '');
      else if (line === 'bare') wt.bare = true;
    }
    if (wt.path) worktrees.push(wt);
  }

  return worktrees;
}

/**
 * Dimension 1: Stale Worktree Cleanup
 *
 * 扫描 git worktree 列表，交叉比对 DB 中 in_progress 任务。
 * 对应任务已完成/失败/隔离或不存在 → git worktree remove --force
 *
 * @returns {Promise<{checked: number, removed: number, skipped: number, errors: string[]}>}
 */
async function sweepStaleWorktrees() {
  const result = { checked: 0, removed: 0, skipped: 0, errors: [] };

  const mainRepoPath = getMainRepoPath();
  if (!mainRepoPath) {
    result.errors.push('Cannot determine main repo path');
    return result;
  }

  const selfPath = getCurrentWorktreePath();

  // Get all worktrees
  let worktrees;
  try {
    const output = execSync('git worktree list --porcelain', {
      encoding: 'utf8',
      timeout: 10000,
      cwd: mainRepoPath
    });
    worktrees = parseWorktreeList(output);
  } catch (err) {
    result.errors.push(`git worktree list failed: ${err.message}`);
    return result;
  }

  // Skip main worktree (first entry = main)
  const nonMainWorktrees = worktrees.filter((wt, idx) => idx !== 0);

  if (nonMainWorktrees.length === 0) {
    return result;
  }

  // Get in_progress task branches from DB
  let inProgressBranches;
  try {
    const dbResult = await pool.query(
      `SELECT payload->>'branch' AS branch, id, status
       FROM tasks
       WHERE status = 'in_progress'
         AND payload->>'branch' IS NOT NULL`
    );
    inProgressBranches = new Set(dbResult.rows.map(r => r.branch));
  } catch (err) {
    result.errors.push(`DB query failed: ${err.message}`);
    return result;
  }

  for (const wt of nonMainWorktrees) {
    result.checked++;

    // Safety: skip self
    if (selfPath && wt.path === selfPath) {
      result.skipped++;
      continue;
    }

    // Safety: grace period — skip worktrees created < 30 min ago
    try {
      const stat = statSync(wt.path);
      const ageMs = Date.now() - stat.birthtimeMs;
      if (ageMs < GRACE_PERIOD_MS) {
        result.skipped++;
        continue;
      }
    } catch {
      // Can't stat → assume it's stale, proceed
    }

    // Check if branch has an in_progress task
    if (wt.branch && inProgressBranches.has(wt.branch)) {
      result.skipped++;
      continue;
    }

    // Remove stale worktree
    try {
      execSync(`git worktree remove --force "${wt.path}"`, {
        encoding: 'utf8',
        timeout: 15000,
        cwd: mainRepoPath
      });
      result.removed++;
      console.log(`[zombie-sweep] Removed stale worktree: ${wt.path} (branch: ${wt.branch || 'detached'})`);
    } catch (err) {
      const msg = `Failed to remove worktree ${wt.path}: ${err.message}`;
      result.errors.push(msg);
      console.error(`[zombie-sweep] ${msg}`);
    }
  }

  return result;
}

/**
 * Dimension 2: Orphan Process Cleanup
 *
 * 搜索所有 claude 进程（不只是 claude -p），交叉比对 Brain 任务注册表 + lock slot。
 * 孤儿进程（ppid=1 且不属于任何活跃任务的进程树）→ SIGTERM → 等 5s → SIGKILL
 *
 * 修复：旧版只搜 `pgrep -f 'claude.*-p'`，漏掉了 subagent（命令行是光秃秃的 `claude`，
 * 没有 -p 参数）。这些 subagent 变成孤儿后持续消耗 token 和内存。
 *
 * @returns {Promise<{checked: number, killed: number, errors: string[]}>}
 */
async function sweepOrphanProcesses() {
  const result = { checked: 0, killed: 0, errors: [] };

  // 1. 用 ps 获取所有进程信息（pid, ppid, command）
  let allProcesses;
  try {
    const output = execSync('ps -eo pid=,ppid=,args=', {
      encoding: 'utf8',
      timeout: 5000
    }).trim();
    allProcesses = output.split('\n').map(line => {
      const trimmed = line.trim();
      const match = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) return null;
      return { pid: parseInt(match[1], 10), ppid: parseInt(match[2], 10), cmd: match[3] };
    }).filter(Boolean);
  } catch (err) {
    result.errors.push(`ps failed: ${err.message}`);
    return result;
  }

  // 2. 筛选所有 claude 进程（包含 subagent）
  const claudeProcesses = allProcesses.filter(p =>
    /(?:^|\/)claude(?:\s|$)/.test(p.cmd)
  );

  if (claudeProcesses.length === 0) {
    return result;
  }

  // 3. 收集所有受保护的 PID（tracked）
  const trackedPids = new Set();

  // 3a. executor 内存注册表
  const activeProcesses = getActiveProcesses();
  for (const p of activeProcesses) {
    if (p.pid) trackedPids.add(p.pid);
  }

  // 3b. DB 中 in_progress 任务的 pid
  try {
    const dbResult = await pool.query(
      `SELECT (payload->>'pid')::int AS pid
       FROM tasks
       WHERE status = 'in_progress'
         AND payload->>'pid' IS NOT NULL`
    );
    for (const row of dbResult.rows) {
      if (row.pid) trackedPids.add(row.pid);
    }
  } catch (err) {
    // DB 失败：保守策略，不杀任何进程
    result.errors.push(`DB query failed (skipping process kill): ${err.message}`);
    return result;
  }

  // 3c. lock slot 里的 pid 和 child_pid
  try {
    if (existsSync(LOCK_SLOT_DIR)) {
      const slots = readdirSync(LOCK_SLOT_DIR).filter(name => name.startsWith('slot-'));
      for (const slot of slots) {
        const infoPath = path.join(LOCK_SLOT_DIR, slot, 'info.json');
        if (existsSync(infoPath)) {
          try {
            const info = JSON.parse(readFileSync(infoPath, 'utf8'));
            if (info.pid) trackedPids.add(parseInt(info.pid, 10));
            if (info.child_pid) trackedPids.add(parseInt(info.child_pid, 10));
            if (info.pgid) trackedPids.add(parseInt(info.pgid, 10));
          } catch { /* corrupt info.json, skip */ }
        }
      }
    }
  } catch { /* lock dir read failure, continue with what we have */ }

  // 3d. 自身进程
  trackedPids.add(process.pid);

  // 4. 构建 ppid 索引，用于判断进程树归属
  const pidToPpid = new Map();
  for (const p of allProcesses) {
    pidToPpid.set(p.pid, p.ppid);
  }

  /**
   * 判断 pid 是否是某个 tracked PID 的后代
   * 递归向上查 ppid 链，最多 50 层防死循环
   */
  function isDescendantOfTracked(pid) {
    const visited = new Set();
    let current = pid;
    for (let i = 0; i < 50; i++) {
      if (trackedPids.has(current)) return true;
      if (visited.has(current)) return false;
      visited.add(current);
      const parent = pidToPpid.get(current);
      if (!parent || parent <= 1) return false;
      current = parent;
    }
    return false;
  }

  // 5. 判断每个 claude 进程是否是孤儿
  for (const proc of claudeProcesses) {
    result.checked++;

    // 直接 tracked → 安全
    if (trackedPids.has(proc.pid)) continue;

    // 是 tracked 进程的后代 → 安全（活跃任务的 subagent）
    if (isDescendantOfTracked(proc.pid)) continue;

    // 交互式 claude 会话（没有 -p 且 ppid != 1）→ 用户手动启动的，跳过
    if (!/ -p /.test(proc.cmd) && proc.ppid !== 1) continue;

    // 到这里 = 孤儿进程：ppid=1 或无主的 -p 进程
    // SIGTERM → 等 5s → SIGKILL
    try {
      process.kill(proc.pid, 'SIGTERM');
      console.log(`[zombie-sweep] SIGTERM sent to orphan claude PID ${proc.pid} (ppid=${proc.ppid}, cmd=${proc.cmd.slice(0, 80)})`);

      await new Promise(resolve => setTimeout(resolve, 5000));

      if (isPidAlive(proc.pid)) {
        process.kill(proc.pid, 'SIGKILL');
        console.log(`[zombie-sweep] SIGKILL sent to orphan claude PID ${proc.pid} (still alive after SIGTERM)`);
      }

      result.killed++;

      try {
        await emit('zombie_orphan_killed', { pid: proc.pid, ppid: proc.ppid, method: 'two_stage' });
      } catch { /* non-fatal */ }
    } catch (err) {
      const msg = `Failed to kill orphan PID ${proc.pid}: ${err.message}`;
      result.errors.push(msg);
      console.error(`[zombie-sweep] ${msg}`);
    }
  }

  return result;
}

/**
 * Dimension 3: Stale Lock Slot Cleanup
 *
 * 扫描 /tmp/cecelia-locks/slot-* 下的 info.json。
 * PID 不存在 → 删除整个 slot 目录。
 *
 * @returns {Promise<{checked: number, removed: number, errors: string[]}>}
 */
async function sweepStaleLockSlots() {
  const result = { checked: 0, removed: 0, errors: [] };

  if (!existsSync(LOCK_SLOT_DIR)) {
    return result;
  }

  let slots;
  try {
    slots = readdirSync(LOCK_SLOT_DIR).filter(name => name.startsWith('slot-'));
  } catch (err) {
    result.errors.push(`Failed to read lock slot dir: ${err.message}`);
    return result;
  }

  for (const slot of slots) {
    const slotPath = path.join(LOCK_SLOT_DIR, slot);
    const infoPath = path.join(slotPath, 'info.json');
    result.checked++;

    if (!existsSync(infoPath)) {
      // No info.json — stale slot, remove
      try {
        rmSync(slotPath, { recursive: true, force: true });
        result.removed++;
        console.log(`[zombie-sweep] Removed lock slot (no info.json): ${slotPath}`);
      } catch (err) {
        result.errors.push(`Failed to remove slot ${slotPath}: ${err.message}`);
      }
      continue;
    }

    // Parse info.json to get PID
    let info;
    try {
      info = JSON.parse(readFileSync(infoPath, 'utf8'));
    } catch {
      // Corrupt info.json — remove slot
      try {
        rmSync(slotPath, { recursive: true, force: true });
        result.removed++;
      } catch { /* ignore */ }
      continue;
    }

    const pid = info.pid ? parseInt(info.pid, 10) : null;

    if (!pid || !isPidAlive(pid)) {
      try {
        rmSync(slotPath, { recursive: true, force: true });
        result.removed++;
        console.log(`[zombie-sweep] Removed stale lock slot (PID ${pid} dead): ${slotPath}`);
      } catch (err) {
        const msg = `Failed to remove slot ${slotPath}: ${err.message}`;
        result.errors.push(msg);
        console.error(`[zombie-sweep] ${msg}`);
      }
    }
  }

  return result;
}

/**
 * Run the full zombie sweep across all three dimensions.
 * Non-blocking: exceptions in one dimension don't affect others.
 * Results are written to working_memory for dashboard display.
 *
 * @returns {Promise<Object>} Sweep result summary
 */
async function zombieSweep() {
  const startedAt = new Date().toISOString();
  const sweepResult = {
    started_at: startedAt,
    completed_at: null,
    worktrees: { checked: 0, removed: 0, skipped: 0, errors: [] },
    processes: { checked: 0, killed: 0, errors: [] },
    lock_slots: { checked: 0, removed: 0, errors: [] }
  };

  console.log('[zombie-sweep] Starting zombie sweep...');

  // Dimension 1: Stale Worktrees
  try {
    sweepResult.worktrees = await sweepStaleWorktrees();
  } catch (err) {
    sweepResult.worktrees.errors.push(`Unexpected error: ${err.message}`);
    console.error('[zombie-sweep] Worktree sweep failed:', err.message);
  }

  // Dimension 2: Orphan Processes
  try {
    sweepResult.processes = await sweepOrphanProcesses();
  } catch (err) {
    sweepResult.processes.errors.push(`Unexpected error: ${err.message}`);
    console.error('[zombie-sweep] Process sweep failed:', err.message);
  }

  // Dimension 3: Stale Lock Slots
  try {
    sweepResult.lock_slots = await sweepStaleLockSlots();
  } catch (err) {
    sweepResult.lock_slots.errors.push(`Unexpected error: ${err.message}`);
    console.error('[zombie-sweep] Lock slot sweep failed:', err.message);
  }

  sweepResult.completed_at = new Date().toISOString();

  const summary = `worktrees: ${sweepResult.worktrees.removed} removed, ` +
    `processes: ${sweepResult.processes.killed} killed, ` +
    `lock_slots: ${sweepResult.lock_slots.removed} removed`;
  console.log(`[zombie-sweep] Sweep complete. ${summary}`);

  // Write result to working_memory
  try {
    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
      ['zombie_sweep_result', sweepResult]
    );
  } catch (err) {
    console.error('[zombie-sweep] Failed to write working_memory:', err.message);
  }

  return sweepResult;
}

/**
 * Get the last zombie sweep status from working_memory.
 * @returns {Promise<Object|null>}
 */
async function getZombieSweepStatus() {
  try {
    const result = await pool.query(
      'SELECT value_json, updated_at FROM working_memory WHERE key = $1',
      ['zombie_sweep_result']
    );
    if (result.rows.length === 0) {
      return null;
    }
    return {
      last_sweep: result.rows[0].value_json,
      updated_at: result.rows[0].updated_at
    };
  } catch (err) {
    console.error('[zombie-sweep] Failed to read working_memory:', err.message);
    return null;
  }
}

export {
  zombieSweep,
  getZombieSweepStatus,
  // Export internals for testing
  sweepStaleWorktrees,
  sweepOrphanProcesses,
  sweepStaleLockSlots,
  parseWorktreeList,
  isPidAlive,
  GRACE_PERIOD_MS,
  LOCK_SLOT_DIR
};
