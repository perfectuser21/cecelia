/**
 * Cecelia Executor - Trigger headless Claude Code execution
 *
 * v2: Process-level tracking to prevent runaway dispatch.
 * - Tracks child PIDs in memory (activeProcesses Map)
 * - Deduplicates by taskId before spawning
 * - Cleans up orphan `claude -p` processes on startup
 * - Dynamic resource check before spawning (CPU load + memory)
 *
 * v3: State drift elimination.
 * - Liveness probe: tick-level process existence verification
 * - Startup sync: reconcile in_progress DB state with actual processes
 * - Suspect tracking: double-confirm before marking failed (avoid false positives)
 */

/* global console */
import { spawn, execSync } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import { readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import pool from './db.js';
import { getActiveProfile, FALLBACK_PROFILE } from './model-profile.js';
import { getTaskLocation } from './task-router.js';
import { updateTaskStatus, updateTaskProgress } from './task-updater.js';
import { traceStep, LAYER, STATUS, EXECUTOR_HOSTS } from './trace.js';

// HK MiniMax Executor URL (via Tailscale)
const HK_MINIMAX_URL = process.env.HK_MINIMAX_URL || 'http://100.86.118.99:5226';

// ==================== Input Validation ====================

const SAFE_ID_RE = /^[0-9a-zA-Z_-]+$/;
const PID_RE = /^\d+$/;

/**
 * Validate that a value is a safe UUID/hex-dash identifier before shell use.
 * @param {string} value
 * @param {string} label - for error messages
 */
function assertSafeId(value, label = 'id') {
  if (typeof value !== 'string' || !SAFE_ID_RE.test(value)) {
    throw new Error(`[executor] Invalid ${label}: ${String(value).slice(0, 50)}`);
  }
}

/**
 * Validate that a value is a numeric PID before shell use.
 * @param {*} value
 * @param {string} label - for error messages
 */
function assertSafePid(value, label = 'pid') {
  if (!PID_RE.test(String(value))) {
    throw new Error(`[executor] Invalid ${label}: ${String(value).slice(0, 50)}`);
  }
}

// Configuration
const CECELIA_RUN_PATH = process.env.CECELIA_RUN_PATH || '/home/xx/bin/cecelia-run';
const PROMPT_DIR = '/tmp/cecelia-prompts';
const WORK_DIR = process.env.CECELIA_WORK_DIR || '/home/xx/perfect21/cecelia/core';

// ==================== Diagnostic Functions ====================

/**
 * Get system dmesg information (last 100 lines).
 * Used to check for OOM Killer events.
 *
 * @returns {string|null} - dmesg output or null on error
 */
function getDmesgInfo() {
  try {
    const output = execSync('dmesg | tail -100', {
      timeout: 5000,
      encoding: 'utf-8'
    });
    return output;
  } catch (err) {
    console.warn('[diagnostic] Failed to read dmesg:', err.message);
    return null;
  }
}

/**
 * Get last 20 lines of process log.
 *
 * @param {string} taskId - Task ID
 * @returns {string|null} - Log tail or null if not found
 */
function getProcessLogTail(taskId) {
  const logPath = `/tmp/cecelia-${taskId}.log`;
  try {
    if (readFileSync) {
      const content = readFileSync(logPath, 'utf-8');
      return content.split('\n').slice(-20).join('\n');
    }
  } catch (err) {
    // Log file may not exist or not readable
    return null;
  }
  return null;
}

/**
 * Check process exit reason by examining system logs and process state.
 *
 * @param {number|null} pid - Process ID (may be null)
 * @param {string} taskId - Task ID for log lookup
 * @returns {Promise<Object>} - { reason, diagnostic_info }
 */
async function checkExitReason(pid, taskId) {
  const diagnosticInfo = {};

  // 1. Check dmesg for OOM Killer
  const dmesg = getDmesgInfo();
  if (dmesg) {
    diagnosticInfo.dmesg_snippet = dmesg.split('\n').slice(-10).join('\n'); // Last 10 lines

    // Check for OOM Killer patterns
    if (pid && (dmesg.includes(`killed process ${pid}`) || dmesg.includes('Out of memory'))) {
      return { reason: 'oom_killed', diagnostic_info: diagnosticInfo };
    }

    // Generic OOM patterns (without PID)
    if (dmesg.includes('Out of memory') || dmesg.includes('OOM killer')) {
      return { reason: 'oom_likely', diagnostic_info: diagnosticInfo };
    }
  }

  // 2. Check process log for clues
  const logTail = getProcessLogTail(taskId);
  if (logTail) {
    diagnosticInfo.log_tail = logTail;

    // Check for common error patterns in logs
    if (logTail.includes('SIGKILL') || logTail.includes('Killed')) {
      return { reason: 'killed_signal', diagnostic_info: diagnosticInfo };
    }
    if (logTail.includes('Error:') || logTail.includes('ERROR')) {
      return { reason: 'process_error', diagnostic_info: diagnosticInfo };
    }
    if (logTail.includes('timeout') || logTail.includes('TIMEOUT')) {
      return { reason: 'timeout', diagnostic_info: diagnosticInfo };
    }
  } else {
    diagnosticInfo.log_tail = 'Log file not found or empty';
  }

  // 3. Default: process disappeared with unknown reason
  return { reason: 'process_disappeared', diagnostic_info: diagnosticInfo };
}

// Resource thresholds — dynamic seat scaling based on actual load
const CPU_CORES = os.cpus().length;
const TOTAL_MEM_MB = Math.round(os.totalmem() / 1024 / 1024);
const MEM_PER_TASK_MB = 500;                      // ~500MB avg per claude process (200-850MB observed)
const CPU_PER_TASK = 0.5;                         // ~0.5 core avg per claude process (20-30% bursts, often idle waiting API)
const INTERACTIVE_RESERVE = 2;                    // Reserve 2 seats for user's headed Claude sessions
const USABLE_MEM_MB = TOTAL_MEM_MB * 0.8;        // 80% of total memory is usable (keep 20% headroom)
const USABLE_CPU = CPU_CORES * 0.8;              // 80% of CPU is usable (keep 20% headroom)
// ============================================================
// Dual-Layer Capacity Model (v1.73.0)
// ============================================================
// Layer 1: PHYSICAL_CAPACITY — hardware ceiling (CPU + Memory)
const PHYSICAL_CAPACITY = Math.max(Math.floor(Math.min(USABLE_MEM_MB / MEM_PER_TASK_MB, USABLE_CPU / CPU_PER_TASK)), 2);

// Layer 2: Budget Cap — user-controlled API spend limit (env or runtime API)
const _envBudget = process.env.CECELIA_BUDGET_SLOTS
  ? parseInt(process.env.CECELIA_BUDGET_SLOTS, 10)
  : (process.env.CECELIA_MAX_SEATS ? parseInt(process.env.CECELIA_MAX_SEATS, 10) : null);
let _budgetCap = (_envBudget && _envBudget > 0) ? _envBudget : null;

function getEffectiveMaxSeats() {
  if (_budgetCap && _budgetCap > 0) {
    return Math.min(_budgetCap, PHYSICAL_CAPACITY);
  }
  return PHYSICAL_CAPACITY;
}

// MAX_SEATS: startup snapshot (backward compat for imports)
const MAX_SEATS = getEffectiveMaxSeats();

function getBudgetCap() {
  return { budget: _budgetCap, physical: PHYSICAL_CAPACITY, effective: getEffectiveMaxSeats() };
}

function setBudgetCap(n) {
  if (n === null || n === undefined) { _budgetCap = null; return getBudgetCap(); }
  const val = parseInt(n, 10);
  if (isNaN(val) || val < 1) throw new Error('Budget cap must be a positive integer');
  _budgetCap = val;
  return getBudgetCap();
}

// Auto-dispatch thresholds
const RESERVE_CPU = INTERACTIVE_RESERVE * CPU_PER_TASK;
const RESERVE_MEM_MB = INTERACTIVE_RESERVE * MEM_PER_TASK_MB;
const MEM_AVAILABLE_MIN_MB = TOTAL_MEM_MB * 0.15 + RESERVE_MEM_MB;
const SWAP_USED_MAX_PCT = 70;

// ============================================================
// CPU Sampler — real CPU% from /proc/stat (replaces load average)
// ============================================================
const CPU_THRESHOLD_PCT = 80;
let _prevCpuTimes = null;

function sampleCpuUsage() {
  try {
    const line = readFileSync('/proc/stat', 'utf-8').split('\n')[0];
    const parts = line.split(/\s+/).slice(1).map(Number);
    if (parts.length < 4) return null;
    const idle = parts[3] + (parts[4] || 0);  // idle + iowait
    const total = parts.reduce((a, b) => a + b, 0);
    if (!_prevCpuTimes) { _prevCpuTimes = { idle, total }; return null; }
    const diffIdle = idle - _prevCpuTimes.idle;
    const diffTotal = total - _prevCpuTimes.total;
    _prevCpuTimes = { idle, total };
    if (diffTotal === 0) return 0;
    return Math.round((1 - diffIdle / diffTotal) * 100);
  } catch { return null; }
}

function _resetCpuSampler() { _prevCpuTimes = null; }

/**
 * Resolve repo_path from a project, checking project_repos first, then parent chain.
 * Initiatives (sub-projects) have parent_id but no repo_path — walk up to find it.
 * Max 5 levels to prevent infinite loops.
 */
async function resolveRepoPath(projectId) {
  let currentId = projectId;
  for (let depth = 0; depth < 5 && currentId; depth++) {
    // Check project_repos table first (multi-repo support)
    try {
      const repoResult = await pool.query(
        'SELECT repo_path FROM project_repos WHERE project_id = $1 LIMIT 1',
        [currentId]
      );
      if (repoResult.rows.length > 0) return repoResult.rows[0].repo_path;
    } catch {
      // project_repos table may not exist yet (pre-migration 029)
    }

    // Fallback to projects.repo_path
    const result = await pool.query(
      'SELECT repo_path, parent_id FROM projects WHERE id = $1',
      [currentId]
    );
    if (result.rows.length === 0) return null;
    if (result.rows[0].repo_path) return result.rows[0].repo_path;
    currentId = result.rows[0].parent_id;
  }
  return null;
}

/**
 * Check server resource availability before spawning.
 * Returns { ok, reason, metrics } — ok=false means don't spawn.
 */
function checkServerResources() {
  const loadAvg1 = os.loadavg()[0];
  const freeMem = Math.round(os.freemem() / 1024 / 1024);
  const dynMaxSeats = getEffectiveMaxSeats();

  // Read swap from /proc/meminfo (Linux)
  let swapUsedPct = 0;
  try {
    const meminfo = readFileSync('/proc/meminfo', 'utf-8');
    const swapTotal = parseInt(meminfo.match(/SwapTotal:\s+(\d+)/)?.[1] || '0', 10);
    const swapFree = parseInt(meminfo.match(/SwapFree:\s+(\d+)/)?.[1] || '0', 10);
    if (swapTotal > 0) {
      swapUsedPct = Math.round(((swapTotal - swapFree) / swapTotal) * 100);
    }
  } catch {
    // Not Linux or no /proc — skip swap check
  }

  // CPU pressure from real CPU% (replaces load average)
  const cpuPct = sampleCpuUsage();
  const cpuPressure = cpuPct !== null ? cpuPct / CPU_THRESHOLD_PCT : 0;
  const memPressure = 1 - (freeMem / (TOTAL_MEM_MB * 0.8));
  const swapPressure = swapUsedPct / SWAP_USED_MAX_PCT;
  const maxPressure = Math.max(cpuPressure, Math.max(memPressure, swapPressure));

  // Dynamic seat scaling based on highest pressure
  let effectiveSlots = dynMaxSeats;
  if (maxPressure >= 1.0) {
    effectiveSlots = 0;
  } else if (maxPressure >= 0.9) {
    effectiveSlots = 1;
  } else if (maxPressure >= 0.7) {
    effectiveSlots = Math.max(Math.round(dynMaxSeats / 3), 1);
  } else if (maxPressure >= 0.5) {
    effectiveSlots = Math.max(Math.round(dynMaxSeats * 2 / 3), 1);
  }

  const metrics = {
    load_avg_1m: loadAvg1,
    cpu_usage_pct: cpuPct,
    cpu_threshold_pct: CPU_THRESHOLD_PCT,
    cpu_pressure: Math.round(cpuPressure * 100) / 100,
    free_mem_mb: freeMem,
    mem_min_mb: MEM_AVAILABLE_MIN_MB,
    swap_used_pct: swapUsedPct,
    swap_max_pct: SWAP_USED_MAX_PCT,
    cpu_cores: CPU_CORES,
    total_mem_mb: TOTAL_MEM_MB,
    mem_pressure: Math.round(memPressure * 100) / 100,
    swap_pressure: Math.round(swapPressure * 100) / 100,
    max_pressure: Math.round(maxPressure * 100) / 100,
    physical_capacity: PHYSICAL_CAPACITY,
    budget_cap: _budgetCap,
    max_seats: dynMaxSeats,
    effective_slots: effectiveSlots,
  };

  if (effectiveSlots === 0) {
    const reasons = [];
    if (cpuPressure >= 1.0) reasons.push(`CPU ${cpuPct}% > ${CPU_THRESHOLD_PCT}%`);
    if (freeMem < MEM_AVAILABLE_MIN_MB) reasons.push(`Memory ${freeMem}MB < ${MEM_AVAILABLE_MIN_MB}MB`);
    if (swapUsedPct > SWAP_USED_MAX_PCT) reasons.push(`Swap ${swapUsedPct}% > ${SWAP_USED_MAX_PCT}%`);
    return { ok: false, reason: `Server overloaded: ${reasons.join(', ')}`, effectiveSlots: 0, metrics };
  }

  return { ok: true, reason: null, effectiveSlots, metrics };
}

// ============================================================
// Session 时长追踪（Spending Cap 分析）
// ============================================================

let _sessionStart = null; // 本次 session 开始时间（cap 重置后首次派发）

/**
 * 记录 Session 开始（仅首次，不覆盖）
 * 在首次成功派发任务时调用
 */
function recordSessionStart() {
  if (!_sessionStart) {
    _sessionStart = new Date().toISOString();
    console.log(`[session] Session 开始: ${_sessionStart}`);
  }
}

/**
 * 记录 Session 结束（billing cap 触发时）
 * @param {string} reason - 结束原因（通常为 'billing_cap'）
 * @param {object|null} poolRef - DB pool 引用（可选，用于写 cecelia_events）
 * @returns {{ start, end, duration_min, reason } | null}
 */
async function recordSessionEnd(reason, poolRef = null) {
  if (!_sessionStart) return null;
  const endTime = new Date().toISOString();
  const durationMs = Date.now() - new Date(_sessionStart).getTime();
  const durationMin = Math.round(durationMs / 60000);
  console.log(`[session] Session 结束: 时长 ${durationMin} 分钟, 原因: ${reason}`);
  const record = { start: _sessionStart, end: endTime, duration_min: durationMin, reason };
  // 写入 cecelia_events（可选，如有 pool）
  if (poolRef) {
    try {
      await poolRef.query(
        `INSERT INTO cecelia_events (event_type, payload, created_at) VALUES ('session_end', $1, NOW())`,
        [JSON.stringify(record)]
      );
    } catch (e) {
      console.warn(`[session] 写入 cecelia_events 失败: ${e.message}`);
    }
  }
  _sessionStart = null; // 重置，等待下次 cap 重置后的首次派发
  return record;
}

/**
 * 获取当前 session 信息
 * @returns {{ active: boolean, start?: string, duration_min?: number }}
 */
function getSessionInfo() {
  if (!_sessionStart) return { active: false };
  const durationMin = Math.round((Date.now() - new Date(_sessionStart).getTime()) / 60000);
  return { active: true, start: _sessionStart, duration_min: durationMin };
}

/**
 * 重置 session（测试用）
 */
function _resetSessionStart() {
  _sessionStart = null;
}

// ============================================================
// Billing Pause (全局暂停派发)
// ============================================================

let _billingPause = null; // { resetTime: ISO string, setAt: ISO string, reason: string }

/**
 * 设置 billing pause（全局暂停派发直到 reset 时间）
 * 同时触发 Session 结束记录（fire-and-forget，保持同步签名兼容性）
 * @param {string} resetTimeISO - reset 时间 (ISO 8601)
 * @param {string} reason - 原因描述
 * @param {object|null} poolRef - DB pool 引用（可选，用于写 session_end 事件）
 */
function setBillingPause(resetTimeISO, reason = 'billing_cap', poolRef = null) {
  // 触发 session 结束记录（异步，不阻塞）
  recordSessionEnd(reason, poolRef).catch(e => {
    console.warn(`[session] recordSessionEnd 失败: ${e.message}`);
  });
  _billingPause = {
    resetTime: resetTimeISO,
    setAt: new Date().toISOString(),
    reason,
  };
  console.log(`[executor] Billing pause SET: until ${resetTimeISO} (${reason})`);
}

/**
 * 获取当前 billing pause 状态
 * 如果 pause 已过期（reset 时间已到），自动清除
 * @returns {{ active: boolean, resetTime?: string, setAt?: string, reason?: string }}
 */
function getBillingPause() {
  if (!_billingPause) return { active: false };

  // 自动清除过期的 pause
  if (new Date(_billingPause.resetTime) <= new Date()) {
    console.log(`[executor] Billing pause auto-cleared (reset time reached)`);
    _billingPause = null;
    return { active: false };
  }

  return { active: true, ..._billingPause };
}

/**
 * 手动清除 billing pause
 */
function clearBillingPause() {
  const was = _billingPause;
  _billingPause = null;
  if (was) {
    console.log(`[executor] Billing pause CLEARED manually`);
  }
  return { cleared: !!was, previous: was };
}

/**
 * In-memory process registry: taskId -> { pid, startedAt, runId, process }
 */
const activeProcesses = new Map();

/**
 * Suspect registry: taskId -> { firstSeen, tickCount }
 * Tasks suspected of being dead but not yet confirmed.
 * Double-confirm pattern: mark suspect on first probe failure,
 * auto-fail only if still suspect on next tick.
 */
const suspectProcesses = new Map();

/**
 * Get the number of actively tracked processes (with liveness check)
 * Now also counts ALL claude processes on the system (headed + headless)
 */
function getActiveProcessCount() {
  // Prune dead processes first
  for (const [taskId, entry] of activeProcesses) {
    // Bridge entries without PID — skip pruning (liveness probe handles them)
    if (entry.bridge && !entry.pid) continue;
    if (!isProcessAlive(entry.pid)) {
      console.log(`[executor] Pruning dead process: task=${taskId} pid=${entry.pid}`);
      activeProcesses.delete(taskId);
    }
  }

  // Count ALL claude processes on the system (headed + headless)
  let systemClaudeCount = 0;
  try {
    const result = execSync('pgrep -xc claude 2>/dev/null || echo 0', { encoding: 'utf-8' });
    systemClaudeCount = parseInt(result.trim(), 10) || 0;
  } catch {
    systemClaudeCount = 0;
  }

  // Return the higher of: tracked processes vs system claude count
  const trackedCount = activeProcesses.size;
  const effectiveCount = Math.max(trackedCount, systemClaudeCount);

  if (systemClaudeCount > trackedCount) {
    console.log(`[executor] System has ${systemClaudeCount} claude processes (tracked: ${trackedCount})`);
  }

  return effectiveCount;
}

/**
 * Check if a PID is still alive
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill the process for a specific task
 * @returns {boolean} true if killed
 */
function killProcess(taskId) {
  const entry = activeProcesses.get(taskId);
  if (!entry) return false;

  // Guard: null pid would cause process.kill(0) which sends SIGTERM to own process group
  if (!entry.pid) {
    console.log(`[executor] Skipping kill task=${taskId}: pid is null (bridge-tracked), removing from active`);
    activeProcesses.delete(taskId);
    return false;
  }

  try {
    // Kill the process group (negative PID) to catch child shells
    try {
      process.kill(-entry.pid, 'SIGTERM');
    } catch {
      process.kill(entry.pid, 'SIGTERM');
    }
    console.log(`[executor] Killed process: task=${taskId} pid=${entry.pid}`);
  } catch (err) {
    console.log(`[executor] Process already dead: task=${taskId} pid=${entry.pid} err=${err.message}`);
  }

  activeProcesses.delete(taskId);
  return true;
}

/**
 * Two-stage kill: SIGTERM → wait → SIGKILL → verify death.
 * Uses process group (negative pgid) to kill all children.
 * P2 #8: Verify process is actually dead after SIGKILL.
 *
 * @param {string} taskId - Task ID (for cleanup)
 * @param {number} pgid - Process group ID to kill
 * @param {number} waitMs - Time to wait between SIGTERM and SIGKILL (default 10s)
 * @returns {Promise<{killed: boolean, stage: string}>}
 */
async function killProcessTwoStage(taskId, pgid, waitMs = 10000) {
  if (!pgid) return { killed: false, stage: 'no_pgid' };

  // Stage 1: SIGTERM to process group
  try {
    process.kill(-pgid, 'SIGTERM');
  } catch (err) {
    if (err.code === 'ESRCH') {
      activeProcesses.delete(taskId);
      return { killed: true, stage: 'already_dead' };
    }
    // Negative pgid failed, try direct pid
    try { process.kill(pgid, 'SIGTERM'); } catch { /* ignore */ }
  }

  await new Promise(r => setTimeout(r, waitMs));

  // Stage 2: Check if group leader (pgid as PID) is still alive.
  // process.kill(pgid, 0) sends signal 0 to the single PID = existence check.
  // If leader is dead, the whole group is effectively gone.
  try {
    process.kill(pgid, 0); // throws ESRCH if dead → catch = sigterm was enough
    // Still alive → escalate to SIGKILL on the whole group
    try { process.kill(-pgid, 'SIGKILL'); } catch { try { process.kill(pgid, 'SIGKILL'); } catch { /* */ } }

    // P2 #8: Wait 2s and verify /proc/<pgid> is gone
    await new Promise(r => setTimeout(r, 2000));
    try {
      process.kill(pgid, 0);
      // Still alive after SIGKILL — something is very wrong
      console.error(`[executor] KILL FAILED: pgid=${pgid} task=${taskId} still alive after SIGKILL`);
      return { killed: false, stage: 'kill_failed' };
    } catch {
      activeProcesses.delete(taskId);
      return { killed: true, stage: 'sigkill' };
    }
  } catch {
    // SIGTERM was enough — leader is gone
    activeProcesses.delete(taskId);
    return { killed: true, stage: 'sigterm' };
  }
}

/**
 * Requeue a killed task with exponential backoff.
 * P0 #2: Prevents race conditions with WHERE status='in_progress'.
 * After MAX_WATCHDOG_RETRIES, quarantines the task instead.
 *
 * @param {string} taskId
 * @param {string} reason - Why the task was killed
 * @param {Object} evidence - Watchdog sample data
 * @returns {Promise<{requeued: boolean, quarantined?: boolean, retry_count?: number, next_run_at?: string}>}
 */
async function requeueTask(taskId, reason, evidence = {}) {
  // Kill 1 → retry with backoff; Kill 2 → quarantine
  const QUARANTINE_AFTER_KILLS = 2;

  // P0 #2: Only requeue tasks that are still in_progress (prevents reviving completed/failed tasks)
  const result = await pool.query(
    'SELECT payload, task_type, project_id, title FROM tasks WHERE id = $1 AND status = $2',
    [taskId, 'in_progress']
  );
  if (result.rows.length === 0) {
    return { requeued: false, reason: 'not_in_progress' };
  }

  const { payload: rawPayload, task_type, project_id, title: taskTitle } = result.rows[0];
  const payload = rawPayload || {};
  const retryCount = (payload.watchdog_retry_count || 0) + 1;

  // P0 FIX #3: Watchdog kill 也应增加 failure_count，防止无限循环
  // 原问题：watchdog_retry_count 和 failure_count 分离，交替失败时永远不会隔离
  const failureCount = (payload.failure_count || 0) + 1;

  // P2 #9: Complete evidence chain
  const watchdogInfo = {
    watchdog_retry_count: retryCount,
    failure_count: failureCount,  // P0 FIX: 同时追踪总失败次数
    watchdog_kill: { reason, ts: new Date().toISOString(), ...evidence },
    watchdog_last_sample: evidence,
  };

  if (retryCount >= QUARANTINE_AFTER_KILLS) {
    // Exceeded retry limit → quarantine
    const updateResult = await pool.query(
      `UPDATE tasks SET status = 'quarantined',
       payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
       WHERE id = $1 AND status = 'in_progress'`,
      [taskId, JSON.stringify({
        ...watchdogInfo,
        quarantine_info: {
          quarantined_at: new Date().toISOString(),
          reason: 'resource_hog',
          details: { watchdog_retries: retryCount, kill_reason: reason, total_failures: failureCount },
          previous_status: 'in_progress',
        }
      })]
    );
    if (updateResult.rowCount === 0) {
      return { requeued: false, reason: 'status_changed' };
    }
    return { requeued: false, quarantined: true };
  }

  // Check if failure classification has retry strategy
  const retryStrategy = payload.failure_classification?.retry_strategy;
  let nextRunAt;

  if (retryStrategy && retryStrategy.next_run_at) {
    // Use classified retry strategy (from quarantine.js classifyFailure)
    nextRunAt = retryStrategy.next_run_at;
    console.log(`[executor] Using classified retry strategy: ${retryStrategy.reason || 'unknown'}`);
  } else {
    // Fallback: Exponential backoff (2min for retry 1, max 30min)
    const backoffSec = Math.min(Math.pow(2, retryCount) * 60, 1800);
    nextRunAt = new Date(Date.now() + backoffSec * 1000).toISOString();
    console.log(`[executor] Using default exponential backoff: ${backoffSec}s`);
  }

  // P0 #2: WHERE status='in_progress' prevents reviving already-completed tasks
  const updateResult = await pool.query(
    `UPDATE tasks SET status = 'queued', started_at = NULL,
     payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
     WHERE id = $1 AND status = 'in_progress'`,
    [taskId, JSON.stringify({ ...watchdogInfo, next_run_at: nextRunAt })]
  );

  if (updateResult.rowCount === 0) {
    return { requeued: false, reason: 'status_changed' };
  }

  // Fix: 记录失败到 learnings 表，供 planner buildLearningPenaltyMap 使用
  try {
    await pool.query(`
      INSERT INTO learnings (title, category, trigger_event, content, metadata)
      VALUES ($1, 'failure_pattern', 'watchdog_kill', $2, $3)
    `, [
      `Task Failure: ${taskTitle || taskId} [${reason}]`,
      `Watchdog killed task after ${retryCount} attempts. Reason: ${reason}`,
      JSON.stringify({ task_id: taskId, task_type: task_type || null, project_id: project_id || null }),
    ]);
  } catch (learningErr) {
    console.error(`[executor] Failed to record learning for task ${taskId}:`, learningErr.message);
  }

  return { requeued: true, retry_count: retryCount, next_run_at: nextRunAt };
}

/**
 * Remove a task from activeProcesses (called when execution-callback received)
 */
function removeActiveProcess(taskId) {
  if (activeProcesses.has(taskId)) {
    activeProcesses.delete(taskId);
    console.log(`[executor] Cleaned up activeProcess for task=${taskId}`);
    return true;
  }
  return false;
}

/**
 * Get snapshot of all active processes (for diagnostics)
 */
function getActiveProcesses() {
  const result = [];
  for (const [taskId, entry] of activeProcesses) {
    result.push({
      taskId,
      pid: entry.pid,
      runId: entry.runId,
      startedAt: entry.startedAt,
      alive: isProcessAlive(entry.pid),
    });
  }
  return result;
}

/**
 * Clean up orphan `claude -p /dev` processes not in our registry.
 * Called on startup to handle leftover processes from previous server runs.
 */
function cleanupOrphanProcesses() {
  try {
    // Find all 'claude -p' processes (headless executions)
    const output = execSync(
      "ps -eo pid,ppid,args | grep 'claude -p' | grep -v grep",
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();

    if (!output) {
      console.log('[executor] No orphan claude processes found');
      return 0;
    }

    const lines = output.split('\n');
    const trackedPids = new Set([...activeProcesses.values()].map(e => e.pid).filter(Boolean));
    // Also build set of tracked task IDs for bridge entries
    const trackedTaskIds = new Set(activeProcesses.keys());

    let killed = 0;
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[0], 10);
      const ppid = parseInt(parts[1], 10);
      if (isNaN(pid)) continue;

      // Skip if PID is tracked
      if (trackedPids.has(pid)) continue;

      // Check if parent is a cecelia-run process (has a task_id we're tracking)
      let parentIsTracked = false;
      try {
        assertSafePid(ppid, 'ppid');
        const ppidArgs = execSync(`ps -o args= -p ${ppid} 2>/dev/null`, { encoding: 'utf-8' }).trim();
        if (ppidArgs.includes('cecelia-run')) {
          // Extract task_id from parent cecelia-run args
          const taskMatch = ppidArgs.match(/cecelia-run\s+([0-9a-f-]+)/);
          if (taskMatch && trackedTaskIds.has(taskMatch[1])) {
            parentIsTracked = true;
          }
        }
      } catch { /* parent already dead */ }

      if (!parentIsTracked) {
        try {
          process.kill(pid, 'SIGTERM');
          killed++;
          console.log(`[executor] Killed orphan claude: pid=${pid} ppid=${ppid}`);
        } catch {
          // already dead
        }
      }
    }

    console.log(`[executor] Orphan cleanup: found=${lines.length} killed=${killed} tracked=${trackedPids.size}`);
    return killed;
  } catch (err) {
    console.error('[executor] Orphan cleanup failed:', err.message);
    return 0;
  }
}

