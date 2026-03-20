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
import crypto from 'crypto';
import { spawn, execSync } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import { readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import pool from './db.js';
import { buildLearningContext } from './learning-retriever.js';
import { getDecisionsSummary } from './decisions-context.js';
import { getActiveProfile, FALLBACK_PROFILE, getCascadeForTask } from './model-profile.js';
import { getTaskLocation } from './task-router.js';
import { updateTaskStatus, updateTaskProgress } from './task-updater.js';
import { traceStep, LAYER, STATUS, EXECUTOR_HOSTS } from './trace.js';
import { selectBestAccount, getAccountUsage } from './account-usage.js';
import {
  sampleCpuUsage as platformSampleCpuUsage,
  _resetCpuSampler as platformResetCpuSampler,
  getSwapUsedPct,
  getDmesgInfo as platformGetDmesgInfo,
  countClaudeProcesses,
  calculatePhysicalCapacity,
  IS_DARWIN,
} from './platform-utils.js';

/**
 * Get macOS memory pressure level via sysctl vm.memory_pressure.
 * Inlined from platform-utils to avoid vitest mock interference in tests.
 * Returns 0/1/2/3 or -1 on error.
 * @returns {number}
 */
function getMacOSMemoryPressure() {
  if (process.platform !== 'darwin') return -1;
  try {
    const output = execSync('sysctl vm.memory_pressure', {
      encoding: 'utf-8',
      timeout: 2000,
    }).trim();
    const match = output.match(/vm\.memory_pressure:\s*(\d+)/);
    if (match) {
      const level = parseInt(match[1], 10);
      return [0, 1, 2, 3].includes(level) ? level : -1;
    }
    return -1;
  } catch {
    return -1;
  }
}

/**
 * Get available memory in MB — platform-aware.
 * Inlined from platform-utils to avoid vitest mock interference in tests.
 * @returns {number} Available memory in MB
 */
function getAvailableMemoryMB() {
  if (process.platform === 'darwin') {
    try {
      const output = execSync('vm_stat', { encoding: 'utf-8', timeout: 2000 });
      const pageSizeMatch = output.match(/page size of (\d+) bytes/);
      const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1], 10) : 16384;
      const activeMatch = output.match(/Pages active:\s+(\d+)/);
      const wiredMatch = output.match(/Pages wired down:\s+(\d+)/);
      const freeMatch = output.match(/Pages free:\s+(\d+)/);
      const inactiveMatch = output.match(/Pages inactive:\s+(\d+)/);
      const speculativeMatch = output.match(/Pages speculative:\s+(\d+)/);
      const activePages = activeMatch ? parseInt(activeMatch[1], 10) : 0;
      const wiredPages = wiredMatch ? parseInt(wiredMatch[1], 10) : 0;
      const freePages = freeMatch ? parseInt(freeMatch[1], 10) : 0;
      const inactivePages = inactiveMatch ? parseInt(inactiveMatch[1], 10) : 0;
      const speculativePages = speculativeMatch ? parseInt(speculativeMatch[1], 10) : 0;
      const totalPages = activePages + wiredPages + freePages + inactivePages + speculativePages;
      if (totalPages === 0) return Math.round(os.freemem() / 1024 / 1024);
      const usedPages = activePages + wiredPages;
      const used_ratio = usedPages / totalPages;
      return Math.round((1 - used_ratio) * totalPages * pageSize / 1024 / 1024);
    } catch {
      return Math.round(os.freemem() / 1024 / 1024);
    }
  }
  return Math.round(os.freemem() / 1024 / 1024);
}

// HK MiniMax Executor URL (via Tailscale)
const HK_MINIMAX_URL = process.env.HK_MINIMAX_URL || 'http://100.86.118.99:5226';

// 西安 Mac mini Codex Bridge URL (via Tailscale)
const XIAN_CODEX_BRIDGE_URL = process.env.XIAN_CODEX_BRIDGE_URL || 'http://100.86.57.69:3458';

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
const CECELIA_RUN_PATH = process.env.CECELIA_RUN_PATH || '/Users/administrator/bin/cecelia-run';
const PROMPT_DIR = '/tmp/cecelia-prompts';
const WORK_DIR = process.env.CECELIA_WORK_DIR || '/Users/administrator/perfect21/cecelia';

// ==================== Diagnostic Functions ====================

/**
 * Get system dmesg information (last 100 lines).
 * Used to check for OOM Killer events.
 * Delegates to platform-utils (macOS: returns null, Linux: reads dmesg).
 *
 * @returns {string|null} - dmesg output or null on error
 */
