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
 * 找出所有 claude -p 进程，交叉比对 Brain in_progress 任务的进程注册表。
 * 无对应记录的进程 → SIGTERM → 等 5s → SIGKILL
 *
 * @returns {Promise<{checked: number, killed: number, errors: string[]}>}
 */
async function sweepOrphanProcesses() {
  const result = { checked: 0, killed: 0, errors: [] };

  // Find all claude -p processes
  let claudePids;
  try {
    const output = execSync("pgrep -f 'claude.*-p'", {
      encoding: 'utf8',
      timeout: 5000
    }).trim();
    claudePids = output
      ? output.split('\n').map(s => parseInt(s.trim(), 10)).filter(p => !isNaN(p))
      : [];
  } catch (err) {
    // pgrep exits 1 when no processes found — not an error
    if (err.status === 1) {
      return result;
    }
    result.errors.push(`pgrep failed: ${err.message}`);
    return result;
  }

  if (claudePids.length === 0) {
    return result;
  }

  // Get tracked PIDs from executor's in-memory registry
  const activeProcesses = getActiveProcesses();
  const trackedPids = new Set(activeProcesses.map(p => p.pid).filter(Boolean));

  // Also get PIDs from DB in_progress tasks (payload.pid field)
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
    // DB failure: be conservative, don't kill anything
    result.errors.push(`DB query failed (skipping process kill): ${err.message}`);
    return result;
  }

  // Current process — never kill self
  trackedPids.add(process.pid);

  for (const pid of claudePids) {
    result.checked++;

    if (trackedPids.has(pid)) {
      continue; // tracked, skip
    }

    // Orphan: SIGTERM → wait 5s → SIGKILL
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`[zombie-sweep] SIGTERM sent to orphan claude PID ${pid}`);

      // Wait 5 seconds then check again
      await new Promise(resolve => setTimeout(resolve, 5000));

      if (isPidAlive(pid)) {
        process.kill(pid, 'SIGKILL');
        console.log(`[zombie-sweep] SIGKILL sent to orphan claude PID ${pid} (still alive after SIGTERM)`);
      }

      result.killed++;

      try {
        await emit('zombie_orphan_killed', { pid, method: 'two_stage' });
      } catch { /* non-fatal */ }
    } catch (err) {
      const msg = `Failed to kill orphan PID ${pid}: ${err.message}`;
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