/**
 * Ensure prompt directory exists
 */
async function ensurePromptDir() {
  try {
    await mkdir(PROMPT_DIR, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      console.error('[executor] Failed to create prompt dir:', err.message);
    }
  }
}

/**
 * Generate a unique run ID
 */
function generateRunId(taskId) {
  return uuidv4();
}

/**
 * Task Type 权限模型（v2 - 合并 QA + Audit → Review）：
 *
 * | 类型       | Skill    | 权限模式           | 说明                     |
 * |------------|----------|-------------------|--------------------------|
 * | dev        | /dev     | bypassPermissions | 完整代码读写              |
 * | review     | /review  | plan              | 只读代码，输出报告/PRD    |
 * | talk       | /talk    | plan              | 只写文档，不改代码        |
 * | talk       | /talk    | plan              | 对话任务 → HK MiniMax    |
 * | research   | -        | plan              | 完全只读                 |
 *
 * 注意：qa 和 audit 已合并为 review，保留兼容映射
 */

/**
 * Get skill command based on task_type and optional payload
 * 简化版：只有 dev 和 review 两类
 *
 * payload 特判逻辑（优先级高于 taskType 映射）：
 * - payload.decomposition === 'true' (或 true) + task_type === 'dev' → /decomp（OKR 拆解）
 * - payload.decomposition === 'okr' → /decomp（OKR 拆解任务）
 * - payload.next_action === 'decompose' → /decomp （需要继续拆解的任务）
 * - payload.decomposition === 'known' → 保持 taskType 原有路由
 * - 无 payload → 保持 taskType 原有路由（向后兼容）
 */