function getDmesgInfo() {
  return platformGetDmesgInfo();
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
const MEM_PER_TASK_MB = 400;                      // ~400MB avg per claude process (observed 300-400MB in production)
const CPU_PER_TASK = 0.5;                         // ~0.5 core avg per claude process (20-30% bursts, often idle waiting API)
const INTERACTIVE_RESERVE = 2;                    // Reserve 2 seats for user's headed Claude sessions
// ============================================================
// Dual-Layer Capacity Model (v1.73.0, updated for Darwin compat)
// ============================================================
// Layer 1: PHYSICAL_CAPACITY — hardware ceiling (CPU + Memory)
// Uses platform-aware calculation with SYSTEM_RESERVED_MB=5000 and MAX_PHYSICAL_CAP=10
const PHYSICAL_CAPACITY = calculatePhysicalCapacity(TOTAL_MEM_MB, CPU_CORES, MEM_PER_TASK_MB, CPU_PER_TASK);

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

// Auto-dispatch thresholds (derived from constants above)
const USABLE_MEM_MB = TOTAL_MEM_MB * 0.8;        // 80% of total memory is usable (keep 20% headroom)
const USABLE_CPU = CPU_CORES * 0.8;              // 80% of CPU is usable (keep 20% headroom)
const RESERVE_CPU = INTERACTIVE_RESERVE * CPU_PER_TASK;
const RESERVE_MEM_MB = INTERACTIVE_RESERVE * MEM_PER_TASK_MB;
const MEM_AVAILABLE_MIN_MB = TOTAL_MEM_MB * 0.15 + RESERVE_MEM_MB;
const SWAP_USED_MAX_PCT = 90;  // macOS 正常 swap 60-70%，50% 太保守导致误判过载清零所有 slot

// ============================================================
// CPU Sampler — delegates to platform-utils (Darwin: loadavg proxy, Linux: /proc/stat)
// ============================================================
const CPU_THRESHOLD_PCT = 80;

function sampleCpuUsage() {
  return platformSampleCpuUsage();
}

function _resetCpuSampler() { platformResetCpuSampler(); }

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

// ============================================================
// Sliding Window — smooth CPU/MEM readings to avoid jitter
// ============================================================
const _cpuHistory = [];    // last N CPU readings
const _memHistory = [];    // last N memory pressure readings
const HISTORY_SIZE_CPU = 5;
const HISTORY_SIZE_MEM = 3;
const SAFETY_MARGIN = 0.80; // effectiveSlots safety headroom (lowered from 0.85 to prevent OOM at memory peaks)

function _pushHistory(arr, value, maxSize) {
  arr.push(value);
  if (arr.length > maxSize) arr.shift();
}

function _avgHistory(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function _maxHistory(arr) {
  if (arr.length === 0) return 0;
  return Math.max(...arr);
}

/** Reset sliding window state (for testing) */
function _resetResourceHistory() {
  _cpuHistory.length = 0;
  _memHistory.length = 0;
}

/**
 * Check server resource availability before spawning.
 * Uses sliding window to smooth CPU (avg of last 5) and memory (max of last 3) readings.
 * Returns { ok, reason, metrics } — ok=false means don't spawn.
 */
function checkServerResources(memReservedMb = 0) {
  const loadAvg1 = os.loadavg()[0];
  const freeMem = getAvailableMemoryMB() - memReservedMb;
  const dynMaxSeats = getEffectiveMaxSeats();

  // Read swap usage (platform-aware: Darwin uses sysctl, Linux uses /proc/meminfo)
  const swapUsedPct = getSwapUsedPct();

  // CPU pressure from real CPU% (replaces load average)
  const rawCpuPct = sampleCpuUsage();
  const rawCpuPressure = rawCpuPct !== null ? rawCpuPct / CPU_THRESHOLD_PCT : 0;

  // Memory pressure: on macOS use vm.memory_pressure kernel signal as primary;
  // on Linux (or macOS fallback) use freeMem-based ratio.
  // vm.memory_pressure: 0=normal→0.0, 1=warning→0.6, 2=urgent→0.95, 3=critical→1.0
  let rawMemPressure;
  let mem_pressure_signal = -1;
  if (IS_DARWIN) {
    mem_pressure_signal = getMacOSMemoryPressure();
    if (mem_pressure_signal >= 0) {
      rawMemPressure = [0.0, 0.6, 0.95, 1.0][mem_pressure_signal];
    } else {
      // Fallback: used_ratio based (getAvailableMemoryMB already returns used_ratio on macOS)
      rawMemPressure = 1 - (freeMem / (TOTAL_MEM_MB * 0.8));
    }
  } else {
    rawMemPressure = 1 - (freeMem / (TOTAL_MEM_MB * 0.8));
  }

  // Push raw readings into sliding window
  if (rawCpuPct !== null) _pushHistory(_cpuHistory, rawCpuPressure, HISTORY_SIZE_CPU);
  _pushHistory(_memHistory, rawMemPressure, HISTORY_SIZE_MEM);

  // Smoothed values: CPU = avg of last 5, MEM = max of last 3 (conservative)
  const cpuPressure = _cpuHistory.length > 0 ? _avgHistory(_cpuHistory) : rawCpuPressure;
  const memPressure = _memHistory.length > 0 ? _maxHistory(_memHistory) : rawMemPressure;
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

  // Apply safety margin: never use 100% of effective capacity
  effectiveSlots = Math.floor(effectiveSlots * SAFETY_MARGIN);

  const metrics = {
    load_avg_1m: loadAvg1,
    cpu_usage_pct: rawCpuPct,
    cpu_threshold_pct: CPU_THRESHOLD_PCT,
    cpu_pressure: Math.round(cpuPressure * 100) / 100,
    free_mem_mb: freeMem,
    mem_min_mb: MEM_AVAILABLE_MIN_MB,
    mem_pressure_signal,
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
    if (cpuPressure >= 1.0) reasons.push(`CPU ${rawCpuPct}% > ${CPU_THRESHOLD_PCT}%`);
    if (freeMem < MEM_AVAILABLE_MIN_MB) reasons.push(`Memory ${freeMem}MB < ${MEM_AVAILABLE_MIN_MB}MB`);
    if (swapUsedPct > SWAP_USED_MAX_PCT) reasons.push(`Swap ${swapUsedPct}% > ${SWAP_USED_MAX_PCT}%`);
    return { ok: false, reason: `Server overloaded: ${reasons.join(', ')}`, effectiveSlots: 0, metrics };
  }

  return { ok: true, reason: null, effectiveSlots, metrics };
}

// ============================================================
// Token Pressure — account usage as resource dimension
// ============================================================

const TOKEN_PRESSURE_THRESHOLD = 80; // 5h usage > 80% = account unavailable

/**
 * Calculate token pressure from account usage data.
 * Returns { token_pressure, available_accounts, details }
 *
 * Pressure mapping:
 *   0 available accounts → 1.0 (full pressure, block all dispatch)
 *   1 available, best 5h > 80% → 0.9
 *   1 available, best 5h <= 80% → 0.7
 *   2 available → scale by best account's 5h usage (0.1-0.5)
 *   3 available → low pressure (0.0-0.3)
 */
async function getTokenPressure() {
  try {
    const usage = await getAccountUsage();
    const accounts = Object.values(usage);

    if (accounts.length === 0) {
      return { token_pressure: 1.0, available_accounts: 0, details: 'no account data' };
    }

    // An account is "available" if its effective 5h pct < threshold
    // effectivePct is already applied in account-usage.js cache (resets_at < 30min → 0%)
    const available = accounts.filter(a => {
      const pct = a.five_hour_pct ?? 0;
      // Check if resetting soon (within 30 min) — treat as available
      if (a.resets_at) {
        const minutesUntilReset = (new Date(a.resets_at) - Date.now()) / 60000;
        if (minutesUntilReset <= 30 && minutesUntilReset > 0) return true;
      }
      return pct < TOKEN_PRESSURE_THRESHOLD;
    });

    const availableCount = available.length;

    if (availableCount === 0) {
      return { token_pressure: 1.0, available_accounts: 0, details: 'all accounts exhausted' };
    }

    // Sort by 5h usage ascending (best = lowest usage)
    available.sort((a, b) => (a.five_hour_pct ?? 0) - (b.five_hour_pct ?? 0));
    const bestPct = available[0].five_hour_pct ?? 0;

    let pressure;
    if (availableCount === 1) {
      // Only 1 account: high pressure, scale by usage
      pressure = bestPct > TOKEN_PRESSURE_THRESHOLD * 0.9 ? 0.9 : 0.7;
    } else if (availableCount === 2) {
      // 2 accounts: moderate pressure, scale by best account usage
      pressure = 0.1 + (bestPct / 100) * 0.4; // 0.1 to 0.5
    } else {
      // 3 accounts: low pressure
      pressure = (bestPct / 100) * 0.3; // 0.0 to 0.3
    }

    return {
      token_pressure: Math.round(pressure * 100) / 100,
      available_accounts: availableCount,
      details: `${availableCount}/3 accounts available, best 5h=${bestPct}%`,
    };
  } catch (err) {
    console.warn(`[executor] getTokenPressure failed: ${err.message}`);
    return { token_pressure: 0, available_accounts: 3, details: 'fallback (API error)' };
  }
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
  const setAt = new Date().toISOString();
  _billingPause = {
    resetTime: resetTimeISO,
    setAt,
    reason,
  };
  // 持久化到 cecelia_events（fire-and-forget，重启后可恢复）
  if (poolRef) {
    const persistPayload = { reset_at: resetTimeISO, reason, set_at: setAt };
    poolRef.query(
      `INSERT INTO cecelia_events (event_type, payload, created_at) VALUES ('billing_pause_set', $1, NOW())`,
      [JSON.stringify(persistPayload)]
    ).catch(e => {
      console.warn(`[executor] billing_pause_set 写入 cecelia_events 失败: ${e.message}`);
    });
  }
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
  // Platform-aware: Darwin uses ps | grep, Linux uses pgrep
  const systemClaudeCount = countClaudeProcesses();

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
       error_message = $2,
       payload = COALESCE(payload, '{}'::jsonb) || $3::jsonb
       WHERE id = $1 AND status = 'in_progress'`,
      [
        taskId,
        `[watchdog] reason=${reason} at ${new Date().toISOString()}`,
        JSON.stringify({
          ...watchdogInfo,
          quarantine_info: {
            quarantined_at: new Date().toISOString(),
            reason: 'resource_hog',
            details: { watchdog_retries: retryCount, kill_reason: reason, total_failures: failureCount },
            previous_status: 'in_progress',
          }
        }),
      ]
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
  // 使用 content_hash 去重，防止相同失败原因无限堆积
  try {
    const failureTitle = `Task Failure: ${taskTitle || taskId} [${reason}]`;
    const failureContent = `Watchdog killed task after ${retryCount} attempts. Reason: ${reason}`;
    const contentHash = crypto.createHash('sha256')
      .update(`${failureTitle}\n${failureContent}`)
      .digest('hex')
      .slice(0, 16);

    const existing = await pool.query(
      'SELECT id FROM learnings WHERE content_hash = $1 AND is_latest = true LIMIT 1',
      [contentHash]
    );

    if (existing.rows.length === 0) {
      await pool.query(`
        INSERT INTO learnings (title, category, trigger_event, content, metadata, content_hash, version, is_latest, digested)
        VALUES ($1, 'failure_pattern', 'watchdog_kill', $2, $3, $4, 1, true, false)
      `, [
        failureTitle,
        failureContent,
        JSON.stringify({ task_id: taskId, task_type: task_type || null, project_id: project_id || null }),
        contentHash,
      ]);
    } else {
      console.log(`[executor] Skipping duplicate failure_pattern (hash=${contentHash})`);
    }
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

  // content_publish → 按 payload.platform 路由到对应 publisher skill
  if (taskType === 'content_publish') {
    const platform = payload?.platform;
    const publisherSkillMap = {
      'douyin': '/douyin-publisher',
      'kuaishou': '/kuaishou-publisher',
      'toutiao': '/toutiao-publisher',
      'weibo': '/weibo-publisher',
      'xiaohongshu': '/xiaohongshu-publisher',
      'zhihu': '/zhihu-publisher',
      'wechat': '/wechat-publisher',
      'shipinhao': '/shipinhao-publisher',
    };
    const skill = publisherSkillMap[platform];
    if (skill) {
      console.log(`[executor] content_publish 路由: platform=${platform} → ${skill}`);
      return skill;
    }
    console.log(`[executor] content_publish 路由: platform=${platform || '未知'} → /dev（fallback）`);
    return '/dev';
  }

  const skillMap = {
    'dev': '/dev',           // 写代码：Opus
    'review': '/code-review', // 审查：已迁移到 /code-review
    'qa_init': '/review init', // QA 初始化：设置 CI 和分支保护
    'talk': '/talk',         // 对话：写文档，不改代码
    'research': null,        // 研究：完全只读
    'dept_heartbeat': '/repo-lead heartbeat', // 部门主管心跳：MiniMax
    'code_review': '/code-review', // 代码审查：Sonnet + /code-review skill
    // Initiative 执行循环
    'initiative_plan': '/decomp',     // Phase 2 规划下一个 PR：/decomp
    'initiative_verify': '/architect', // Initiative 收尾验收 → /architect Mode 3
    'decomp_review': '/decomp-check', // 拆解质检：/decomp-check
    // Suggestion 驱动的自主规划
    'suggestion_plan': '/plan',       // Suggestion 层级识别 → /plan skill
    // Architecture 设计
    'architecture_design': '/architect', // Initiative 级架构设计 → /architect skill
    // 战略会议：C-Suite 模拟讨论，输出带 domain 的 KR
    'strategy_session': '/strategy-session',
    // 内容工厂 Pipeline（Content Factory）
    'content-pipeline': '/content-creator',  // 编排入口：触发完整内容生成流程
    'content-research': '/notebooklm',        // 调研阶段：NotebookLM 深度调研
    'content-generate': '/content-creator',  // 生成阶段：图片+文案生成
    'content-review': '/content-creator',    // 审核阶段：AI 质量评分
    'content-export': '/content-creator',    // 导出阶段：NAS 存储 + manifest
    // 旧类型向后兼容 → 统一走 /code-review
    'qa': '/code-review',
    'audit': '/code-review',
    // 前置审查
    'intent_expand': '/intent-expand',  // 意图扩展：查 OKR/Vision 链路补全 PRD
    // Initiative 执行
    'initiative_execute': '/dev',       // Initiative 执行：/dev 全流程
    // 多平台发布（payload.platform 动态路由，见上方特判逻辑）
    'content_publish': '/dev',          // fallback：正常由上方平台路由拦截
    // Codex Gate 审查任务类型（替代旧的多步审查流程）
    'prd_review': '/prd-review',              // PRD 审查
    'spec_review': '/spec-review',            // Spec 审查
    'code_review_gate': '/code-review-gate',  // 代码质量门禁
    'initiative_review': '/initiative-review', // Initiative 整体审查
    // Scope 层飞轮（Project→Scope→Initiative）
    'scope_plan': '/decomp',        // Phase 3: Scope 内规划下一个 Initiative
    'project_plan': '/decomp',      // Phase 4: Project 内规划下一个 Scope
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
    'review': 'bypassPermissions',     // 已迁移到 /code-review，需写报告
    'talk': 'bypassPermissions',       // 要调 API 写数据库
    'research': 'bypassPermissions',   // 要调 API
    'code_review': 'bypassPermissions', // 需要写报告文件到 docs/reviews/
    // 旧类型向后兼容 → 统一走 /code-review
    'qa': 'bypassPermissions',
    'audit': 'bypassPermissions',
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
/**
 * Build retry context string to append to prompts on retry attempts.
 * Returns empty string on first execution or when no failure info is available.
 *
 * @param {Object} task - Task object from database (includes payload and feedback[])
 * @returns {string} Retry context block (max 2000 chars) or ''
 */
function buildRetryContext(task) {
  const payload = task.payload || {};
  const failureCount = payload.failure_count || 0;
  const classification = payload.failure_classification;
  const watchdogKill = payload.watchdog_kill;

  // No retry context on first execution
  if (failureCount === 0 && !classification) {
    return '';
  }

  const parts = [];

  // Failure classification block
  if (classification) {
    const cls = classification.class || 'unknown';
    const reason = classification.retry_strategy?.reason || watchdogKill?.reason || '';
    parts.push(`上次执行失败，原因分类：${cls}${reason ? `\n失败详情：${reason}` : ''}`);
  } else if (watchdogKill?.reason) {
    parts.push(`上次执行被 Watchdog 终止：${watchdogKill.reason}`);
  }

  // Feedback block (most recent entry)
  const feedbackArr = Array.isArray(task.feedback) ? task.feedback : [];
  const lastFeedback = feedbackArr.length > 0 ? feedbackArr[feedbackArr.length - 1] : null;
  if (lastFeedback) {
    if (lastFeedback.summary) {
      parts.push(`### 上次反馈摘要\n${lastFeedback.summary}`);
    }
    const issuesFound = lastFeedback.issues_found;
    if (Array.isArray(issuesFound) && issuesFound.length > 0) {
      parts.push(`### 发现的问题\n${issuesFound.map(i => `- ${i}`).join('\n')}`);
    } else if (typeof issuesFound === 'string' && issuesFound.trim()) {
      parts.push(`### 发现的问题\n${issuesFound}`);
    }
  }

  if (parts.length === 0) {
    return '';
  }

  const MAX_RETRY_CONTEXT_LENGTH = 2000;
  const header = `\n\n## ⚠️ 重试上下文（第 ${failureCount} 次尝试）\n\n`;
  const footer = '\n\n请在本次执行中重点关注以上问题，避免重复失败。';
  const body = parts.join('\n\n');
  let full = header + body + footer;

  if (full.length > MAX_RETRY_CONTEXT_LENGTH) {
    const allowedBody = MAX_RETRY_CONTEXT_LENGTH - header.length - footer.length - 12; // 12 for '...[已截断]'
    full = header + body.slice(0, Math.max(0, allowedBody)) + '...[已截断]' + footer;
  }

  return full;
}