function getSkillForTaskType(taskType, payload) {
  // payload 特判：decomposition 模式路由（优先级高于 taskType 静态映射）
  if (payload) {
    // decomposition='true' + task_type=dev → /decomp（OKR 拆解，由秋米执行）
    // 注意：decomp-checker 写入的是字符串 'true'，不是布尔值 true
    if ((payload.decomposition === 'true' || payload.decomposition === true) && taskType === 'dev') {
      console.log(`[executor] payload.decomposition 路由: decomposition='true' + task_type=dev → /decomp`);
      return '/decomp';
    }
    // decomposition='okr' → /decomp（OKR 拆解任务）
    if (payload.decomposition === 'okr') {
      console.log(`[executor] payload.decomposition 路由: decomposition=okr → /decomp`);
      return '/decomp';
    }
    // next_action='decompose' → /decomp（继续拆解任务）
    if (payload.next_action === 'decompose') {
      console.log(`[executor] payload.next_action 路由: next_action=decompose → /decomp`);
      return '/decomp';
    }
    // payload.decomposition === 'known' 或其他值 → 继续走 taskType 映射
  }

  const skillMap = {
    'dev': '/dev',           // 写代码：Opus
    'review': '/review',     // 审查：Sonnet，Plan Mode
    'qa_init': '/review init', // QA 初始化：设置 CI 和分支保护
    'talk': '/talk',         // 对话：写文档，不改代码
    'research': null,        // 研究：完全只读
    'dept_heartbeat': '/repo-lead heartbeat', // 部门主管心跳：MiniMax
    'code_review': '/code-review', // 代码审查：Sonnet + /code-review skill
    // 兼容旧类型
    'qa': '/review',
    'audit': '/review',
  };
  return skillMap[taskType] || '/dev';
}