/**
 * 构建系统背景块，注入到所有 Claude Code dispatch prompt 头部。
 * 让被召唤的 Claude Code 知道自己在 Cecelia 系统中的角色。
 * @returns {string}
 */
function buildSystemContextBlock() {
  return `## 你的角色（Cecelia 系统背景）
你是 Cecelia 自主运行平台的执行手，由 Brain（localhost:5221）调度。
- 任务完成后 Brain 会自动收到回调，无需你主动通知
- 所有代码变更必须走 /dev 流程（worktree → PR → CI → 合并）
- Brain 端口：5221 | Dashboard：5211 | 美国 Mac mini：38.23.47.81

`;
}

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

  // initiative_plan：直接将任务描述作为 /decomp Phase 2 上下文注入
  if (taskType === 'initiative_plan') {
    return `/decomp\n\n${task.description || task.title}`;
  }

  // scope_plan：Scope 内规划下一个 Initiative（/decomp Phase 3）
  if (taskType === 'scope_plan') {
    return `/decomp\n\n[scope_plan] ${task.description || task.title}`;
  }

  // project_plan：Project 内规划下一个 Scope（/decomp Phase 4）
  if (taskType === 'project_plan') {
    return `/decomp\n\n[project_plan] ${task.description || task.title}`;
  }

  // initiative_verify：调用 /architect Mode 3 verify，传入 initiative_id
  if (taskType === 'initiative_verify') {
    const initiativeId = task.project_id || task.payload?.initiative_id || '';
    return `/architect verify --initiative-id ${initiativeId}\n\n${task.description || task.title}`;
  }

  // architecture_design：调用 /architect Mode 2，将 Initiative 描述和 ID 作为上下文注入
  if (taskType === 'architecture_design') {
    return `/architect\n\n${task.description || task.title}`;
  }

  // decomp_review：将任务描述传给 /decomp-check 做拆解质检
  if (taskType === 'decomp_review') {
    return `/decomp-check\n\n${task.description || task.title}`;
  }

  // Codex Gate 审查任务类型
  if (taskType === 'prd_review') {
    return `/prd-review\n\n${task.description || task.title}`;
  }
  if (taskType === 'spec_review') {
    return `/spec-review\n\n${task.description || task.title}`;
  }
  if (taskType === 'code_review_gate') {
    return `/code-review-gate\n\n${task.description || task.title}`;
  }
  if (taskType === 'initiative_review') {
    const initiativeId = task.project_id || task.payload?.initiative_id || '';
    const phase = task.payload?.phase || 1;
    return `/initiative-review --phase ${phase} --initiative-id ${initiativeId}\n\n${task.description || task.title}`;
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

  // review / qa / audit 类型：统一路由到 /code-review
  if (taskType === 'review' || taskType === 'qa' || taskType === 'audit') {
    const repoPath = task.payload?.repo_path || '';
    const since = task.payload?.since_hours ? `--since=${task.payload.since_hours}h` : '';
    const repoArg = repoPath ? `${repoPath}` : '';
    return `/code-review ${repoArg} ${since}`.trim();
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
  const sysCtx = buildSystemContextBlock();
  const retryCtx = buildRetryContext(task);
  const learningCtx = await buildLearningContext(task);
  if (task.prd_content) {
    return `${skill}\n\n${sysCtx}${task.prd_content}${learningCtx}${retryCtx}`;
  }
  if (task.payload?.prd_content) {
    return `${skill}\n\n${sysCtx}${task.payload.prd_content}${learningCtx}${retryCtx}`;
  }
  if (task.payload?.prd_path) {
    return `${skill} ${task.payload.prd_path}${learningCtx}${retryCtx}`;
  }

  // 自动生成 PRD（注入 domain/owner_role 上下文）
  const domain = task.domain || null;
  const ownerRole = task.owner_role || null;
  const domainCtx = (domain || ownerRole)
    ? `\n## 业务领域上下文\n任务所属领域：${domain || '(未指定)'}\n负责角色：${ownerRole || '(未指定)'}\n`
    : '';

  const prd = `# PRD - ${task.title}

## 背景
任务来自 Brain 自动调度。
任务类型：${taskType}
${domainCtx}
## 功能描述
${task.description || task.title}

## 成功标准
- [ ] 任务完成
`;

  return `${skill}\n\n${sysCtx}${prd}${learningCtx}${retryCtx}`;
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
 * Trigger 西安 Mac mini Codex Bridge for a task.
 * Routes codex_qa / codex_dev (and any task with provider=codex) to the Xian Codex CLI.
 *
 * codex_qa  → prompt 模式：将 task description 作为 prompt 直接传给 codex-bin exec
 * codex_dev → runner 模式：启动 runners/codex/runner.sh，source devloop-check.sh 驱动完整 /dev 循环
 *
 * @param {Object} task - The task object from database
 * @returns {Object} - { success, taskId, runId, error? }
 */
async function triggerCodexBridge(task) {
  const runId = generateRunId(task.id);

  try {
    console.log(`[executor] Calling Xian Codex Bridge for task=${task.id} type=${task.task_type}`);

    // codex_dev 使用 runner 模式（完整 /dev 循环，via runner.sh + devloop-check.sh）
    // codex_qa 和其他类型使用 prompt 模式（单次 codex exec）
    const isCodexDev = task.task_type === 'codex_dev';

    // Build prompt from task description/title
    let promptContent = task.description || task.title || '请执行此任务';

    // 注入 decisions 摘要到 Codex 任务
    try {
      const decisionsSummary = await getDecisionsSummary();
      if (decisionsSummary) {
        promptContent = `${decisionsSummary}\n\n---\n\n${promptContent}`;
      }
    } catch (err) {
      console.warn(`[executor] codex decisions 注入失败（不阻塞）: ${err.message}`);
    }

    // codex_dev: 生成分支名（加 -cx suffix 区分 Claude Code 分支）
    const branchSuffix = isCodexDev ? '-cx' : '';
    const taskBranch = task.payload?.branch ||
      (isCodexDev
        ? `cp-${new Date().toISOString().replace(/[-T:]/g, '').slice(2, 12)}-${task.id.slice(0, 8)}${branchSuffix}`
        : undefined);

    const response = await fetch(`${XIAN_CODEX_BRIDGE_URL}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: task.id,
        checkpoint_id: null,
        prompt: promptContent,
        task_type: task.task_type,
        work_dir: task.payload?.repo_path,
        timeout_ms: 10 * 60 * 1000, // 10 minutes for Codex
        // runner 模式参数（codex_dev 专用）
        runner: isCodexDev ? 'packages/engine/runners/codex/runner.sh' : undefined,
        runner_args: isCodexDev ? ['--branch', taskBranch, '--task-id', task.id] : undefined,
        branch: taskBranch,
      }),
      signal: AbortSignal.timeout(15000), // 15s to accept the job
    });

    const result = await response.json();

    if (!result.ok) {
      console.log(`[executor] Codex Bridge rejected: ${result.error}`);
      return {
        success: false,
        taskId: task.id,
        error: result.error,
        executor: 'codex-bridge',
      };
    }

    console.log(`[executor] Codex Bridge accepted task=${task.id} account=${result.account}`);
    return {
      success: true,
      taskId: task.id,
      runId,
      executor: 'codex-bridge',
      account: result.account,
    };
  } catch (err) {
    console.error(`[executor] Codex Bridge error: ${err.message}`);
    return {
      success: false,
      taskId: task.id,
      error: err.message,
      executor: 'codex-bridge',
    };
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
// 路由规则（v2.1 — 全局调度改造 Phase 3）：
//   US_ONLY_TYPES → 必须在美国跑（dev 全流程 + dev 关联的 Codex 审查）
//   其他所有 → 走西安 Codex Bridge
//   location='hk' → 走 HK MiniMax（不变）
const US_ONLY_TYPES = new Set([
  'dev',                  // /dev 全流程（依赖 hooks/state machine）
  'initiative_execute',   // Initiative 执行（/dev 全流程）
  'intent_expand',        // /dev Step 1.5: 意图扩展（查 Brain DB + 补全 PRD）
  // Codex Gate 审查任务类型（需读 worktree diff + Brain DB，必须在美国跑）
  'prd_review',           // PRD 审查
  'spec_review',          // Spec 审查
  'code_review_gate',     // 代码质量门禁
  'initiative_review',    // Initiative 整体审查
]);

async function triggerCeceliaRun(task) {
  const location = getTaskLocation(task.task_type);

  // 1. HK MiniMax 路由（不变）
  if (location === 'hk') {
    return triggerMiniMaxExecutor(task);
  }

  // 2. 非美国专属任务 → 走西安 Codex Bridge
  if (!US_ONLY_TYPES.has(task.task_type)) {
    console.log(`[executor] 路由决策: task_type=${task.task_type} → Codex Bridge (非美国专属任务)`);
    return triggerCodexBridge(task);
  }

  // 3. dev 任务 → Claude Code（本机 cecelia-bridge）
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

    // 防御性修正：task_type=null 但 skill=/dev 时自动填充 task_type=dev
    if (!task.task_type && task.payload?.skill === '/dev') {
      console.warn(`[executor] task_type=null but skill=/dev for task ${task.id}, auto-filling task_type=dev`);
      task = { ...task, task_type: 'dev' };
    }

    // Prepare prompt content, permission mode, extra env, and model based on task_type
    const taskType = task.task_type || 'dev';
    let promptContent = await preparePrompt(task);

    // 注入 decisions 摘要（用户/系统决策的 SSOT）
    try {
      const decisionsSummary = await getDecisionsSummary();
      if (decisionsSummary) {
        promptContent = `${decisionsSummary}\n\n---\n\n${promptContent}`;
      }
    } catch (err) {
      console.warn(`[executor] decisions 注入失败（不阻塞派发）: ${err.message}`);
    }
    const permissionMode = getPermissionModeForTaskType(taskType);
    const extraEnv = getExtraEnvForTaskType(taskType);
    const model = getModelForTask(task);

    // Update task with run info before execution
    await updateTaskRunInfo(task.id, runId, 'triggered');

    // 记录执行尝试次数（用于成功率统计）
    try {
      await pool.query(
        `UPDATE tasks
         SET
           execution_attempts = COALESCE(execution_attempts, 0) + 1,
           last_attempt_at = NOW(),
           updated_at = NOW()
         WHERE id = $1`,
        [task.id]
      );
    } catch (attemptErr) {
      // P3 级别：不影响主派发流程
      console.warn(`[executor] execution_attempt_record_failed task=${task.id}: ${attemptErr.message}`);
    }

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
    let provider = getProviderForTask(task);

    // Get credentials file for the task (universal, works for all providers)
    const credentials = getCredentialsForTask(task);
    if (credentials && credentials.startsWith('account')) {
      // Profile 中固定了账号，先检查 spending cap
      const { isSpendingCapped } = await import('./account-usage.js');
      if (isSpendingCapped(credentials)) {
        // 固定账号被 cap，fallback 到动态选择
        console.log(`[executor] Profile 固定账号 ${credentials} 被 spending-capped，fallback 到 selectBestAccount for task=${task.id}`);
      } else {
        extraEnv.CECELIA_CREDENTIALS = credentials;
      }
    } else if (credentials) {
      // 非账号类型凭据（如 minimax key 文件），直接使用
      extraEnv.CECELIA_CREDENTIALS = credentials;
    }

    if (!extraEnv.CECELIA_CREDENTIALS && provider === 'anthropic') {
      // 瀑布降级链：按任务 cascade 顺序（Sonnet→Opus→Haiku→MiniMax）
      // selectBestAccount() 返回 { accountId, model, modelId } 或 null（降级 MiniMax）
      const taskCascade = getCascadeForTask(task);
      const selection = await selectBestAccount({ cascade: taskCascade });
      if (selection) {
        const { accountId, modelId: selectedModelId } = selection;
        extraEnv.CECELIA_CREDENTIALS = accountId;
        // 始终通过 CECELIA_MODEL 传递选定的模型 ID
        extraEnv.CECELIA_MODEL = selectedModelId;
        // 记录 dispatched_account 到 task payload（供 billing_cap 回调精准标记）
        // 必须 await：若 fire-and-forget 则 cecelia-run 秒失败时 execution-callback 先到达，
        // payload 尚未写入 dispatched_account → 无法精准标记 spending cap 账号
        try {
          await pool.query(
            `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
            [task.id, JSON.stringify({ dispatched_account: accountId, dispatched_model: selectedModelId })]
          );
        } catch (e) {
          console.warn(`[executor] 记录 dispatched_account 失败: ${e.message}`);
        }
      } else {
        // 所有账号满载（5h）或全部 spending-capped → 降级到 MiniMax
        console.log(`[executor] Anthropic 账号全满/全封，自动降级到 MiniMax for task=${task.id}`);
        provider = 'minimax';
        extraEnv.CECELIA_PROVIDER = 'minimax';
      }
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
    const response = await fetch(`${EXECUTOR_BRIDGE_URL}/health`, { method: 'GET', signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      return { available: true, path: EXECUTOR_BRIDGE_URL, bridge: true };
    }
    return { available: false, path: EXECUTOR_BRIDGE_URL, error: `Bridge health check failed: ${response.status}` };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { available: false, path: EXECUTOR_BRIDGE_URL, error: 'Timeout' };
    }
    if (err.cause?.code === 'ECONNREFUSED') {
      return { available: false, path: EXECUTOR_BRIDGE_URL, error: 'Bridge not running' };
    }
    return { available: false, path: EXECUTOR_BRIDGE_URL, error: err.message };
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
    SELECT id, title, payload, started_at, task_type
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

    // Decomposition tasks (/decomp) and initiative_plan/initiative_verify tasks run for
    // 3-10+ minutes — apply extended grace period to avoid false-positive failures.
    // initiative_plan/initiative_verify are always dispatched via bridge where task_id
    // is NOT in the process cmdline, so isTaskProcessAlive() always returns false for them.
    const DECOMP_LIVENESS_GRACE_MINUTES = 60;
    const isInitiativeTask = task.task_type === 'initiative_plan' || task.task_type === 'initiative_verify' || task.task_type === 'architecture_design' || task.task_type === 'scope_plan' || task.task_type === 'project_plan';
    if (task.payload?.decomposition === 'true' || isInitiativeTask) {
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

    // Requeue instead of fail — liveness DEAD is typically OOM/system preemption, not a code bug
    const requeueResult = await requeueTask(task.id, 'liveness_dead', errorDetails);

    // Fire-and-forget auto-learning（liveness probe 路径无 execution-callback，需在此补充）
    import('./auto-learning.js').then(({ processExecutionAutoLearning }) =>
      processExecutionAutoLearning(task.id, requeueResult.quarantined ? 'failed' : 'requeued', errorDetails, {
        trigger_source: 'liveness_probe',
        metadata: { suspect_since: suspect.firstSeen, pid }
      })
    ).catch(() => {/* non-fatal */});

    actions.push({
      action: requeueResult.quarantined ? 'liveness_auto_fail' : 'liveness_auto_requeue',
      task_id: task.id,
      title: task.title,
      suspect_since: suspect.firstSeen,
      requeue_result: requeueResult,
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
    SELECT id, title, payload, started_at, error_message
    FROM tasks
    WHERE status = 'in_progress'
  `);

  let orphansFound = 0;
  let orphansFixed = 0;
  let requeued = 0;
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

      const QUARANTINE_AFTER_KILLS = 2; // Must match requeueTask's constant
      const watchdogRetryCount = task.payload?.watchdog_retry_count || 0;
      const hasExistingError = !!task.error_message;
      const canRetry = watchdogRetryCount < QUARANTINE_AFTER_KILLS && !hasExistingError;

      if (canRetry) {
        // Brain restart interrupted the task — requeue for another attempt
        const newRetryCount = watchdogRetryCount + 1;
        await pool.query(
          `UPDATE tasks SET
            status = 'queued',
            error_message = $2,
            payload = COALESCE(payload, '{}'::jsonb) || $3::jsonb,
            updated_at = NOW()
          WHERE id = $1`,
          [
            task.id,
            'requeued after brain restart',
            JSON.stringify({ watchdog_retry_count: newRetryCount }),
          ]
        );
        requeued++;
        console.log(`[startup-sync] Orphan requeued: task=${task.id} title="${task.title}" watchdog_retry_count=${newRetryCount}`);
      } else {
        // Exhausted retries or pre-existing error — mark as failed
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
            error_message = $3,
            payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
          WHERE id = $1`,
          [
            task.id,
            JSON.stringify({ error_details: errorDetails }),
            `[orphan_detected] reason=${reason} at ${new Date().toISOString()}`,
          ]
        );

        // Fire-and-forget auto-learning（orphan 路径无 execution-callback，需在此补充）
        import('./auto-learning.js').then(({ processExecutionAutoLearning }) =>
          processExecutionAutoLearning(task.id, 'failed', errorDetails, {
            trigger_source: 'orphan_detection',
            metadata: { run_id: runId }
          })
        ).catch(() => {/* non-fatal */});

        orphansFixed++;
        console.log(`[startup-sync] Orphan failed: task=${task.id} title="${task.title}" reason=${reason} watchdog_retry_count=${watchdogRetryCount}`);
      }
    }
  }

  console.log(`[startup-sync] Complete: orphans_found=${orphansFound} orphans_fixed=${orphansFixed} requeued=${requeued} rebuilt=${rebuilt}`);
  return { orphans_found: orphansFound, orphans_fixed: orphansFixed, requeued, rebuilt };
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
  triggerCodexBridge,
  triggerMiniMaxExecutor,
  checkCeceliaRunAvailable,
  getTaskExecutionStatus,
  updateTaskRunInfo,
  preparePrompt,
  buildRetryContext,
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
  XIAN_CODEX_BRIDGE_URL,
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
  _resetResourceHistory,
  SAFETY_MARGIN,
  // v13: code-review env isolation
  getExtraEnvForTaskType,
  // v14: Input validation for shell commands
  assertSafeId,
  assertSafePid,
  // v15: Token-aware slot allocation
  getTokenPressure,
  TOKEN_PRESSURE_THRESHOLD,
};