// ============================================================
// 模型常量（三个 Provider 的模型池）
// ============================================================

const MODELS = {
  OPUS: 'claude-opus-4-20250514',
  SONNET: 'claude-sonnet-4-20250514',
  HAIKU: 'claude-haiku-4-5-20251001',
  M25_HIGHSPEED: 'MiniMax-M2.5-highspeed',
  M21: 'MiniMax-M2.1',
  CODEX: 'codex',
};

// Fallback 常量（profile 不可用时使用）
const MODEL_MAP = FALLBACK_PROFILE.config.executor.model_map;
const FIXED_PROVIDER = FALLBACK_PROFILE.config.executor.fixed_provider;

/**
 * Get model for a task based on task type and provider.
 * Profile-aware: 优先读取 active profile 的 model_map。
 */
function getModelForTask(task) {
  const taskType = task.task_type || 'dev';
  const provider = getProviderForTask(task);
  if (taskType === 'codex_qa') return null;

  const profile = getActiveProfile();
  const profileMap = profile?.config?.executor?.model_map;
  const mapping = profileMap?.[taskType] || MODEL_MAP[taskType];
  if (!mapping) return provider === 'minimax' ? MODELS.M25_HIGHSPEED : null;
  return mapping[provider] || null;
}

/**
 * Get provider for a task.
 * Profile-aware: 优先读取 active profile 的 fixed_provider 和 default_provider。
 */
function getProviderForTask(task) {
  const taskType = task.task_type || 'dev';

  const profile = getActiveProfile();
  const profileFixed = profile?.config?.executor?.fixed_provider;
  if (profileFixed?.[taskType]) return profileFixed[taskType];

  const profileDefault = profile?.config?.executor?.default_provider;
  if (profileDefault) return profileDefault;

  if (FIXED_PROVIDER[taskType]) return FIXED_PROVIDER[taskType];
  return 'minimax';
}

/**
 * Get credentials file for a task (universal, works for all providers).
 * 从 active profile 的 model_map 读取 credentials 字段（新），或 minimax_credentials（旧，向后兼容）。
 * 默认返回 null（cecelia-run 使用 provider 默认账户）。
 */
function getCredentialsForTask(task) {
  const taskType = task.task_type || 'dev';
  const profile = getActiveProfile();
  const profileMap = profile?.config?.executor?.model_map;
  return profileMap?.[taskType]?.credentials || profileMap?.[taskType]?.minimax_credentials || null;
}

/**
 * Get permission mode based on task_type
 * plan = 只读/Plan Mode，不能修改文件
 * bypassPermissions = 完全自动化，跳过权限检查
 */
function getPermissionModeForTaskType(taskType) {
  // Plan Mode: 只能读文件，不能执行 Bash，不能写文件
  // Bypass Mode: 完全权限，可以执行 Bash、调 API、写文件
  const modeMap = {
    'dev': 'bypassPermissions',        // 写代码
    'review': 'plan',                  // 只读分析
    'talk': 'bypassPermissions',       // 要调 API 写数据库
    'research': 'bypassPermissions',   // 要调 API
    'code_review': 'bypassPermissions', // 需要写报告文件到 docs/reviews/
    // 兼容旧类型
    'qa': 'plan',
    'audit': 'plan',
  };
  return modeMap[taskType] || 'bypassPermissions';
}

/**
 * 获取特定 task_type 需要注入的额外环境变量。
 * 这些变量会通过 cecelia-bridge → cecelia-run → claude 进程传递，
 * 让 Engine Hook 能识别当前运行的 skill 类型并做相应限制。
 *
 * @param {string} taskType - 任务类型
 * @returns {Object} - key-value 形式的额外环境变量，空对象表示无需注入
 */
function getExtraEnvForTaskType(taskType) {
  if (taskType === 'code_review') {
    // SKILL_CONTEXT=code_review 让 Engine PreToolUse Hook
    // 拦截对非 docs/reviews/ 路径的 Write/Edit 操作，
    // 确保 code-review agent 只能写报告文件，不能修改代码
    return { SKILL_CONTEXT: 'code_review' };
  }
  return {};
}

/**
 * 检查 task_type 与任务标题的匹配合理性
 * warning 级别，不阻塞执行，仅记录到 console.warn
 *
 * @param {object} task - 任务对象，包含 task_type 和 title
 */
function checkTaskTypeMatch(_task) {
  // 此函数保留接口，检查逻辑已移除
}

/**
 * 查询 OKR 拆解的时间上下文（KR 剩余天数、已有 Projects 进度）。
 *
 * @param {string} krId - KR ID
 * @returns {Promise<string>} 格式化的时间上下文文本，注入到 prompt
 */
async function buildTimeContext(krId) {
  if (!krId) return '';
  try {
    // 1. KR 的 target_date 和 time_budget_days
    const krResult = await pool.query(
      `SELECT title, target_date, time_budget_days FROM goals WHERE id = $1`,
      [krId]
    );
    const kr = krResult.rows[0];
    if (!kr) return '';

    // 2. KR 下所有 Projects（按 sequence_order 排列）
    const projResult = await pool.query(
      `SELECT p.id, p.name, p.status, p.sequence_order, p.time_budget_days,
              p.created_at, p.completed_at
       FROM projects p
       JOIN project_kr_links pkl ON pkl.project_id = p.id
       WHERE pkl.kr_id = $1 AND p.type = 'project'
       ORDER BY p.sequence_order ASC NULLS LAST, p.created_at ASC`,
      [krId]
    );
    const projects = projResult.rows;

    const lines = ['## 时间上下文（CRITICAL — 拆解时必须参考）'];

    // KR 剩余天数
    if (kr.target_date) {
      const remaining = Math.ceil((new Date(kr.target_date) - new Date()) / (24 * 60 * 60 * 1000));
      lines.push(`- KR 目标日期: ${kr.target_date}`);
      lines.push(`- KR 剩余天数: ${remaining} 天${remaining < 7 ? '（⚠️ 紧急）' : ''}`);
    }
    if (kr.time_budget_days) {
      lines.push(`- KR 时间预算: ${kr.time_budget_days} 天`);
    }

    // 已有 Projects 进度
    if (projects.length > 0) {
      const completed = projects.filter(p => p.status === 'completed');
      lines.push('');
      lines.push(`### 已有 Projects（${completed.length}/${projects.length} 完成）`);
      for (const p of projects) {
        let info = `- [${p.status}] ${p.name}`;
        if (p.sequence_order != null) info += ` (序号 ${p.sequence_order})`;
        if (p.time_budget_days) info += `, 预算 ${p.time_budget_days} 天`;
        if (p.status === 'completed' && p.created_at && p.completed_at) {
          const actual = Math.max(1, Math.round((new Date(p.completed_at) - new Date(p.created_at)) / (24 * 60 * 60 * 1000)));
          info += `, 实际 ${actual} 天`;
        }
        lines.push(info);
      }
      lines.push('');
      lines.push(`### 顺序提示`);
      lines.push(`这是第 ${completed.length + 1}/${projects.length + 1} 个 Project（包含即将创建的）。`);
      if (completed.length > 0) {
        lines.push(`前 ${completed.length} 个已完成，请参考其执行时间来估算后续 Project 的 time_budget_days。`);
      }
    }

    lines.push('');
    lines.push('### 约束');
    lines.push('- 请为每个 Project 标注 `sequence_order`（执行顺序，从 1 开始）');
    lines.push('- 请为每个 Project 设置 `time_budget_days`（预计天数）');
    lines.push('- 所有 Project 的 time_budget_days 之和不应超过 KR 剩余天数');

    return lines.join('\n');
  } catch (err) {
    console.error('[executor] buildTimeContext failed (non-fatal):', err.message);
    return '';
  }
}

/**
 * Prepare prompt content from task
 * Routes to different skills based on task.task_type
 */
async function preparePrompt(task) {
  const taskType = task.task_type || 'dev';
  const skill = task.payload?.skill_override ?? getSkillForTaskType(taskType, task.payload);

  // OKR 拆解任务：秋米用 /decomp skill + Opus
  // decomposition = 'true' (首次拆解) 或 'continue' (继续拆解)
  const decomposition = task.payload?.decomposition;
  if (decomposition === 'true' || decomposition === 'continue') {
    const krId = task.goal_id || task.payload?.kr_id || '';
    const krTitle = task.title?.replace(/^(OKR 拆解|拆解|继续拆解)[：:]\s*/, '') || '';
    const projectId = task.project_id || task.payload?.project_id || '';
    const isContinue = decomposition === 'continue';
    const previousResult = task.payload?.previous_result || '';
    const initiativeId = task.payload?.initiative_id || task.payload?.feature_id || '';

    // 继续拆解：秋米收到前一个 Task 的执行结果，决定下一步
    if (isContinue && initiativeId) {
      return `/decomp

# 继续拆解: ${krTitle}

## 任务类型
探索型任务继续拆解

## Initiative ID
${initiativeId}

## 前一个 Task 执行结果
${previousResult}

## KR 目标
${task.payload?.kr_goal || task.description || ''}

## 你的任务
1. 分析前一个 Task 的执行结果
2. 判断 Initiative 是否已完成 KR 目标
   - 如果已完成 → 更新 Initiative 状态，不创建新 Task
   - 如果未完成 → 创建下一个 Task，继续推进

## 创建下一个 Task（如需要）
POST /api/brain/action/create-task
{
  "title": "下一步任务标题",
  "project_id": "${initiativeId}",
  "goal_id": "${krId}",
  "task_type": "dev",
  "prd_content": "完整 PRD...",
  "payload": {
    "initiative_id": "${initiativeId}",
    "kr_goal": "${task.payload?.kr_goal || ''}"
  }
}`;
    }

    // Initiative 级别补充拆解：给空 Initiative 创建 Task（由 decomp-checker Check 6 触发）
    if (!isContinue && initiativeId) {
      return `/decomp

# Initiative 补充拆解: ${krTitle}

## 任务类型
为已有 Initiative 创建可执行 Task

## Initiative 信息
- Initiative ID: ${initiativeId}
- KR ID: ${krId}
- Project ID: ${projectId}
- 目标: ${task.description || krTitle}

## 你的任务
这个 Initiative 下缺少可执行的 Task。请为其创建 1-3 个具体、可执行的 Task。

### 创建 Task
POST /api/brain/action/create-task
{
  "title": "实现 [功能]",
  "project_id": "${initiativeId}",
  "goal_id": "${krId}",
  "task_type": "dev",
  "prd_content": "完整 PRD（目标、方案、验收标准）",
  "payload": {
    "initiative_id": "${initiativeId}",
    "kr_goal": "${task.description || ''}"
  }
}

## ⛔ 禁止
- ❌ 不要创建新的 Initiative 或 Project（已经有了）
- ❌ Task 的 project_id 必须指向 Initiative ID: ${initiativeId}
- ❌ Task 的 goal_id 必须 = KR ID: ${krId}`;
    }

    // 首次拆解：秋米需要创建 KR 专属 Project + Initiative + Task
    const timeContext = await buildTimeContext(krId);
    return `/decomp

# OKR 拆解: ${krTitle}

## KR 信息
- KR ID: ${krId}
- 目标: ${task.description || krTitle}

${timeContext}

## 6 层架构（必须严格遵守）
Global OKR (季度) → Area OKR (月度) → KR → **Project (1-2周)** → Initiative (1-2小时) → Task (PR)

## 你的任务（按顺序执行）

### Step 1: 为该 KR 新建专属 Project（⛔ 禁止复用已有 project！）

**CRITICAL**: 每个 KR 必须有自己独立的 Project，不能复用 cecelia-core 或其他已有 project。

首先查询 cecelia-core 的 repo_path：
\`\`\`
GET /api/tasks/projects
找到 name='cecelia-core' 的记录，记录其 repo_path
\`\`\`

然后新建 KR 专属 Project：
\`\`\`
POST /api/brain/projects
{
  "name": "<KR 简短标题> 实现",
  "type": "project",
  "description": "${task.description || krTitle}",
  "repo_path": "<从 cecelia-core 获取的 repo_path>"
}
\`\`\`

最后通过 project_kr_links 绑定到该 KR：
\`\`\`
POST /api/brain/project-kr-links
{
  "project_id": "<新建 Project 的 ID>",
  "kr_id": "${krId}"
}
\`\`\`

记录新建 Project 的 ID（后面 Step 2 要用）。

### Step 2: 拆解模式
- 使用 known 模式，直接拆解为 dev 任务

### Step 3: 创建 Initiatives（写入 projects 表，type='initiative'，不是 goals 表！）

Initiative 的 parent_id 必须指向 Step 1 新建的 KR 专属 Project ID。

\`\`\`
POST /api/brain/action/create-initiative
{
  "name": "Initiative 名称",
  "parent_id": "<Step 1 新建的 Project ID>",
  "kr_id": "${krId}",
  "decomposition_mode": "known"
}
\`\`\`

### Step 4: 创建 Tasks（goal_id 必须 = KR ID）

\`\`\`
POST /api/brain/action/create-task
{
  "title": "实现 [功能]",
  "project_id": "<Initiative ID>",
  "goal_id": "${krId}",
  "task_type": "dev",
  "prd_content": "完整 PRD（目标、方案、验收标准）",
  "payload": {
    "initiative_id": "<Initiative ID>",
    "kr_goal": "${task.description || ''}"
  }
}
\`\`\`

### Step 5: 更新 KR 状态
\`\`\`
PUT /api/tasks/goals/${krId}
{"status": "in_progress"}
\`\`\`

## ⛔ 绝对禁止
- ❌ 不能复用已有 project（cecelia-core 或其他）作为 Initiative 的 parent！
- ❌ 不能在 goals 表创建 KR 以下的记录！goals 表只存 Global OKR / Area OKR / KR
- ❌ 不能把 Task.project_id 指向 Project，必须指向 Initiative！
- ❌ Task 的 goal_id 不能为空或指向错误的 KR！

## 质量验证（创建完成后逐项检查）

1. ✅ 新建了 KR 专属 Project（type='project'，有 repo_path）
2. ✅ project_kr_links 已绑定新 Project → 当前 KR
3. ✅ Initiatives 的 parent_id = 新建 Project（不是 cecelia-core）
4. ✅ 第一个 Task 的 task_type='dev'
5. ✅ 所有 Task 的 goal_id = ${krId}
6. ✅ 所有 Task 的 project_id 指向 Initiative（不是 Project）

参考：~/.claude/skills/okr/SKILL.md Stage 2 (Line 332-408)`;
  }

  // Talk 类型：可以写文档（日报、总结等），但不能改代码
  if (taskType === 'talk') {
    return `请完成以下任务，你可以创建/编辑 markdown 文档，但不能修改任何代码文件：

# ${task.title}

${task.description || ''}

权限约束：
- ✅ 可以创建/编辑 .md 文件（日报、总结、文档）
- ✅ 可以读取代码和日志
- ❌ 不能修改 .js/.ts/.py/.go 等代码文件
- ❌ 不能修改配置文件

输出要求：
- 将结果写入适当的 markdown 文件`;
  }

  // Review 类型：Plan Mode，统一代码审查（合并 QA + Audit）
  if (taskType === 'review' || taskType === 'qa' || taskType === 'audit') {
    return `/review

# 代码审查任务 - ${task.title}

${task.description || ''}

你是代码审查员，请以 Plan Mode 运行：
1. 只读取和分析代码，不要修改任何文件
2. 从 QA 视角检查测试覆盖、回归契约、风险评估
3. 从 Audit 视角检查代码问题（L1阻塞/L2功能/L3最佳实践）
4. 输出 REVIEW-REPORT.md 报告
5. 如果发现需要修复的 L1/L2 问题，在报告中附带 PRD

权限约束：
- ✅ 可以读取所有代码和文档
- ✅ 输出 REVIEW-REPORT.md
- ❌ 不能修改任何代码文件
- ❌ 不能直接修复问题（输出 PRD 让 /dev 去修）`;
  }

  // Research 类型：完全只读
  if (taskType === 'research') {
    return `请调研以下内容，只读取和分析，不要修改任何文件：

# ${task.title}

${task.description || ''}

权限约束：
- ✅ 可以读取代码/文档/日志
- ✅ 输出调研结果和建议
- ❌ 不能创建、修改或删除任何文件`;
  }

  // code_review 类型：传入 repo_path 给 /code-review skill
  if (taskType === 'code_review') {
    const repoPath = task.payload?.repo_path || '';
    const since = task.payload?.since_hours ? `--since=${task.payload.since_hours}h` : '';
    const repoArg = repoPath ? `${repoPath}` : '';
    return `/code-review ${repoArg} ${since}`.trim();
  }

  // 有明确 PRD 内容的任务
  if (task.prd_content) {
    return `${skill}\n\n${task.prd_content}`;
  }
  if (task.payload?.prd_content) {
    return `${skill}\n\n${task.payload.prd_content}`;
  }
  if (task.payload?.prd_path) {
    return `${skill} ${task.payload.prd_path}`;
  }

  // 自动生成 PRD
  const prd = `# PRD - ${task.title}

## 背景
任务来自 Brain 自动调度。
任务类型：${taskType}

## 功能描述
${task.description || task.title}

## 成功标准
- [ ] 任务完成
`;

  return `${skill}\n\n${prd}`;
}

/**
 * Update task with run information
 */
async function updateTaskRunInfo(taskId, runId, status = 'triggered') {
  try {
    await pool.query(`
      UPDATE tasks
      SET
        payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
          'current_run_id', $2::text,
          'run_status', $3::text,
          'run_triggered_at', NOW()
        )
      WHERE id = $1
    `, [taskId, runId, status]);

    return { success: true };
  } catch (err) {
    console.error('[executor] Failed to update task run info:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Trigger HK MiniMax executor for a task
 * @param {Object} task - The task object from database
 * @returns {Object} - { success, taskId, result?, error? }
 */
async function triggerMiniMaxExecutor(task) {
  const runId = generateRunId(task.id);

  try {
    console.log(`[executor] Calling HK MiniMax for task=${task.id} type=${task.task_type}`);

    const response = await fetch(`${HK_MINIMAX_URL}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: task.id,
        title: task.title,
        description: task.description,
        task_type: task.task_type,
      }),
      signal: AbortSignal.timeout(120000), // 2 minute timeout
    });

    const result = await response.json();

    if (result.success) {
      console.log(`[executor] MiniMax completed task=${task.id}`);

      // Update task with result (with WebSocket broadcast)
      await updateTaskStatus(task.id, 'completed', {
        payload: {
          minimax_result: result.result,
          minimax_usage: result.usage || {},
          run_id: runId
        }
      });

      return {
        success: true,
        taskId: task.id,
        runId,
        result: result.result,
        usage: result.usage,
        executor: 'minimax',
      };
    } else {
      console.log(`[executor] MiniMax failed task=${task.id}: ${result.error}`);
      return {
        success: false,
        taskId: task.id,
        error: result.error,
        executor: 'minimax',
      };
    }
  } catch (err) {
    console.error(`[executor] MiniMax error: ${err.message}`);
    return {
      success: false,
      taskId: task.id,
      error: err.message,
      executor: 'minimax',
    };
  }
}

/**
 * Trigger cecelia-run for a task.
 *
 * v2: Uses spawn() for PID tracking + task-level dedup.
 * v3: Routes to HK MiniMax for talk/research/data tasks.
 *
 * @param {Object} task - The task object from database
 * @returns {Object} - { success, runId, taskId, error?, reason? }
 */
async function triggerCeceliaRun(task) {
  // Check if task should go to HK MiniMax
  const location = getTaskLocation(task.task_type);
  if (location === 'hk') {
    return triggerMiniMaxExecutor(task);
  }
  // Use original cecelia-bridge on port 3457
  const EXECUTOR_BRIDGE_URL = process.env.EXECUTOR_BRIDGE_URL || 'http://localhost:3457';

  // Generate run_id early (Hard Boundary #1: L0 generates run_id)
  const runId = generateRunId(task.id);

  // Create trace step for this execution (v1.1.1 observability)
  const trace = traceStep({
    taskId: task.id,
    runId,
    layer: LAYER.L0_ORCHESTRATOR,
    stepName: 'trigger_cecelia_run',
    executorHost: EXECUTOR_HOSTS.US_VPS,
    agent: task.task_type || 'dev',
    region: 'us',
    inputSummary: {
      task_type: task.task_type,
      task_title: task.title,
    },
  });

  try {
    // Start trace
    await trace.start();

    // === DEDUP CHECK ===
    const existing = activeProcesses.get(task.id);
    if (existing && isProcessAlive(existing.pid)) {
      console.log(`[executor] Task ${task.id} already running (pid=${existing.pid}), skipping`);
      await trace.end({
        status: STATUS.FAILED,
        error: new Error('Task already running'),
      });
      return {
        success: false,
        taskId: task.id,
        reason: 'already_running',
        existingPid: existing.pid,
        existingRunId: existing.runId,
      };
    }
    // Clean stale entry if process is dead
    if (existing) {
      activeProcesses.delete(task.id);
    }

    // === RESOURCE CHECK ===
    const resources = checkServerResources();
    if (!resources.ok) {
      console.log(`[executor] Server overloaded, refusing to spawn: ${resources.reason}`);
      await trace.end({
        status: STATUS.FAILED,
        error: new Error(`Server overloaded: ${resources.reason}`),
      });
      return {
        success: false,
        taskId: task.id,
        reason: 'server_overloaded',
        detail: resources.reason,
        metrics: resources.metrics,
      };
    }
    const checkpointId = `cp-${task.id.slice(0, 8)}`;

    // 检查 task_type 合理性（warning 级别，不阻塞执行）
    checkTaskTypeMatch(task);

    // Prepare prompt content, permission mode, extra env, and model based on task_type
    const taskType = task.task_type || 'dev';
    const promptContent = await preparePrompt(task);
    const permissionMode = getPermissionModeForTaskType(taskType);
    const extraEnv = getExtraEnvForTaskType(taskType);
    const model = getModelForTask(task);

    // Update task with run info before execution
    await updateTaskRunInfo(task.id, runId, 'triggered');

    // Resolve repo_path from task's project (traverse parent chain for Features)
    let repoPath = null;
    if (task.project_id) {
      try {
        repoPath = await resolveRepoPath(task.project_id);
      } catch { /* ignore */ }
    }
    // Fallback: dept_heartbeat (and any task with payload.repo_path) uses payload directly
    if (!repoPath && task.payload?.repo_path) {
      repoPath = task.payload.repo_path;
    }

    // Get provider (minimax = 1/12 cost via api.minimaxi.com)
    const provider = getProviderForTask(task);

    // Get credentials file for the task (universal, works for all providers)
    const credentials = getCredentialsForTask(task);
    if (credentials) {
      extraEnv.CECELIA_CREDENTIALS = credentials;
    }

    // Call original cecelia-bridge via HTTP (POST /trigger-cecelia)
    const extraEnvKeys = Object.keys(extraEnv);
    console.log(`[executor] Calling cecelia-bridge for task=${task.id} type=${taskType} mode=${permissionMode}${model ? ` model=${model}` : ''}${provider ? ` provider=${provider}` : ''}${repoPath ? ` repo=${repoPath}` : ''}${extraEnvKeys.length ? ` extra_env=[${extraEnvKeys.join(',')}]` : ''}`);

    const response = await fetch(`${EXECUTOR_BRIDGE_URL}/trigger-cecelia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: task.id,
        checkpoint_id: checkpointId,
        prompt: promptContent,
        task_type: taskType,
        permission_mode: permissionMode,
        repo_path: repoPath,
        model: model,
        provider: provider,
        extra_env: extraEnvKeys.length ? extraEnv : undefined
      })
    });

    const result = await response.json();

    if (!result.ok) {
      console.log(`[executor] Bridge rejected: ${result.error}`);
      return {
        success: false,
        taskId: task.id,
        reason: 'bridge_error',
        error: result.error
      };
    }

    // Original bridge doesn't return PID, but we track by task_id
    activeProcesses.set(task.id, {
      pid: null, // Bridge doesn't return PID
      startedAt: new Date().toISOString(),
      runId,
      checkpointId,
      bridge: true
    });

    console.log(`[executor] Bridge dispatched task=${task.id} checkpoint=${checkpointId}`);

    // Trace: success
    await trace.end({
      status: STATUS.SUCCESS,
      outputSummary: {
        checkpoint_id: checkpointId,
        log_file: result.log_file,
      },
    });

    // 记录 session 开始（仅首次派发时，用于 spending cap 时长分析）
    recordSessionStart();

    return {
      success: true,
      runId,
      taskId: task.id,
      checkpointId,
      logFile: result.log_file,
      bridge: true
    };

  } catch (err) {
    console.error(`[executor] Error triggering via bridge: ${err.message}`);

    // Trace: failure
    await trace.end({
      status: STATUS.FAILED,
      error: err,
    });

    return {
      success: false,
      taskId: task.id,
      error: err.message,
    };
  }
}

/**
 * Check if cecelia-run is available (via cecelia-bridge on port 3457)
 */
async function checkCeceliaRunAvailable() {
  const EXECUTOR_BRIDGE_URL = process.env.EXECUTOR_BRIDGE_URL || 'http://localhost:3457';
  try {
    // Original bridge doesn't have /health, just check if it responds
    const response = await fetch(`${EXECUTOR_BRIDGE_URL}/`, { method: 'GET', signal: AbortSignal.timeout(3000) });
    // 404 means bridge is running (no GET handler)
    return { available: true, path: EXECUTOR_BRIDGE_URL, bridge: true };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { available: false, path: EXECUTOR_BRIDGE_URL, error: 'Timeout' };
    }
    // Connection refused means not running
    if (err.cause?.code === 'ECONNREFUSED') {
      return { available: false, path: EXECUTOR_BRIDGE_URL, error: 'Bridge not running' };
    }
    // Other errors might mean it's running but returned error
    return { available: true, path: EXECUTOR_BRIDGE_URL, bridge: true };
  }
}

/**
 * Get execution status for a task
 */
async function getTaskExecutionStatus(taskId) {
  try {
    const result = await pool.query(`
      SELECT
        payload->'current_run_id' as run_id,
        payload->'run_status' as run_status,
        payload->'run_triggered_at' as triggered_at,
        payload->'last_run_result' as last_result
      FROM tasks
      WHERE id = $1
    `, [taskId]);

    if (result.rows.length === 0) {
      return { found: false };
    }

    // Augment with live process info
    const processInfo = activeProcesses.get(taskId);
    return {
      found: true,
      ...result.rows[0],
      process_alive: processInfo ? isProcessAlive(processInfo.pid) : false,
      process_pid: processInfo?.pid || null,
    };
  } catch (err) {
    return { found: false, error: err.message };
  }
}

/**
 * Check if a cecelia-run process exists for a given run_id.
 * Searches system processes for the run_id string in command line.
 * Works for bridge-dispatched tasks where pid=null.
 *
 * @param {string} runId - The run ID to search for
 * @returns {boolean} - true if a matching process is found
 */
function isRunIdProcessAlive(runId) {
  if (!runId) return false;
  assertSafeId(runId, 'runId');
  try {
    const output = execSync(
      `ps aux | grep -F "${runId}" | grep -v grep | wc -l`,
      { encoding: 'utf-8', timeout: 3000 }
    ).trim();
    return parseInt(output, 10) > 0;
  } catch {
    return false;
  }
}

/**
 * Check if a cecelia-run process exists for a given task_id.
 * More reliable than isRunIdProcessAlive because task_id IS in the
 * cecelia-run command line (as 1st argument), while runId is NOT.
 */
function isTaskProcessAlive(taskId) {
  if (!taskId) return false;
  assertSafeId(taskId, 'taskId');
  try {
    const output = execSync(
      `ps aux | grep -F "${taskId}" | grep -v grep | wc -l`,
      { encoding: 'utf-8', timeout: 3000 }
    ).trim();
    return parseInt(output, 10) > 0;
  } catch {
    return false;
  }
}

/**
 * Probe liveness of all in_progress tasks.
 * Called on each tick to detect dead processes early.
 *
 * For each in_progress task in DB:
 * - If tracked with PID → check kill -0
 * - If tracked with bridge (pid=null) → check run_id in system processes
 * - If not tracked → mark as suspect (process may have died before registration)
 *
 * Uses double-confirm pattern:
 * - 1st probe failure → mark suspect (suspectProcesses map)
 * - 2nd probe failure (next tick) → auto-fail the task
 *
 * @returns {Object[]} - Actions taken (auto-fail entries)
 */
async function probeTaskLiveness() {
  const actions = [];

  // Get all in_progress tasks from DB
  const result = await pool.query(`
    SELECT id, title, payload, started_at
    FROM tasks
    WHERE status = 'in_progress'
  `);

  for (const task of result.rows) {
    const runId = task.payload?.current_run_id;
    const entry = activeProcesses.get(task.id);

    let isAlive = false;

    if (entry) {
      // Tracked process — check by PID or task_id in system processes
      if (entry.pid) {
        isAlive = isProcessAlive(entry.pid);
      } else if (entry.bridge) {
        // Bridge tasks: check by task_id in system processes (cecelia-run <task_id> ...)
        isAlive = isTaskProcessAlive(task.id);
      } else {
        isAlive = true;
      }
    } else if (runId) {
      // Not tracked in memory — check by task_id first, then run_id
      isAlive = isTaskProcessAlive(task.id) || isRunIdProcessAlive(runId);
    } else {
      // No tracking info at all — check if recently dispatched (grace period)
      const triggeredAt = task.payload?.run_triggered_at || task.started_at;
      if (triggeredAt) {
        const elapsed = (Date.now() - new Date(triggeredAt).getTime()) / 1000;
        // Grace period: 60 seconds after dispatch to allow process to start
        isAlive = elapsed < 60;
      }
    }

    if (isAlive) {
      // Process is alive — clear any suspect status
      if (suspectProcesses.has(task.id)) {
        console.log(`[liveness] Task ${task.id} recovered from suspect status`);
        suspectProcesses.delete(task.id);
      }
      continue;
    }

    // Decomposition tasks (/decomp) run for 3-10 minutes — apply extended grace period
    // to avoid false-positive failures before the process fully starts or completes
    const DECOMP_LIVENESS_GRACE_MINUTES = 60;
    if (task.payload?.decomposition === 'true') {
      const triggeredAt = task.payload?.run_triggered_at || task.started_at;
      if (triggeredAt) {
        const elapsedMin = (Date.now() - new Date(triggeredAt).getTime()) / (1000 * 60);
        if (elapsedMin < DECOMP_LIVENESS_GRACE_MINUTES) {
          continue; // Still within grace period — don't mark as dead
        }
      }
    }

    // Process appears dead — apply double-confirm
    const suspect = suspectProcesses.get(task.id);
    if (!suspect) {
      // First probe failure — mark as suspect
      suspectProcesses.set(task.id, {
        firstSeen: new Date().toISOString(),
        tickCount: 1
      });
      console.log(`[liveness] Task ${task.id} marked as SUSPECT (first probe failure)`);
      continue;
    }

    // Second (or later) probe failure — confirmed dead
    console.log(`[liveness] Task ${task.id} confirmed DEAD (suspect since ${suspect.firstSeen})`);
    suspectProcesses.delete(task.id);

    // Clean up activeProcesses entry
    if (entry) {
      activeProcesses.delete(task.id);
    }

    // Auto-fail the task with enhanced diagnostics
    const pid = entry?.pid || null;
    const { reason, diagnostic_info } = await checkExitReason(pid, task.id);

    const errorDetails = {
      type: 'liveness_probe_failed',
      reason: reason, // oom_killed / oom_likely / killed_signal / timeout / process_disappeared
      message: `Process not found after double-confirm probe (suspect since ${suspect.firstSeen})`,
      first_suspect_at: suspect.firstSeen,
      probe_ticks: suspect.tickCount + 1,
      last_seen: new Date().toISOString(),
      pid: pid,
      diagnostic_info: diagnostic_info,
    };

    // Update task status with WebSocket broadcast
    await updateTaskStatus(task.id, 'failed', {
      payload: { error_details: errorDetails }
    });

    actions.push({
      action: 'liveness_auto_fail',
      task_id: task.id,
      title: task.title,
      suspect_since: suspect.firstSeen,
    });
  }

  return actions;
}

/**
 * Synchronize DB state with actual processes on Brain startup.
 * Finds all in_progress tasks and checks if they have matching processes.
 * Tasks without processes are marked as failed (orphan_detected).
 *
 * @returns {Object} - { orphans_found, orphans_fixed, rebuilt }
 */
async function syncOrphanTasksOnStartup() {
  const result = await pool.query(`
    SELECT id, title, payload, started_at
    FROM tasks
    WHERE status = 'in_progress'
  `);

  let orphansFound = 0;
  let orphansFixed = 0;
  let rebuilt = 0;

  for (const task of result.rows) {
    const runId = task.payload?.current_run_id;

    // Check if process exists (task_id is in cecelia-run command line)
    let processExists = isTaskProcessAlive(task.id);
    if (!processExists && runId) {
      processExists = isRunIdProcessAlive(runId);
    }

    if (processExists) {
      // Process exists but not in activeProcesses (Brain restarted)
      // Rebuild the activeProcesses entry
      if (!activeProcesses.has(task.id)) {
        activeProcesses.set(task.id, {
          pid: null,
          startedAt: task.started_at || new Date().toISOString(),
          runId: runId,
          bridge: true,
        });
        rebuilt++;
        console.log(`[startup-sync] Rebuilt activeProcess for task=${task.id} runId=${runId}`);
      }
    } else {
      // No matching process — this is an orphan
      orphansFound++;

      // Enhanced diagnostics for orphaned tasks
      const { reason, diagnostic_info } = await checkExitReason(null, task.id);

      const errorDetails = {
        type: 'orphan_detected',
        reason: reason, // oom_killed / oom_likely / killed_signal / timeout / process_disappeared
        message: 'Task was in_progress but no matching process found on Brain startup',
        detected_at: new Date().toISOString(),
        run_id: runId || null,
        diagnostic_info: diagnostic_info,
      };

      await pool.query(
        `UPDATE tasks SET
          status = 'failed',
          payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
        WHERE id = $1`,
        [task.id, JSON.stringify({ error_details: errorDetails })]
      );

      orphansFixed++;
      console.log(`[startup-sync] Orphan fixed: task=${task.id} title="${task.title}" reason=${reason}`);
    }
  }

  console.log(`[startup-sync] Complete: orphans_found=${orphansFound} orphans_fixed=${orphansFixed} rebuilt=${rebuilt}`);
  return { orphans_found: orphansFound, orphans_fixed: orphansFixed, rebuilt };
}

/**
 * Record a heartbeat for a running task.
 * Updates last_heartbeat in the task's payload.
 *
 * @param {string} taskId - Task ID
 * @param {string} runId - Run ID (for validation)
 * @returns {Object} - { success, message }
 */
async function recordHeartbeat(taskId, runId) {
  const result = await pool.query(
    `UPDATE tasks SET
      payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
        'last_heartbeat', $2::text
      )
    WHERE id = $1 AND status = 'in_progress'
    RETURNING id`,
    [taskId, new Date().toISOString()]
  );

  if (result.rowCount === 0) {
    return { success: false, message: 'Task not found or not in_progress' };
  }

  return { success: true, message: 'Heartbeat recorded' };
}

export {
  triggerCeceliaRun,
  triggerMiniMaxExecutor,
  checkCeceliaRunAvailable,
  getTaskExecutionStatus,
  updateTaskRunInfo,
  preparePrompt,
  buildTimeContext,
  generateRunId,
  getSkillForTaskType,
  // v2 additions
  getActiveProcessCount,
  getActiveProcesses,
  killProcess,
  cleanupOrphanProcesses,
  isProcessAlive,
  checkServerResources,
  removeActiveProcess,
  // v3 additions
  HK_MINIMAX_URL,
  // v4: State drift elimination
  probeTaskLiveness,
  syncOrphanTasksOnStartup,
  recordHeartbeat,
  isRunIdProcessAlive,
  isTaskProcessAlive,
  suspectProcesses,
  MAX_SEATS,
  INTERACTIVE_RESERVE,
  // v5: Watchdog integration
  killProcessTwoStage,
  requeueTask,
  // v6: Feature repo_path resolution
  resolveRepoPath,
  // v7: Billing pause
  setBillingPause,
  getBillingPause,
  clearBillingPause,
  // v9: Task type matching validation
  checkTaskTypeMatch,
  // v10: Session tracking + provider
  getProviderForTask,
  // v11: Unified model routing
  getModelForTask,
  // v12: Multi-account credentials
  getCredentialsForTask,
  MODELS,
  MODEL_MAP,
  FIXED_PROVIDER,
  recordSessionStart,
  recordSessionEnd,
  getSessionInfo,
  _resetSessionStart,
  // v12: Dual-layer capacity model
  PHYSICAL_CAPACITY,
  CPU_THRESHOLD_PCT,
  getEffectiveMaxSeats,
  getBudgetCap,
  setBudgetCap,
  sampleCpuUsage,
  _resetCpuSampler,
  // v13: code-review env isolation
  getExtraEnvForTaskType,
  // v14: Input validation for shell commands
  assertSafeId,
  assertSafePid,
};
