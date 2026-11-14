import { prepareInvocationDispatch, invocationTaskPrompt, invocationBridgeRequired,runInvocationActivities,reconcileInvocationLiveness } from './invocations/runtime.js';
import {createInvocationActivityExecutor} from './invocations/activity-worker.js';
import {finishRun as finishInvocationRun} from './lib/task-run.js';
import { isPhoneDispatchTask } from './phone-dispatch/task-ownership.js';
import { isRetiredDecomposition, RETIRED_DECOMPOSITION } from './lib/retired-decomposition.js';
import { withLegacyRelayExecution } from './execution-directory/legacy-relay.js';
import { withLegacyExecution,legacyExecutorEntries } from './execution-directory/legacy-executor.js';
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

import crypto from 'crypto';
import { assertExternalExecutionAllowed } from './runtime-safety.js';
import { spawn, execSync, exec } from 'child_process';
import { writeFile, mkdir, access } from 'fs/promises';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import pool from './db.js';
import { buildLearningContext } from './learning-retriever.js';
import { generateL0Summary } from './memory-utils.js';
import { getDecisionsSummary } from './decisions-context.js';
import { getActiveProfile, FALLBACK_PROFILE } from './model-profile.js';
import { getTaskLocation } from './task-router.js';
import { isCommanderVerification } from './lib/commander-verification-transport.js';
import { resolveExecutor } from './routing/resolve-executor.js';
import { loadCache as _loadCache, getCachedLocation, getCachedConfig, refreshCache as _refreshCache } from './task-type-config-cache.js';
import { updateTaskStatus, updateTaskProgress as _updateTaskProgress } from './task-updater.js';
import { finalizeTask } from './lib/task-terminal.js';
import { getAccountUsage } from './account-usage.js';
import { writeDockerCallback, resolveResourceTier, isDockerAvailable } from './docker-executor.js';
import { loadSkillContent } from './execution-shared.js';
import { REVIEW_TASK_TYPES } from './lib/review-task-types.js';
import {
  isRetiredDevelopmentTask,
  isExternalWorkerTask,
  RETIRED_DEVELOPMENT_CODE,
  EXTERNAL_WATCHDOG_TASK_TYPES,
  EXECUTOR_SKILL_MAP,
} from './lib/task-type-registry.js';
import { CLAUDE_CHANNEL_RETIRED_CODE } from './lib/claude-channel.js';
import { recordTaskEventSafe } from './lib/task-event-log.js';
import { startRunForExecResult } from './lib/task-run.js';
import { internalServiceHeaders } from './lib/internal-service-auth.js';
import { resolveTaskTypeSkill, resolveSkillWithLedger } from './lib/skill-binding-registry.js';
import { consumeReviewSkill } from './lib/review-skill-plan.js';

// 外部执行体（工作机领单器等）认领后的活性宽限期。
// 真机实测单个关键词采收 17~25 分钟（逐个点进评论者主页核验身份），45 分钟留足余量；
// 超过仍无回执 → 落回既有 SUSPECT→DEAD 流程，工作机断电/领单器挂了照样有出路。
const EXTERNAL_CLAIM_GRACE_MS = Number(process.env.EXTERNAL_CLAIM_GRACE_MS || 45 * 60 * 1000);
import { classifyCodexFailure } from './lib/codex-fatal-patterns.js';
import { raise } from './alerting.js';
import { EXECUTOR_KIND_FOR, isExternallyExecuted, assessTaskLiveness } from './executor-contracts.js';
import {
  isExternalRunMirror,
  externalActivityAgeMs,
  createStaleLedger,
  EXTERNAL_ACTIVITY_AGE_SQL,
  EXTERNAL_HEARTBEAT_STALE_MS,
} from './lib/external-mirror-liveness.js';
import { probeCodexReviewLock, CODEX_REVIEW_LOCK_DIR as CODEX_REVIEW_LOCK_DIR_SSOT } from './lib/codex-review-liveness.js';
import { pushCaptureAtom } from './capture-inbox.js';
import {
  sampleCpuUsage as platformSampleCpuUsage,
  _resetCpuSampler as platformResetCpuSampler,
  getSwapUsedPct,
  getDmesgInfo as platformGetDmesgInfo,
  countClaudeProcesses,
  calculatePhysicalCapacity,
  evaluateMemoryHealth,
  getBrainRssMB,
  sampleBrainCpuUsage,
  evaluateCpuHealth,
  IS_DARWIN,
} from './platform-utils.js';

/**
 * 计算 watchdog deadline 毫秒数。
 * 若 deadline 为 null/undefined 或已过期 → 返回 6h fallback。
 * 若 deadline 未来 → 返回剩余毫秒。
 * 导出供单元测试使用。
 */
export function computeDeadlineMs(deadlineAt) {
  if (!deadlineAt) return 6 * 3600 * 1000;
  const remaining = new Date(deadlineAt).getTime() - Date.now();
  return remaining > 0 ? remaining : 6 * 3600 * 1000;
}

/**
 * 打标助手：在派发点写入 executor_kind，让守护刀用合同判活。
 * P3 级别：失败不阻塞派发。
 */
async function setExecutorKind(taskId, kind) {
  try {
    await pool.query(
      `UPDATE tasks SET executor_kind = $1, updated_at = NOW() WHERE id = $2`,
      [kind, taskId]
    );
  } catch (err) {
    console.warn(`[executor] setExecutorKind failed task=${taskId} kind=${kind}: ${err.message}`);
  }
}

// ─── Resource Cache ─────────────────────────────────────────────────────────
// Prevents execSync from blocking the Node.js event loop in the hot path.
// Seeded with safe defaults on module load, then refreshed every 15s via
// async exec() so the event loop is never blocked by sysctl/vm_stat calls.
// ─────────────────────────────────────────────────────────────────────────────
const RESOURCE_POLL_INTERVAL_MS = 15000;
const _resourceCache = {
  memPressureSignal: -1,
  availableMemMB: Math.round(os.freemem() / 1024 / 1024),
  swapUsedPct: 0,
  lastUpdated: 0,
};

function _pollResourceAsync() {
  if (process.platform !== 'darwin') {
    _resourceCache.availableMemMB = Math.round(os.freemem() / 1024 / 1024);
    _resourceCache.lastUpdated = Date.now();
    return;
  }
  let completed = 0;
  const done = () => { if (++completed === 3) _resourceCache.lastUpdated = Date.now(); };

  exec('sysctl vm.memory_pressure', { timeout: 3000 }, (err, stdout) => {
    if (!err && stdout) {
      const match = stdout.match(/vm\.memory_pressure:\s*(\d+)/);
      if (match) {
        const level = parseInt(match[1], 10);
        _resourceCache.memPressureSignal = [0, 1, 2, 3].includes(level) ? level : -1;
      }
    }
    done();
  });

  exec('vm_stat', { timeout: 3000 }, (err, stdout) => {
    if (!err && stdout) {
      const pageSizeMatch = stdout.match(/page size of (\d+) bytes/);
      const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1], 10) : 16384;
      const getPages = (re) => { const m = stdout.match(re); return m ? parseInt(m[1], 10) : 0; };
      const activePages = getPages(/Pages active:\s+(\d+)/);
      const wiredPages = getPages(/Pages wired down:\s+(\d+)/);
      const freePages = getPages(/Pages free:\s+(\d+)/);
      const inactivePages = getPages(/Pages inactive:\s+(\d+)/);
      const speculativePages = getPages(/Pages speculative:\s+(\d+)/);
      const totalPages = activePages + wiredPages + freePages + inactivePages + speculativePages;
      if (totalPages > 0) {
        const usedRatio = (activePages + wiredPages) / totalPages;
        _resourceCache.availableMemMB = Math.round((1 - usedRatio) * totalPages * pageSize / 1024 / 1024);
      } else {
        _resourceCache.availableMemMB = Math.round(os.freemem() / 1024 / 1024);
      }
    }
    done();
  });

  exec('sysctl vm.swapusage', { timeout: 3000 }, (err, stdout) => {
    if (!err && stdout) {
      const totalMatch = stdout.match(/total\s*=\s*([\d.]+)M/);
      const usedMatch = stdout.match(/used\s*=\s*([\d.]+)M/);
      if (totalMatch && usedMatch) {
        const total = parseFloat(totalMatch[1]);
        const used = parseFloat(usedMatch[1]);
        _resourceCache.swapUsedPct = total > 0 ? Math.round((used / total) * 100) : 0;
      }
    }
    done();
  });
}

export function _startResourcePolling() {
  _pollResourceAsync();
  setInterval(_pollResourceAsync, RESOURCE_POLL_INTERVAL_MS).unref();
}

/**
 * Get macOS memory pressure level — reads from cache (no execSync).
 * Returns 0/1/2/3 or -1.
 * @returns {number}
 */
function getMacOSMemoryPressure() {
  return _resourceCache.memPressureSignal;
}

/**
 * Get available memory in MB — reads from cache (no execSync).
 * @returns {number} Available memory in MB
 */
function getAvailableMemoryMB() {
  return _resourceCache.availableMemMB;
}

// HK MiniMax Executor URL (via Tailscale)
const HK_MINIMAX_URL = process.env.HK_MINIMAX_URL || 'http://100.86.118.99:5226';

// 西安 Mac mini M4 Codex Bridge URL (via Tailscale)
const XIAN_CODEX_BRIDGE_URL = process.env.XIAN_CODEX_BRIDGE_URL || 'http://100.86.57.69:3458';

// 西安 Mac mini M1 Codex Bridge URL (via Tailscale)
const XIAN_M1_BRIDGE_URL = process.env.XIAN_M1_BRIDGE_URL || 'http://100.88.166.55:3458';

/**
 * 从多个 Codex Bridge 中选择最空闲的
 */
export async function selectBestBridge() {
  const results = await Promise.allSettled(
    legacyExecutorEntries().filter(e=>e.executor==='codex').map(e=>e.url).map(async (url) => {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok || data.status !== 'healthy') throw new Error('unhealthy');
      const accounts = Array.isArray(data.accounts) ? data.accounts : [];
      const available = accounts.filter(a => !a.tokenExpired);
      if (available.length === 0) throw new Error('no available accounts');
      const avgPct = available.reduce((sum, a) => sum + (a.primaryUsedPct || 0), 0) / available.length;
      return { url, avgPct, accountCount: available.length };
    })
  );

  const healthy = results
    .map((r) => r.status === 'fulfilled' ? r.value : null)
    .filter(Boolean)
    .sort((a, b) => a.avgPct - b.avgPct);

  if (healthy.length === 0) {
    console.warn('[executor] 所有 Codex Bridge 不可用，降级到 XIAN_CODEX_BRIDGE_URL');
    throw new Error('execution_legacy_grant_unavailable:codex');
  }

  const selected = healthy[0];
  console.log(`[executor] Bridge 选择: ${selected.url} (avgPct=${selected.avgPct.toFixed(1)}%, accounts=${selected.accountCount})`);
  return selected.url;
}

// 静态机器注册表 + 选机函数已删除（phase 2 单元2，死代码：派发链从未调用，仅自引用）。
// 机器+执行器路由统一走 routing/resolve-executor.js（DB 驱动）。

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
const _CECELIA_RUN_PATH = process.env.CECELIA_RUN_PATH || '/Users/administrator/bin/cecelia-run';
const PROMPT_DIR = '/tmp/cecelia-prompts';
const WORK_DIR = process.env.CECELIA_WORK_DIR || '/Users/administrator/perfect21/cecelia';

// Codex Review 独立池（不占动态派发槽位）
const CODEX_REVIEW_LOCK_DIR = CODEX_REVIEW_LOCK_DIR_SSOT;
const CODEX_REVIEW_MAX = 2;

// 审查任务类型列表（由 triggerCodexReview 以本机 codex CLI 执行，走独立 codex-review-locks 池）
// REVIEW_TASK_TYPES 从 lib/review-task-types.js（SSOT）导入

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
  } catch {
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

/**
 * Detect "never started" tasks (1dfa40f7 防复发): dispatch was rejected/failed before any
 * process launched — e.g. S2 锚点执法拒绝点火. 三信号联合判定（判定点登记表方法 A）：
 *   pid 未跟踪（executor 内存无 activeProcesses 条目）
 *   ∧ 无进程日志 /tmp/cecelia-{id}.log
 *   ∧ (started_at=null ∨ 已有派发失败 error_message)
 *
 * 保守回落（失败语义）：信号不完整（如日志探测异常）或存在进程日志（曾启动强证据，
 * 即使 started_at 被 requeue 清空）→ 返回 false，维持既有 process_disappeared 兜底，
 * 宁可漏判不可把曾启动任务误判为 never_started（真实 OOM/抢占事件不被静默改写根因）。
 *
 * @param {Object} task - tasks 行（id, started_at, error_message）
 * @param {Object|undefined} entry - activeProcesses 条目（undefined = pid 未跟踪）
 * @returns {boolean}
 */
function isNeverStarted(task, entry) {
  try {
    if (entry) {
      return false; // executor 曾跟踪该任务 → 发生过点火尝试，非「从未启动」
    }
    if (existsSync(`/tmp/cecelia-${task.id}.log`)) {
      return false; // 进程日志存在 = 曾启动强证据 → 回落 process_disappeared
    }
    return task.started_at === null || Boolean(task.error_message);
  } catch {
    return false; // 信号不完整 → 保守回落现状兜底，杜绝新误判面
  }
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
    // 显式 budget 覆盖：原样尊重，不再用 PHYSICAL_CAPACITY 截断。
    // PHYSICAL_CAPACITY 基于 400MB/task 估算，在低内存容器（~786MB 可用）固化为下界 2，
    // 会把用户 ENV 的 7/10 静默截到 2，再经 SAFETY_MARGIN floor(2*0.8)=1 → effectiveSlots=1（5/3 prod 实证）。
    // 实时安全阀是 checkServerResources() 的 cpu/mem/swap pressure 缩放，过载时会自动降到 0。
    // 详见 docs/diagnosis/slot-allocator-shrink-rca.md。
    return _budgetCap;
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
const _USABLE_MEM_MB = TOTAL_MEM_MB * 0.8;        // 80% of total memory is usable (keep 20% headroom)
const _USABLE_CPU = CPU_CORES * 0.8;              // 80% of CPU is usable (keep 20% headroom)
const _RESERVE_CPU = INTERACTIVE_RESERVE * CPU_PER_TASK;
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
 * Resolve repo_path from a project（project_repos 空表已删，迁移 482）.
 * 棒4（决策 ee4842a6/3feeae3e）：scope/initiative 层退役，task.project_id 现在
 * 直接指向真身表 projects(id)，不再需要 okr_initiatives/okr_scopes/okr_projects
 * 三表 UNION（旧实现每个分支都硬编码 NULL::uuid AS parent_id，"向上走父链"从未
 * 真正执行过，等价于单层查询——这里按等价行为简化）。
 * repo_path 优先取真身表自己的列，旧数据（迁移 497 搬家时未回填该列）回退读 metadata。
 */
async function resolveRepoPath(projectId) {
  if (!projectId) return null;
  const result = await pool.query(
    `SELECT COALESCE(repo_path, metadata->>'repo_path') AS repo_path
     FROM projects WHERE id = $1`,
    [projectId]
  );
  return result.rows[0]?.repo_path || null;
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

  // Read swap usage from cache (no execSync; updated every 15s by _pollResourceAsync)
  const swapUsedPct = IS_DARWIN ? _resourceCache.swapUsedPct : getSwapUsedPct();

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
  let cpuPressure = _cpuHistory.length > 0 ? _avgHistory(_cpuHistory) : rawCpuPressure;
  let memPressure = _memHistory.length > 0 ? _maxHistory(_memHistory) : rawMemPressure;
  const swapPressure = swapUsedPct / SWAP_USED_MAX_PCT;

  // PIVOT 2026-09-12: distinguish Brain-process CPU health from system-wide
  // /proc/stat. Docker does not virtualize /proc/stat per-container, so
  // sampleCpuUsage() reads the ENTIRE HOST's CPU — on a shared VPS, sibling
  // containers (e.g. openclaw-gateway) can drive this into the halt band
  // while Brain's own container sits idle. Only real Brain-level CPU load
  // halts dispatch; system-noisy-but-Brain-fine downgrades to a warn log.
  const brainCpuPct = sampleBrainCpuUsage();
  const cpuHealth = evaluateCpuHealth({
    brain_cpu_pct: brainCpuPct,
    system_cpu_pressure: rawCpuPressure,
  });
  if (cpuHealth.action === 'warn' && cpuPressure >= 0.9) {
    console.warn(`[executor] cpu warn (not halting): ${cpuHealth.reason}`);
    cpuPressure = Math.min(cpuPressure, 0.6);
  }

  // PIVOT 2026-04-18: distinguish Brain-process health from system-wide memory.
  // If Brain's own RSS is fine but the system is noisy (other apps eating
  // memory), downgrade memPressure so we don't needlessly halt dispatch.
  // Only a real Brain leak (RSS > 1.5GB) keeps memPressure at its raw high.
  const brainRssMB = getBrainRssMB();
  const memHealth = evaluateMemoryHealth({
    brain_rss_mb: brainRssMB,
    system_available_mb: freeMem,
    system_total_mb: TOTAL_MEM_MB,
    system_floor_mb: MEM_AVAILABLE_MIN_MB,
  });
  if (memHealth.action === 'warn' && memPressure >= 0.9) {
    // System-wide memory looks bad but Brain itself is healthy; cap the
    // memory pressure signal so we do NOT zero out effectiveSlots. Still
    // scale down somewhat (0.6 ≈ warning tier) so dispatch is conservative.
    console.warn(`[executor] memory warn (not halting): ${memHealth.reason}`);
    memPressure = Math.min(memPressure, 0.6);
  }

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
    brain_rss_mb: brainRssMB,
    memory_health_action: memHealth.action,
    memory_health_reason: memHealth.reason,
    brain_cpu_pct: brainCpuPct,
    cpu_health_action: cpuHealth.action,
    cpu_health_reason: cpuHealth.reason,
  };

  if (effectiveSlots === 0) {
    const reasons = [];
    if (cpuPressure >= 1.0) reasons.push(`CPU ${rawCpuPct}% > ${CPU_THRESHOLD_PCT}%`);
    // Only cite memory as a halt reason when Brain itself is the problem.
    // System-low-but-Brain-fine was already downgraded above; if we still
    // ended up at 0 slots, it's from another dimension (CPU/swap) — don't
    // blame the environment.
    if (freeMem < MEM_AVAILABLE_MIN_MB && memHealth.action === 'halt') {
      reasons.push(`Brain RSS ${brainRssMB}MB > ${memHealth.brain_rss_danger_mb}MB (real leak)`);
    }
    if (swapUsedPct > SWAP_USED_MAX_PCT) reasons.push(`Swap ${swapUsedPct}% > ${SWAP_USED_MAX_PCT}%`);
    return { ok: false, reason: `Server overloaded: ${reasons.join(', ') || 'pressure threshold reached'}`, effectiveSlots: 0, metrics };
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
// Billing Pause (全局暂停派发)
// ============================================================

let _billingPause = null; // { resetTime: ISO string, setAt: ISO string, reason: string }

/**
 * 设置 billing pause（全局暂停派发直到 reset 时间）
 * @param {string} resetTimeISO - reset 时间 (ISO 8601)
 * @param {string} reason - 原因描述
 * @param {object|null} poolRef - DB pool 引用（可选，用于写 billing_pause_set 事件）
 */
function setBillingPause(resetTimeISO, reason = 'billing_cap', poolRef = null) {
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
/** 外部 run 镜像心跳陈旧留痕账本（每陈旧窗口一次；见 lib/external-mirror-liveness.js） */
const externalStaleNoted = createStaleLedger();

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
  // liveness_dead = OOM/系统抢占（环境问题），给更多重试机会让系统恢复
  // 其他 watchdog kill（Crisis/高内存）= 资源耗尽，保持 2 次限制
  const LIVENESS_QUARANTINE_AFTER_KILLS = 3;
  const QUARANTINE_AFTER_KILLS = reason === 'liveness_dead' ? LIVENESS_QUARANTINE_AFTER_KILLS : 2;
  // liveness_dead 最短退避 15min（900s），让系统内存有时间恢复
  const LIVENESS_MIN_BACKOFF_SEC = 900;

  // P0 #2: Only requeue tasks that are still in_progress (prevents reviving completed/failed tasks)
  const result = await pool.query(
    'SELECT payload, task_type, project_id, title, started_at FROM tasks WHERE id = $1 AND status = $2',
    [taskId, 'in_progress']
  );
  if (result.rows.length === 0) {
    // P0 FIX: 竞态条件 — 任务不是 in_progress（可能被 liveness probe 或 execution-callback 先改了状态）
    // 仍需递增 watchdog_retry_count 并在超限时 quarantine，否则死循环
    const fallbackResult = await pool.query(
      'SELECT payload, status FROM tasks WHERE id = $1 AND status NOT IN ($2, $3, $4)',
      [taskId, 'completed', 'cancelled', 'canceled']
    );
    if (fallbackResult.rows.length > 0) {
      const fbPayload = fallbackResult.rows[0].payload || {};
      const fbStatus = fallbackResult.rows[0].status;
      const fbRetryCount = (fbPayload.watchdog_retry_count || 0) + 1;
      if (fbRetryCount >= QUARANTINE_AFTER_KILLS) {
        // 超限 → fallback quarantine（不管当前状态是什么）
        await pool.query(
          `UPDATE tasks SET status = 'quarantined',
           error_message = $2,
           payload = (COALESCE(payload, '{}'::jsonb) - 'failure_class') || $3::jsonb
           WHERE id = $1 AND status NOT IN ('completed', 'cancelled', 'canceled')`,
          [
            taskId,
            `[watchdog-fallback] reason=${reason} prev_status=${fbStatus} at ${new Date().toISOString()}`,
            JSON.stringify({
              watchdog_retry_count: fbRetryCount,
              failure_class: 'liveness_dead',
              quarantine_info: {
                quarantined_at: new Date().toISOString(),
                reason: 'resource_hog_race_condition',
                details: { watchdog_retries: fbRetryCount, kill_reason: reason, previous_status: fbStatus },
                previous_status: fbStatus,
              }
            }),
          ]
        );
        console.log(`[executor] Fallback quarantine: task=${taskId} prev_status=${fbStatus} retries=${fbRetryCount}`);
        await recordTaskEventSafe(pool, taskId, 'watchdog_quarantine', {
          reason, disposition: 'fallback_quarantine', retry_count: fbRetryCount, previous_status: fbStatus,
        });
        return { requeued: false, quarantined: true, reason: 'fallback_quarantine' };
      } else {
        // 未超限 → 仅递增 counter（不改状态，不 requeue）
        await pool.query(
          `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
           WHERE id = $1`,
          [taskId, JSON.stringify({ watchdog_retry_count: fbRetryCount })]
        );
        console.log(`[executor] Fallback counter increment: task=${taskId} prev_status=${fbStatus} retries=${fbRetryCount}`);
      }
    }
    return { requeued: false, reason: 'not_in_progress' };
  }

  const { payload: rawPayload, task_type, project_id, title: taskTitle, started_at } = result.rows[0];
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
    // Evidence gate: 只有实测数据（rss_mb > 500 或 runtime > tier * 1.2）支持时才隔离为 resource_hog
    const runtimeMs = started_at ? Date.now() - new Date(started_at).getTime() : 0;
    const { classifyFailure, FAILURE_CLASS } = await import('./quarantine.js');
    const evidenceClass = classifyFailure(reason, { task_type }, { rss_mb: evidence.rss_mb ?? 0, runtime_ms: runtimeMs });

    if (evidenceClass.class !== FAILURE_CLASS.UNKNOWN) {
      // Resource evidence confirmed → quarantine as resource_hog
      // Clear stale failure_class to prevent liveness_dead being miscounted as auth failures.
      const updateResult = await pool.query(
        `UPDATE tasks SET status = 'quarantined',
         error_message = $2,
         payload = (COALESCE(payload, '{}'::jsonb) - 'failure_class') || $3::jsonb
         WHERE id = $1 AND status = 'in_progress'`,
        [
          taskId,
          `[watchdog] reason=${reason} at ${new Date().toISOString()}`,
          JSON.stringify({
            ...watchdogInfo,
            failure_class: 'liveness_dead',
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
      await recordTaskEventSafe(pool, taskId, 'watchdog_quarantine', {
        reason, disposition: 'resource_hog', retry_count: retryCount, total_failures: failureCount,
      });
      return { requeued: false, quarantined: true };
    }

    console.log(`[executor] Skipping resource_hog quarantine for ${taskId}: no evidence (rss=${evidence.rss_mb ?? 0}MB, runtime=${Math.round(runtimeMs / 1000)}s) — requeueing`);
    // Fall through to requeue — resource_hog 不隔离无实证任务
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
    let backoffSec = Math.min(Math.pow(2, retryCount) * 60, 1800);
    // liveness_dead 强制最低 15min，避免系统内存未恢复时立即重试被再次 kill
    if (reason === 'liveness_dead') {
      backoffSec = Math.max(backoffSec, LIVENESS_MIN_BACKOFF_SEC);
    }
    nextRunAt = new Date(Date.now() + backoffSec * 1000).toISOString();
    console.log(`[executor] Using default exponential backoff: ${backoffSec}s`);
  }

  // P0 #2: WHERE status='in_progress' prevents reviving already-completed tasks
  const updateResult = await pool.query(
    `UPDATE tasks SET status = 'queued', claimed_by = NULL, claimed_at = NULL, started_at = NULL,
     payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
     WHERE id = $1 AND status = 'in_progress'`,
    [taskId, JSON.stringify({ ...watchdogInfo, next_run_at: nextRunAt })]
  );

  if (updateResult.rowCount === 0) {
    return { requeued: false, reason: 'status_changed' };
  }

  // 处置留痕（合同失败语义：watchdog 处置任一任务必须落 task_events 行，写失败不阻断）
  await recordTaskEventSafe(pool, taskId, 'watchdog_requeue', {
    reason,
    exit_reason: evidence?.reason || reason,
    retry_count: retryCount,
    next_run_at: nextRunAt,
  });

  // Fix: 记录失败到 learnings 表，供 planner buildLearningPenaltyMap 使用
  // 使用 content_hash 去重，防止相同失败原因无限堆积
  try {
    // 失败学习文本取 evidence 内真实 exit reason（如 never_started / process_disappeared / oom_killed），
    // 而非 requeue 通道参数（liveness_dead 是通道名，不是 exit reason 枚举值）——
    // 防 failure learning / capture atom 学习链被 liveness_dead 假根因标签污染（1dfa40f7）。
    // evidence 无 reason 时（如 watchdog 资源 kill 路径）回落通道参数，行为与现状一致。
    const rootCause = evidence?.reason || reason;
    const failureTitle = `Task Failure: ${taskTitle || taskId} [${rootCause}]`;
    const failureContent = `Watchdog killed task after ${retryCount} attempts. Reason: ${rootCause}`;
    const contentHash = crypto.createHash('sha256')
      .update(`${failureTitle}\n${failureContent}`)
      .digest('hex')
      .slice(0, 16);

    const existing = await pool.query(
      'SELECT id FROM learnings WHERE content_hash = $1 AND is_latest = true LIMIT 1',
      [contentHash]
    );

    if (existing.rows.length === 0) {
      const insertResult = await pool.query(`
        INSERT INTO learnings (title, category, trigger_event, content, metadata, content_hash, version, is_latest, digested, task_id, summary)
        VALUES ($1, 'failure_pattern', 'watchdog_kill', $2, $3, $4, 1, true, false, $5, $6)
        RETURNING id
      `, [
        failureTitle,
        failureContent,
        JSON.stringify({ task_id: taskId, task_type: task_type || null, project_id: project_id || null }),
        contentHash,
        taskId || null,
        generateL0Summary(`${failureTitle} ${failureContent}`),
      ]);
      // T10 统一收件箱：watchdog failure_pattern learning 落库后顺手进箱
      await pushCaptureAtom(pool, {
        content: `learning: ${failureTitle}\n${failureContent}`,
        targetType: 'learning',
        targetSubtype: 'failure_pattern',
        routedToTable: 'learnings',
        routedToId: insertResult?.rows?.[0]?.id,
      }).catch(err => console.warn('[executor] pushCaptureAtom failed:', err.message));
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
async function _ensurePromptDir() {
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
function generateRunId(_taskId) {
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
  if (isExternalWorkerTask({ task_type: taskType })) return null;
  if (isRetiredDevelopmentTask({ task_type: taskType, payload })) return null;
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


  return resolveTaskTypeSkill(taskType, EXECUTOR_SKILL_MAP) || '/dev';
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
  if (taskType === 'codex_qa' || taskType === 'codex_test_gen') return null;

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
 * 生成 Claude Code --settings prompt-based stop hook JSON。
 * @param {string|null} goalCondition
 * @returns {string|null} JSON 字符串；goalCondition 为空时返回 null
 */
function buildGoalSettings(goalCondition) {
  if (!goalCondition) return null;
  return JSON.stringify({
    hooks: {
      Stop: [{
        hooks: [{
          type: 'prompt',
          prompt: `Has the following goal been achieved based on the conversation? Goal: ${goalCondition}\n\nAnswer YES only if you can confirm from the conversation that the goal is met. Answer NO otherwise.`,
          model: 'claude-haiku-4-5-20251001'
        }]
      }]
    }
  });
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
    // 迁移：goals → objectives（area_okr type = objectives）
    const krResult = await pool.query(
      `SELECT title, end_date AS target_date, NULL::int AS time_budget_days FROM objectives WHERE id = $1
       UNION ALL
       SELECT title, end_date AS target_date, NULL::int AS time_budget_days FROM key_results WHERE id = $1
       LIMIT 1`,
      [krId]
    );
    const kr = krResult.rows[0];
    if (!kr) return '';

    // 2. KR 下所有 Projects（按 sequence_order 排列）
    // 时间预算存 projects.metadata；完成时间来自已完成子任务。
    const projResult = await pool.query(
      `SELECT op.id, op.name, op.status,
              op.metadata->>'sequence_order' AS sequence_order,
              op.metadata->>'time_budget_days' AS time_budget_days, op.created_at,
              (SELECT MAX(t.completed_at) FROM tasks t
               WHERE t.project_id = op.id AND t.task_type <> 'project' AND t.status = 'completed') AS completed_at
       FROM projects op
       WHERE op.kr_id = $1
       ORDER BY op.created_at ASC`,
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

  if (failureCount === 0 && !classification) return '';

  const parts = [
    _retryFailureBlock(classification, payload.watchdog_kill),
    _retryFeedbackBlock(task.feedback),
  ].filter(Boolean);

  if (parts.length === 0) return '';

  return _assembleRetryContext(failureCount, parts.join('\n\n'));
}

/** @returns {string|null} */
function _retryFailureBlock(classification, watchdogKill) {
  if (classification) {
    const cls = classification.class || 'unknown';
    const reason = classification.retry_strategy?.reason || watchdogKill?.reason || '';
    return `上次执行失败，原因分类：${cls}${reason ? `\n失败详情：${reason}` : ''}`;
  }
  if (watchdogKill?.reason) {
    return `上次执行被 Watchdog 终止：${watchdogKill.reason}`;
  }
  return null;
}

/** @returns {string|null} */
function _retryFeedbackBlock(feedback) {
  const feedbackArr = Array.isArray(feedback) ? feedback : [];
  const lastFeedback = feedbackArr[feedbackArr.length - 1];
  if (!lastFeedback) return null;

  const parts = [];
  if (lastFeedback.summary) {
    parts.push(`### 上次反馈摘要\n${lastFeedback.summary}`);
  }
  const issuesFound = lastFeedback.issues_found;
  if (Array.isArray(issuesFound) && issuesFound.length > 0) {
    parts.push(`### 发现的问题\n${issuesFound.map(i => `- ${i}`).join('\n')}`);
  } else if (typeof issuesFound === 'string' && issuesFound.trim()) {
    parts.push(`### 发现的问题\n${issuesFound}`);
  }
  return parts.length > 0 ? parts.join('\n\n') : null;
}

const MAX_RETRY_CONTEXT_LENGTH = 2000;

/** @returns {string} */
function _assembleRetryContext(failureCount, body) {
  const header = `\n\n## ⚠️ 重试上下文（第 ${failureCount} 次尝试）\n\n`;
  const footer = '\n\n请在本次执行中重点关注以上问题，避免重复失败。';
  let full = header + body + footer;
  if (full.length > MAX_RETRY_CONTEXT_LENGTH) {
    const allowedBody = MAX_RETRY_CONTEXT_LENGTH - header.length - footer.length - 12;
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

// ─── preparePrompt 子函数 ────────────────────────────────────────────────────

function _prepareProjectTaskDecomp(task, krId, krTitle, projectId) {
  const previousResult = task.payload?.previous_result || '';
  const revision = task.payload?.revision === true;
  const reviewSetup = [true, 'true'].includes(task.payload?.decomposition)
    ? `PATCH /api/brain/okr/key-results/${krId} 设置 {"status":"decomposing"}；保持该状态，完成回调自动送审。\n`
    : '';
  const completionStep = revision
    ? '根据审查意见修正拆解，并保留已有完成任务的证据；修正结果重新送审。'
    : `判断 Project 的成功标准是否已达成；已有证据达成时 PATCH /api/brain/projects/${projectId} 状态为 completed。`;
  return `/decomp

# 项目拆解: ${krTitle}

## 四层结构
Objective → Key Result → Project → Task

## 既有 Project
- Project ID: ${projectId}
- KR ID: ${krId}
- 目标: ${task.payload?.kr_goal || task.description || krTitle}
- 前一棒结果: ${previousResult || '(无)'}

## 执行
${reviewSetup}1. GET /api/brain/projects/${projectId}，核对项目简报与已完成子任务。
2. ${completionStep}
3. 未达成时只登记下一步可执行任务，避免重复已完成任务。

POST /api/brain/action/create-task
{
  "title": "下一步任务标题",
  "project_id": "${projectId}",
  "goal_id": "${krId}",
  "task_type": "dev",
  "prd_content": "完整 PRD（目标、方案、验收标准）",
  "payload": { "kr_goal": "${task.payload?.kr_goal || ''}" }
}

Task.project_id 必须指向上述 Project。`;
}

async function _prepareFirstDecomp(task, krId, krTitle) {
  const timeContext = await buildTimeContext(krId);
  return `/decomp

# OKR 拆解: ${krTitle}

## KR 信息
- KR ID: ${krId}
- 目标: ${task.description || krTitle}

${timeContext}

## 四层结构
Objective → Key Result → Project → Task

## 执行步骤
1. PATCH /api/brain/okr/key-results/${krId} 设置 {"status":"decomposing"}；GET /api/brain/projects?kr_id=${krId}，核对既有项目、简报和任务；已有项目覆盖本次目标时继续该项目。
2. 需要独立交付时创建 Project，并明确 KR 归属与项目目标。

POST /api/brain/action/create-project
{
  "name": "<KR 简短标题> 实现",
  "description": "${task.description || krTitle}",
  "kr_ids": ["${krId}"],
  "repo_path": "<任务上下文中的真实仓库路径>"
}

3. 确认复用或新建的 Project 后，先 PATCH /api/brain/tasks/${task.id} 设置 {"result":{"decomposition_project_id": "<选定 Project ID>"}}，保存本棒的显式产出归属；再直接拆成有序 Tasks，Task.goal_id 绑定当前 KR。

POST /api/brain/action/create-task
{
  "title": "实现 [功能]",
  "project_id": "<Project ID>",
  "goal_id": "${krId}",
  "task_type": "dev",
  "prd_content": "完整 PRD（目标、方案、验收标准）",
  "payload": { "kr_goal": "${task.description || ''}" }
}

4. 保持 KR 的 decomposing 状态；完成回调自动送审并更新为 reviewing，确认通过后继续执行。

## 验收
- Project.kr_id = 当前 KR；Project 有明确目标与验收标准。
- Tasks 的 project_id = Project ID，goal_id = 当前 KR。
- 核对已有完成项，避免重复登记；逐棒完成留下 handoff。`;
}

async function _prepareDecompositionPrompt(task) {
  const krId = task.goal_id || task.payload?.kr_id || '';
  const krTitle = task.title?.replace(/^(OKR 拆解|拆解|继续拆解)[：:]\s*/, '') || '';
  const projectId = task.project_id || task.payload?.project_id
    || (task.payload?.entity_type === 'project' ? task.payload?.entity_id : '') || '';
  if (projectId) return _prepareProjectTaskDecomp(task, krId, krTitle, projectId);
  return _prepareFirstDecomp(task, krId, krTitle);
}

async function _prepareScopePlanPrompt(task) {
  const formatHint = [
    '\n\n## 输出格式要求',
    '用结构化 Markdown 输出。每个 Task：',
    '### Task N：名称',
    '| 维度 | 内容 |',
    '|------|------|',
    '| **功能边界** | 只做什么、不碰什么 |',
    '| **交付物** | 具体产出清单 |',
    '| **SPIDR-S** | Spike 策略 |',
    '| **SPIDR-P** | Path 切割 |',
    '| **SPIDR-I** | Interface 版本 |',
    '| **SPIDR-D** | Data 范围 |',
    '| **SPIDR-R** | Rules 渐进 |',
  ].join('\n');
  return `${await _prepareDecompositionPrompt(task)}\n${formatHint}`;
}

async function _prepareProjectPlanPrompt(task) {
  const formatHint = [
    '\n\n## 输出格式要求',
    '用结构化 Markdown 输出。每个 Task：',
    '### Task N：名称',
    '| 维度 | 内容 |',
    '|------|------|',
    '| **功能边界** | 只处理什么、不碰什么 |',
    '| **交付物** | 具体产出清单 |',
    '| **完成条件** | 可验证的验收标准 |',
    '| **SPIDR-S** | Spike 策略 |',
    '| **SPIDR-P** | Path 切割 |',
    '| **SPIDR-I** | Interface 版本 |',
    '| **SPIDR-D** | Data 范围 |',
    '| **SPIDR-R** | Rules 渐进 |',
    '',
    '最后加总结表：',
    '| Task | 对应成功标准 | 预计天数 | 执行顺序 |',
    '|-------|------------|---------|---------|',
  ].join('\n');
  return `${await _prepareDecompositionPrompt({ ...task, project_id: task.project_id || task.payload?.entity_id || task.payload?.project_id })}\n${formatHint}`;
}

function _prepareSpecReviewPrompt(task) {
  // payload.branch 优先，兼容 metadata.branch（两种派发方式）
  const branch = task.payload?.branch || task.metadata?.branch || '';
  let taskCardContent = task.description || task.title || '';
  if (branch) {
    const worktreeSlug = branch.replace(/^cp-\d{8}-/, '');
    const taskCardPath = path.join(WORK_DIR, '.claude/worktrees', worktreeSlug, `.task-${branch}.md`);
    try {
      taskCardContent = readFileSync(taskCardPath, 'utf-8');
    } catch {
      // 降级使用 task.description（description 中已含 Task Card 内容时也有效）
    }
  }
  return `/spec-review\n\n${taskCardContent}`;
}

function _prepareCodeReviewGatePrompt(task) {
  // payload.branch 优先，兼容 metadata.branch
  const branch = task.payload?.branch || task.metadata?.branch || '';
  let diffContent = '';
  if (branch) {
    const worktreeSlug = branch.replace(/^cp-\d{8}-/, '');
    const worktreePath = path.join(WORK_DIR, '.claude/worktrees', worktreeSlug);
    try {
      // 用 origin/main..HEAD 确保拿到完整的分支改动（不含 origin/main 本身）
      diffContent = execSync('git diff origin/main..HEAD', {
        cwd: worktreePath,
        encoding: 'utf-8',
        timeout: 15000,
      });
    } catch {
      // ignore diff errors
    }
  }
  const basePrompt = task.description || task.title || '';
  return diffContent
    ? `/code-review-gate\n\n${basePrompt}\n\n## Git Diff\n\`\`\`diff\n${diffContent}\n\`\`\``
    : `/code-review-gate\n\n${basePrompt}`;
}

function _prepareTalkPrompt(task) {
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

function _prepareCodeReviewArgs(task) {
  const repoPath = task.payload?.repo_path || '';
  const since = task.payload?.since_hours ? `--since=${task.payload.since_hours}h` : '';
  return `/code-review ${repoPath} ${since}`.trim();
}

function _prepareResearchPrompt(task) {
  if (task.payload?.invocation) return invocationTaskPrompt(task, task.payload.invocation.dispatch?.run_id ?? task.payload.current_run_id);
  return `请调研以下内容，只读取和分析，不要修改任何文件：

# ${task.title}

${task.description || ''}

权限约束：
- ✅ 可以读取代码/文档/日志
- ✅ 输出调研结果和建议
- ❌ 不能创建、修改或删除任何文件`;
}

async function _prepareDefaultPrompt(task, skill) {
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

  const domain = task.domain || null;
  const ownerRole = task.owner_role || null;
  const domainCtx = (domain || ownerRole)
    ? `\n## 业务领域上下文\n任务所属领域：${domain || '(未指定)'}\n负责角色：${ownerRole || '(未指定)'}\n`
    : '';

  const prd = `# PRD - ${task.title}

## 背景
任务来自 Brain 自动调度。
任务类型：${task.task_type || 'dev'}
${domainCtx}
## 功能描述
${task.description || task.title}

## 成功标准
- [ ] 任务完成
`;

  return `${skill}\n\n${sysCtx}${prd}${learningCtx}${retryCtx}`;
}

function _prepareStrategistDecisionPrompt(task) {
  const skillContent = loadSkillContent('line-strategist');
  const payload = task.payload || {};
  const paramsBlock = `## Line 军师决策任务

LINE_ID: ${payload.journey_id || ''}
TRIGGER: ${payload.trigger || 'manual'}
TRIGGER_CONTEXT: ${JSON.stringify(payload.trigger_context || {})}
BRAIN_TASK_ID: ${task.id}
DRY_RUN: false

${task.description || task.title}`;

  return [
    '你是 line-strategist session。按下面 SKILL 指令完成一次决策。',
    '',
    skillContent,
    '',
    '---',
    '',
    paramsBlock,
  ].join('\n');
}

function _prepareCiPatrolPrompt(task) {
  // 容器内 headless claude -p 不展开 slash command，
  // 裸 /ci-patrol 会让巡检 agent 零 SKILL 指令即兴发挥——日报只留 stdout、notes/棘轮全丢、任务假 completed。
  const skillContent = loadSkillContent('ci-patrol');
  const payload = task.payload || {};
  const paramsBlock = `## CI/CD 巡检任务

BRAIN_TASK_ID: ${task.id}
DATE: ${payload.date || ''}
TRIGGER: ${payload.trigger || 'manual'}

${task.description || task.title}`;

  return [
    '你是 ci-patrol 巡检员 session。按下面 SKILL 指令完成一次巡检。',
    '',
    skillContent,
    '',
    '---',
    '',
    paramsBlock,
  ].join('\n');
}

function _prepareInitiativePlanPrompt(t) {
  return _prepareDecompositionPrompt(t);
}

function _prepareInitiativeVerifyPrompt(t) {
  return `/architect verify --initiative-id ${t.project_id || t.payload?.initiative_id || ''}\n\n${t.description || t.title}`;
}

function _prepareArchitectureDesignPrompt(t) {
  return `/architect\n\n${t.description || t.title}`;
}

function _prepareDecompReviewPrompt(t) {
  return `/decomp-check\n\n${t.description || t.title}`;
}

function _preparePrdReviewPrompt(t) {
  return `/prd-review\n\n${t.description || t.title}`;
}

function _prepareInitiativeReviewPrompt(t) {
  return `/initiative-review --phase ${t.payload?.phase || 1} --initiative-id ${t.project_id || t.payload?.initiative_id || ''}\n\n${t.description || t.title}`;
}

const _DECOMP_TYPES = new Set(['true', 'continue']);

// 路由表：taskType → handler（模块级常量，避免每次调用重建）
const _TASK_ROUTES = {
  initiative_plan:          _prepareInitiativePlanPrompt,
  scope_plan:               _prepareScopePlanPrompt,
  project_plan:             _prepareProjectPlanPrompt,
  initiative_verify:        _prepareInitiativeVerifyPrompt,
  architecture_design:      _prepareArchitectureDesignPrompt,
  decomp_review:            _prepareDecompReviewPrompt,
  prd_review:               _preparePrdReviewPrompt,
  spec_review:              _prepareSpecReviewPrompt,
  code_review_gate:         _prepareCodeReviewGatePrompt,
  initiative_review:        _prepareInitiativeReviewPrompt,
  talk:                     _prepareTalkPrompt,
  review:                   _prepareCodeReviewArgs,
  qa:                       _prepareCodeReviewArgs,
  audit:                    _prepareCodeReviewArgs,
  research:                 _prepareResearchPrompt,
  code_review:              _prepareCodeReviewArgs,
  strategist_decision:      _prepareStrategistDecisionPrompt,
  ci_patrol:                _prepareCiPatrolPrompt,
};

// ─── preparePrompt 主入口（dispatcher）────────────────────────────────────────

async function preparePrompt(task) {
  const taskType = task.task_type || 'dev';
  // skill_override 最优先（不碰库）；否则先刷新 skill_registry 快照（TTL 内零查库、失败开放）再解析。
  const skill = arguments.length > 1 ? arguments[1] : await resolveSkillWithLedger(pool, { ...task, task_type: taskType }, getSkillForTaskType);

  if (_DECOMP_TYPES.has(task.payload?.decomposition)) return _prepareDecompositionPrompt(task);

  const handler = _TASK_ROUTES[taskType];
  if (handler) return handler(task);

  return _prepareDefaultPrompt(task, skill);
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
 * 触发本机 Codex CLI 执行审查任务（spec_review / code_review_gate / prd_review / initiative_review）。
 * 使用独立锁池 /tmp/codex-review-locks/（MAX=2），不占动态派发槽位。
 *
 * @param {Object} task - The task object from database
 * @returns {Object} - { success, taskId, runId, error? }
 */
async function triggerCodexReview(task) {
  assertExternalExecutionAllowed();
  if (isRetiredDecomposition(task)) return { success: false, taskId: task?.id, reason: RETIRED_DECOMPOSITION, retiredBeforeStart: true };
  // 仅手动入口可提供已绑定任务行的计划；无计划的既有自动调用保留原解析。
  const manualSkillPlan=consumeReviewSkill(task);
  const runId = generateRunId(task.id);

  try {
    // 检查独立 codex review 池槽位
    await mkdir(CODEX_REVIEW_LOCK_DIR, { recursive: true });
    const lockFiles = readdirSync(CODEX_REVIEW_LOCK_DIR).filter(f => f.endsWith('.lock'));
    if (lockFiles.length >= CODEX_REVIEW_MAX) {
      console.log(`[executor] codex-review-locks pool full (${lockFiles.length}/${CODEX_REVIEW_MAX}), deferring task=${task.id}`);
      return {
        success: false,
        taskId: task.id,
        reason: 'codex_review_pool_full',
        detail: `codex-review-locks pool full (${lockFiles.length}/${CODEX_REVIEW_MAX})`,
      };
    }

    // 获取 prompt 内容
    const promptContent = manualSkillPlan.found ? await preparePrompt(task,manualSkillPlan.skill) : await preparePrompt(task);

    // 动态账本可能仍绑定退役命令；以最终实际提示词判定，避免二次解析出现漂移。
    // 明确标记尚未启动，让调用方按本次认领和设备锁版本处理。
    if ((task.task_type === 'architecture_scan' || task.task_type === 'arch_review') &&
        /^\s*\/decomp(?:-check)?(?=\s|$)/.test(promptContent)) {
      return { success: false, taskId: task.id, reason: RETIRED_DECOMPOSITION, retiredBeforeStart: true };
    }

    // 写 prompt 文件
    await mkdir(PROMPT_DIR, { recursive: true });
    const promptFile = path.join(PROMPT_DIR, `codex-review-${task.id}.txt`);
    await writeFile(promptFile, promptContent);

    // 获取锁文件（标记槽位占用）
    const lockFile = path.join(CODEX_REVIEW_LOCK_DIR, `${task.id}.lock`);
    await writeFile(lockFile, JSON.stringify({ taskId: task.id, runId, startedAt: new Date().toISOString() }));

    // liveness 打标：合同层由 codex-review-local 合同以 lock 文件探活（决策 9befa9c3）
    try { await setExecutorKind(task.id, 'codex-review-local'); } catch { /* 打标失败不阻塞派发 */ }

    console.log(`[executor] triggerCodexReview: 使用本机 codex CLI task=${task.id} type=${task.task_type}`);

    // 派发到本机 codex CLI（容器内默认 /usr/local/bin/codex，host fallback /opt/homebrew/bin/codex）
    // 使用 codex exec 非交互模式，prompt 通过 stdin 传入（避免 shell 转义问题）
    const codexBin = process.env.CODEX_BIN || '/opt/homebrew/bin/codex';

    // 预检 codex binary 是否存在 — 容器漏装 codex CLI 时返回 configError，不发 FAIL callback、
    // 不让 dispatcher 累积 cecelia-run breaker failures（生产事故：failures=351 OPEN 阻断所有 dispatch）。
    try {
      await access(codexBin);
    } catch (accessErr) {
      console.error(`[executor] triggerCodexReview: codex binary not accessible at ${codexBin}: ${accessErr.code || accessErr.message}`);
      // 清理已写入的 lockFile（spawn 未启动 → 槽位归还）
      try { unlinkSync(lockFile); } catch {}
      return {
        success: false,
        configError: true,
        taskId: task.id,
        reason: 'codex_binary_missing',
        error: `codex binary not found at ${codexBin} (set CODEX_BIN env or install @openai/codex)`,
        executor: 'codex-review',
      };
    }

    const child = await withLegacyRelayExecution({pool,location:os.hostname(),provider:'codex',credentialIdentity:process.env.CODEX_HOME,repo:task.payload?.repo??task.repo_hint},()=>spawn(codexBin, ['exec', '-c', 'approval_policy="never"', promptContent], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: WORK_DIR,
      env: { ...process.env, TASK_ID: task.id, RUN_ID: runId, BRAIN_URL: process.env.BRAIN_URL || 'http://localhost:5221' },
    }));

    // 收集 stdout，解析审查结果后回调 Brain
    let stdout = '';
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += d.toString(); });

    child.on('error', async (err) => {
      console.error(`[executor] codex spawn error: ${err.message} task=${task.id}`);
      try { unlinkSync(lockFile); } catch {}
      try {
        const brainUrl = process.env.BRAIN_URL || 'http://localhost:5221';
        await fetch(`${brainUrl}/api/brain/execution-callback`, {
          method: 'POST',
          headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            task_id: task.id,
            run_id: runId,
            status: 'AI Failed',
            result: { verdict: 'FAIL', summary: `codex binary not found: ${err.message}` },
            coding_type: 'codex-review',
          }),
        });
      } catch (cbErr) {
        console.error(`[executor] codex spawn callback error: ${cbErr.message}`);
      }
    });

    child.on('exit', async (code) => {
      try { unlinkSync(lockFile); } catch {}
      console.log(`[executor] codex review exit code=${code} task=${task.id}`);

      // 环境级致命错误（config 不兼容/CLI 版本过旧/trust 拒绝）→ 不发 AI Failed callback
      // （callback_queue 无记录，inline 与 worker 两条链都不会烧任务），安全回队 + 响亮告警。
      // 对齐 dispatcher pre-spawn configError 语义（回队+不计熔断），补上告警与回队上限。
      const fatal = code === 0 ? null : classifyCodexFailure(stdout, stderr);
      if (fatal) {
        try {
          const summary = (stderr || stdout).slice(-300).replace(/\s+/g, ' ').trim();
          const countRes = await pool.query(
            `SELECT COALESCE((payload->>'codex_config_error_count')::int, 0) AS n FROM tasks WHERE id = $1`,
            [task.id]
          );
          const n = (countRes.rows[0]?.n ?? 0) + 1;
          if (n < 3) {
            await pool.query(
              `UPDATE tasks
                 SET status = 'queued', claimed_by = NULL, claimed_at = NULL,
                     payload = (COALESCE(payload, '{}'::jsonb) - 'run_status')
                               || jsonb_build_object('codex_config_error_count', $2::int),
                     updated_at = NOW()
               WHERE id = $1 AND status IN ('in_progress','dispatched')`,
              [task.id, n]
            );
            raise('P1', 'codex_config_error', `codex 环境错误(${fatal.reason})，任务安全回队(${n}/3)：task=${task.id} ${summary}`);
          } else {
            await pool.query(
              `UPDATE tasks
                 SET status = 'blocked',
                     blocked_at = NOW(), blocked_reason = 'codex_config_error',
                     claimed_by = NULL, claimed_at = NULL,
                     payload = (COALESCE(payload, '{}'::jsonb) - 'run_status')
                               || jsonb_build_object('codex_config_error_count', $2::int),
                     updated_at = NOW()
               WHERE id = $1 AND status IN ('in_progress','dispatched')`,
              [task.id, n]
            );
            raise('P0', 'codex_config_error', `codex 环境错误连续${n}次(${fatal.reason})，任务已 blocked 待人工：task=${task.id} ${summary}`);
          }
          console.error(`[executor] codex configError: reason=${fatal.reason} task=${task.id} count=${n}`);
        } catch (cfgErr) {
          console.error(`[executor] codex configError 处理自身失败: ${cfgErr.message} task=${task.id}`);
        }
        return;
      }

      // 尝试从输出中提取 JSON verdict 并回调 Brain
      try {
        const jsonMatch = stdout.match(/\{[\s\S]*"verdict"\s*:\s*"(PASS|FAIL)"[\s\S]*\}/);
        const verdict = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        const brainUrl = process.env.BRAIN_URL || 'http://localhost:5221';
        const payload = {
          task_id: task.id,
          run_id: runId,
          status: code === 0 ? 'AI Done' : 'AI Failed',
          result: verdict || { verdict: code === 0 ? 'PASS' : 'FAIL', summary: stdout.slice(-500) },
          coding_type: 'codex-review',
        };
        await fetch(`${brainUrl}/api/brain/execution-callback`, {
          method: 'POST',
          headers: internalServiceHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload),
        });
        console.log(`[executor] codex review callback sent verdict=${payload.result?.verdict} task=${task.id}`);
      } catch (cbErr) {
        console.error(`[executor] codex review callback error: ${cbErr.message}`);
      }
    });

    child.unref();

    return {
      success: true,
      taskId: task.id,
      runId,
      executor: 'codex-review',
    };
  } catch (err) {
    console.error(`[executor] triggerCodexReview error: ${err.message}`);
    return {
      success: false,
      taskId: task.id,
      error: err.message,
      executor: 'codex-review',
    };
  }
}

/**
 * 从美国 M4 本地 auth.json 选出额度最低的 Codex 账号，用于注入到 Xi'an bridge。
 * 读取 ~/.codex-team{1-5}/auth.json，并发查询 wham/usage，按 5h 使用率升序排序。
 *
 * @param {number} maxAccounts - 最多返回账号数，默认 3
 * @returns {Promise<Array<{id: string, auth: object}>>}
 */
export async function pickLocalAccountByDeficit(maxAccounts = 3) {
  const teams = ['team1', 'team2', 'team3', 'team4', 'team5'];
  const results = await Promise.all(teams.map(async (id) => {
    try {
      const authPath = path.join(os.homedir(), `.codex-${id}`, 'auth.json');
      const auth = JSON.parse(readFileSync(authPath, 'utf8'));
      const token = auth.tokens?.access_token;
      const accountId = auth.tokens?.account_id;
      if (!token) return null;

      const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'ChatGPT-Account-Id': accountId,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const fiveHourPct = data.rate_limit?.primary_window?.used_percent ?? 100;
      // 5h gate：超过 95% 直接跳过
      if (fiveHourPct > 95) return null;
      const sw = data.rate_limit?.secondary_window;
      const sevenDayPct = sw?.used_percent ?? 0;
      const resetAfterSecs = sw?.reset_after_seconds ?? 0;
      // 进度对齐（deficit）：已过时间占比 - 实际使用率，值越大越落后于目标
      const SEVEN_DAY_SECS = 7 * 24 * 3600;
      const elapsedSecs = SEVEN_DAY_SECS - resetAfterSecs;
      const targetPct = (elapsedSecs / SEVEN_DAY_SECS) * 100;
      const deficit = targetPct - sevenDayPct;
      return { id, auth, fiveHourPct, deficit };
    } catch {
      return null;
    }
  }));

  return results
    .filter(Boolean)
    // deficit DESC（最落后先用）；同 deficit 时 5h 用量 ASC
    .sort((a, b) => b.deficit - a.deficit || a.fiveHourPct - b.fiveHourPct)
    .slice(0, maxAccounts)
    .map(({ id, auth }) => ({ id, auth }));
}

/** Build prompt with decisions summary injection for Codex tasks. */
async function buildCodexPromptContent(task, runId) {
  const fixedInvocationPrompt = invocationTaskPrompt(task, runId);
  if (fixedInvocationPrompt) return fixedInvocationPrompt;
  let promptContent = task.description || task.title || '请执行此任务';
  try {
    const decisionsSummary = await getDecisionsSummary();
    if (decisionsSummary) {
      promptContent = `${decisionsSummary}\n\n---\n\n${promptContent}`;
    }
  } catch (err) {
    console.warn(`[executor] codex decisions 注入失败（不阻塞）: ${err.message}`);
  }
  return promptContent;
}

/** Generate branch name for codex_dev tasks (-cx suffix to distinguish from Claude Code branches). */
function buildCodexTaskBranch(task, isCodexDev) {
  if (task.payload?.branch) return task.payload.branch;
  if (!isCodexDev) return undefined;
  const dateStr = new Date().toISOString().replace(/[-T:]/g, '').slice(2, 12);
  return `cp-${dateStr}-${task.id.slice(0, 8)}-cx`;
}

/** Assemble the full request body for the Codex Bridge /run endpoint. */
function buildCodexBridgePayload(task, runId, promptContent, taskBranch, injectedAccounts) {
  const brainUrl = process.env.BRAIN_URL || 'http://localhost:5221';
  return {
    task_id: task.id,
    run_id: runId,
    checkpoint_id: null,
    prompt: promptContent,
    task_type: task.task_type,
    base_repo: task.payload?.base_repo || 'perfectuser21/cecelia',
    timeout_ms: 10 * 60 * 1000,
    branch: taskBranch,
    accounts: injectedAccounts.length > 0 ? injectedAccounts : undefined,
    callback_url: `${brainUrl}/api/brain/execution-callback`,
  };
}

/** Select best accounts from US local Brain; falls back to empty (Xi'an selects locally). */
async function selectCodexAccounts() {
  try {
    const accounts = await pickLocalAccountByDeficit(3);
    if (accounts.length > 0) {
      console.log(`[executor] 账号注入: ${accounts.map(a => a.id).join(', ')}`);
      return accounts;
    }
    console.warn('[executor] 账号注入失败（全部查询失败），降级到 Xi\'an 本地选账号');
    return [];
  } catch (err) {
    console.warn(`[executor] 账号选择异常（降级）: ${err.message}`);
    return [];
  }
}

/**
 * Trigger 西安 Mac mini Codex Bridge for a task.
 * Routes codex_qa / codex_dev (and any task with provider=codex) to the Xian Codex CLI.
 *
 * codex_qa  → prompt 模式：将 task description 作为 prompt 直接传给 codex-bin exec
 * codex_dev → Bridge 根据 task_type 启动 Brain 自有 legacy Codex runner。
 *
 * @param {Object} task - The task object from database
 * @returns {Object} - { success, taskId, runId, error? }
 */
async function triggerCodexBridge(task, forceBridgeUrl = null) {
  assertExternalExecutionAllowed();
  if (isRetiredDecomposition(task)) return { success: false, taskId: task?.id, reason: RETIRED_DECOMPOSITION, retiredBeforeStart: true };
  if(task.payload?.invocation_activity)return {success:true,taskId:task.id,runId:task.payload.invocation_activity.child_run_id,executor:'shared-activity-runner',dispatchUncertain:true};
  const runId = generateRunId(task.id);
  try {
    const isCodexDev = task.task_type === 'codex_dev';

    console.log(`[executor] Calling Xian Codex Bridge for task=${task.id} type=${task.task_type}${forceBridgeUrl ? ` (pinned: ${forceBridgeUrl})` : ''}`);

    const invocationDispatch = await prepareInvocationDispatch(pool, task, runId);
    if (invocationDispatch?.already) return { success: true, taskId: task.id, runId: invocationDispatch.runId, executor: 'codex-bridge', dispatchUncertain: true };
    if (invocationDispatch) {
      const runInfo=await updateTaskRunInfo(task.id,runId,'triggered');
      if(!runInfo.success)return {success:false,taskId:task.id,runId,error:runInfo.error,executor:'shared-activity-runner'};
      const bridgeUrl=forceBridgeUrl??await selectBestBridge();
      const accounts=await selectCodexAccounts();
      const executeSkill=createInvocationActivityExecutor(pool,{task,runId,submitActivity:async child=>{
        const response=await withLegacyExecution({pool,provider:'codex',endpoint:bridgeUrl},()=>fetch(`${bridgeUrl}/run`,{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...buildCodexBridgePayload({id:child.task_id,task_type:'research',payload:{}},child.run_id,child.prompt,undefined,accounts),timeout_ms:child.timeout_ms}),signal:AbortSignal.timeout(15000)}));
        const value=await response.json();if(!response.ok||!value.ok)throw Error('invocation_activity_dispatch_unconfirmed');return value;
      }});
      // 独立异步Runner持有原run；Agent子callback仅能结束子task。崩溃后预留守卫禁止整包重发。
      const invocationController=runInvocationActivities(pool,task,runId,{executeSkill}).then(async outcome=>{
        if(!outcome.receipt)throw Error(outcome.runtime.reason_code??'invocation_needs_review');
        const callbackBody={task_id:task.id,run_id:runId,status:'AI Done',result:{result:JSON.stringify(outcome.receipt)}};
        const receiptSha256=crypto.createHash('sha256').update(JSON.stringify(callbackBody)).digest('hex');
        const response=await fetch(`${process.env.BRAIN_URL||'http://localhost:5221'}/api/brain/execution-callback`,{
          method:'POST',headers:internalServiceHeaders({'Content-Type':'application/json'}),body:JSON.stringify(callbackBody),signal:AbortSignal.timeout(15000)});
        if(!response.ok){
          let receipt;
          try { receipt=await response.json(); } catch { /* not a confirmed queue receipt */ }
          if(response.status===503 && receipt?.success===false && receipt?.queued===true
            && receipt?.code==='TASK_COMPLETION_GUARD_UNAVAILABLE' && receipt?.task_id===task.id
            && typeof runId==='string' && runId.length>0 && receipt?.run_id===runId
            && receipt?.callback_status===callbackBody.status && receipt?.receipt_sha256===receiptSha256) return {pending:true};
          throw Error('invocation_completion_callback_unconfirmed');
        }
      }).catch(async error=>{
        await pool.query("UPDATE tasks SET status='blocked',blocked_at=NOW(),blocked_reason='needs_review',blocked_detail=$3::jsonb,updated_at=NOW() WHERE id=$1 AND payload->>'current_run_id'=$2 AND status IN ('in_progress','dispatched')",[task.id,runId,JSON.stringify({reason:error.message,actor:'shared-runner'})]);
        await finishInvocationRun({taskId:task.id,runId,status:'failed',result:{stage:'needs_review'}},{pool});
      }).catch(error=>console.error('[invocation-runner] record failed:',error.message));
      activeProcesses.set(task.id,{pid:null,runId,startedAt:new Date().toISOString(),source:'shared-activity-runner',invocationController});
      void invocationController.finally(()=>{
        if(activeProcesses.get(task.id)?.invocationController===invocationController)activeProcesses.delete(task.id);
      });
      return {success:true,taskId:task.id,runId,executor:'shared-activity-runner'};
    }
    const promptContent = await buildCodexPromptContent(task, runId);
    const taskBranch = buildCodexTaskBranch(task, isCodexDev);
    const injectedAccounts = await selectCodexAccounts();

    const runInfo = await updateTaskRunInfo(task.id, runId, 'triggered');
    if (!runInfo.success) {
      return { success: false, taskId: task.id, runId, error: runInfo.error, executor: 'codex-bridge' };
    }

    const bridgeUrl = forceBridgeUrl ?? await selectBestBridge();
    const payload = buildCodexBridgePayload(task, runId, promptContent, taskBranch, injectedAccounts);
    const response = await withLegacyExecution({pool,provider:'codex',endpoint:bridgeUrl},()=>fetch(`${bridgeUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    }));

    const result = await response.json();

    if (!result.ok) {
      console.log(`[executor] Codex Bridge rejected: ${result.error}`);
      return { success: false, taskId: task.id, runId, error: result.error, executor: 'codex-bridge' };
    }

    console.log(`[executor] Codex Bridge accepted task=${task.id} account=${result.account}`);
    return { success: true, taskId: task.id, runId, executor: 'codex-bridge', account: result.account };
  } catch (err) {
    console.error(`[executor] Codex Bridge error: ${err.message}`);
    return { success: false, taskId: task.id, runId, error: err.message, executor: 'codex-bridge' };
  }
}

/**
 * Trigger HK MiniMax executor for a task
 * @param {Object} task - The task object from database
 * @returns {Object} - { success, taskId, result?, error? }
 */
async function triggerMiniMaxExecutor(task) {
  assertExternalExecutionAllowed();
  if (isRetiredDecomposition(task)) return { success: false, taskId: task?.id, reason: RETIRED_DECOMPOSITION, retiredBeforeStart: true };
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

// ============================================================
// Local Codex CLI executor（spec_review / code_review_gate 专用）
// ============================================================
// 独立 /tmp/codex-review-locks 池（固定 2-slot），使用 codex-bin exec 执行。
// 不走 cecelia-bridge，不占用 cecelia-run 的 10-slot 池。
// prompt 携带完整 Task Card + git diff，帮助审查 agent 了解变更上下文。
// ============================================================

const REVIEW_LOCK_DIR = '/tmp/codex-review-locks';
const MAX_REVIEW_SLOTS = 2;

/**
 * Trigger local Codex CLI for spec_review / code_review_gate.
 * Uses separate /tmp/codex-review-locks pool (max 2 slots).
 * Spawns codex-bin exec with full Task Card + git diff prompt.
 * @param {Object} task
 * @returns {Object} { success, taskId, runId, executor }
 */
async function triggerLocalCodexExec(task) {
  const CODEX_BIN = process.env.CODEX_BIN || '/opt/homebrew/bin/codex-bin';
  const CODEX_HOME = process.env.CODEX_REVIEW_HOME || process.env.CODEX_HOME || '';
  const CODEX_MODEL = process.env.CODEX_REVIEW_MODEL || process.env.CODEX_MODEL || 'gpt-5.4';
  const REPO_ROOT = process.env.CECELIA_WORK_DIR || '/Users/administrator/perfect21/cecelia';
  const WEBHOOK_URL = process.env.CECELIA_WEBHOOK_URL || 'http://localhost:5221/api/brain/execution-callback';
  const runId = generateRunId(task.id);

  try {
    console.log(`[executor] Local Codex CLI for task=${task.id} type=${task.task_type}`);

    // --- Acquire review slot (atomic mkdir) ---
    await mkdir(REVIEW_LOCK_DIR, { recursive: true });
    let slotPath = null;
    for (let i = 1; i <= MAX_REVIEW_SLOTS; i++) {
      const candidate = path.join(REVIEW_LOCK_DIR, `slot-${i}`);
      try {
        execSync(`mkdir "${candidate}"`, { stdio: 'pipe' });
        slotPath = candidate;
        break;
      } catch {
        // slot occupied, try next
      }
    }
    if (!slotPath) {
      console.log(`[executor] Review slots full (max=${MAX_REVIEW_SLOTS}), requeueing task=${task.id}`);
      return { success: false, taskId: task.id, error: 'review_slots_full', executor: 'local-codex' };
    }

    // Write slot info
    writeFile(path.join(slotPath, 'info.json'), JSON.stringify({
      task_id: task.id, pid: process.pid,
      started: new Date().toISOString(), type: task.task_type,
    })).catch(() => {});

    // --- Build rich prompt (Task Card + git diff) ---
    const branch = task.metadata?.branch || (task.title || '').replace(/^(Spec|Code) Review:\s*/, '').trim();
    let taskCardContent = '';
    let gitDiff = '';

    if (branch) {
      try {
        const worktreeList = execSync(
          `git -C "${REPO_ROOT}" worktree list --porcelain 2>/dev/null`,
          { encoding: 'utf8' }
        );
        const wtLines = worktreeList.split('\n');
        let currentWtPath = '';
        let foundWtPath = '';
        for (const line of wtLines) {
          if (line.startsWith('worktree ')) { currentWtPath = line.slice('worktree '.length).trim(); }
          else if (line.startsWith('branch refs/heads/') && line.includes(branch)) {
            foundWtPath = currentWtPath; break;
          }
        }
        if (foundWtPath) {
          const taskCardPath = path.join(foundWtPath, `.task-${branch}.md`);
          try { taskCardContent = readFileSync(taskCardPath, 'utf8'); } catch { /* no task card yet */ }
          try {
            gitDiff = execSync(
              `git -C "${foundWtPath}" diff origin/main..HEAD 2>/dev/null || git -C "${foundWtPath}" diff HEAD~1..HEAD 2>/dev/null || true`,
              { encoding: 'utf8', maxBuffer: 512 * 1024 }
            );
          } catch { /* no diff */ }
        }
      } catch (err) {
        console.warn(`[executor] Worktree lookup failed for branch ${branch}: ${err.message}`);
      }
    }

    const skill = task.task_type === 'spec_review' ? '/spec-review' : '/code-review-gate';
    let promptContent = `${skill}\n\n## 任务信息\n${task.description || task.title || ''}\n\n`;
    if (taskCardContent) {
      promptContent += `## Task Card 内容\n\`\`\`markdown\n${taskCardContent}\n\`\`\`\n\n`;
    }
    if (gitDiff) {
      promptContent += `## Git Diff (main..HEAD)\n\`\`\`diff\n${gitDiff.slice(0, 30000)}\n\`\`\`\n\n`;
    }

    // --- Write prompt to temp file, spawn codex-bin via shell script ---
    const tmpPromptFile = `/tmp/codex-review-prompt-${task.id}.txt`;
    const tmpScriptFile = `/tmp/codex-review-runner-${task.id}.sh`;
    await writeFile(tmpPromptFile, promptContent);
    const scriptContent = [
      '#!/bin/bash',
      `CODEX_HOME="${CODEX_HOME}" "${CODEX_BIN}" exec --model "${CODEX_MODEL}" --sandbox danger-full-access "$(cat '${tmpPromptFile}')" 2>&1`,
      'EXIT=$?',
      `rm -f "${tmpPromptFile}" 2>/dev/null; rm -rf "${slotPath}" 2>/dev/null; rm -f "${tmpScriptFile}" 2>/dev/null`,
      `curl -s -X POST "${WEBHOOK_URL}" -H "Content-Type: application/json" \${CECELIA_INTERNAL_TOKEN:+-H "Authorization: Bearer $CECELIA_INTERNAL_TOKEN"} \\`,
      `  -d "{\\"task_id\\":\\"${task.id}\\",\\"run_id\\":\\"${runId}\\",\\"status\\":\\"AI Done\\",\\"exit_code\\":$EXIT}" \\`,
      '  --max-time 10 2>/dev/null || true',
    ].join('\n');
    await writeFile(tmpScriptFile, scriptContent, { mode: 0o755 });

    const proc = await withLegacyRelayExecution({pool,location:os.hostname(),provider:'codex',credentialIdentity:CODEX_HOME,repo:task.payload?.repo??task.repo_hint},()=>spawn('bash', [tmpScriptFile], { detached: true, stdio: 'ignore' }));
    proc.unref();
    // 打标：本地 codex-bin spawn → brain-local
    await setExecutorKind(task.id, EXECUTOR_KIND_FOR.__local_spawn);

    console.log(`[executor] Local Codex spawned task=${task.id} pid=${proc.pid} slot=${path.basename(slotPath)}`);
    return { success: true, taskId: task.id, runId, executor: 'local-codex', pid: proc.pid };
  } catch (err) {
    console.error(`[executor] Local Codex error for task=${task.id}: ${err.message}`);
    return { success: false, taskId: task.id, error: err.message, executor: 'local-codex' };
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
// 路由规则（v2.3 — 以 task-router.js LOCATION_MAP 为唯一 SSOT）：
//   location='hk'   → HK MiniMax
//   location='xian' → 西安 Codex Bridge
//   us + spec_review/code_review_gate → 本机 Codex CLI（独立 2-slot 池）
//   location='us'   → 原 US cecelia-bridge（Claude Code）——已退役，返回 claude_channel_retired（任务 76a160b3）
// 注意：Coding 通道（dev/codex_dev/initiative_plan 等）在 task-router.js 中标注为 'us'，
//       不需要在此维护第二份白名单，改 task-router.js 即可影响路由。

/**
 * 所有执行的漏斗（dispatcher / routes/tasks / routes/execution 三处调用）：
 * 内层分派完成后统一经 run 原语落一行 task_runs（一次执行 = 一行，幂等；fail-open 不拖垮执行）。
 * openclaw-agent 等自己已 startRun 的分支先落（source 更精确），这里只是幂等兜底。
 */
async function triggerCeceliaRun(task) {
  assertExternalExecutionAllowed();
  // 必须早于所有桥接、技能覆盖与运行账写入；旧任务不会产生假 run。
  if (isRetiredDecomposition(task)) {
    return { success: false, taskId: task?.id, reason: RETIRED_DECOMPOSITION, retiredBeforeStart: true, error: '旧任务拆解已退役' };
  }
  if (isRetiredDevelopmentTask(task)) {
    return { success: false, taskId: task?.id, reason: RETIRED_DEVELOPMENT_CODE, error: RETIRED_DEVELOPMENT_CODE, retiredBeforeStart: true };
  }
  if (isExternalWorkerTask(task)) {
    return { success: false, taskId: task?.id, reason: 'external_consumer_required' };
  }
  const execResult = await _triggerCeceliaRunInner(task);
  const source = 'executor';
  const runId = await startRunForExecResult({ task, execResult, source });
  if (runId && execResult && execResult.success === true && !execResult.runId) {
    return { ...execResult, runId };
  }
  return execResult;
}

async function _triggerCeceliaRunInner(task) {
  // 固定调用仍经原run漏斗，动态research配置与普通handler不得改派。
  if (invocationBridgeRequired(task)) {
    await setExecutorKind(task.id, EXECUTOR_KIND_FOR.__bridge_path);
    return triggerCodexBridge(task);
  }
  // 动态路由：优先从 task_type_configs 缓存读取（其余 Codex B类，前台可调）
  // A类和 Coding pathway B类不在缓存中，getCachedLocation 返回 null，走 hardcoded 逻辑
  const dynamicLocation = getCachedLocation(task.task_type);
  const location = dynamicLocation ?? getTaskLocation(task.task_type);
  const dynamicExecutor = getCachedConfig(task.task_type)?.executor;

  // 0. Review 审查任务 → 独立 Codex Review 池（不占动态槽位）
  if (REVIEW_TASK_TYPES.includes(task.task_type)) {
    console.log(`[executor] 路由决策: task_type=${task.task_type} → triggerCodexReview`);
    return triggerCodexReview(task);
  }

  // 0.5 staging_e2e（阶段2 Slice1）→ native 执行器，部署 :5222 + 跑 contract E2E + verdict 落库。
  //     独立于 langgraph / interrupt，不占 claude/codex 槽位。
  if (task.task_type === 'staging_e2e') {
    console.log(`[executor] 路由决策: task_type=staging_e2e → Staging E2E Runner (native, no langgraph)`);
    const { runStagingE2E } = await import('./staging-e2e-runner.js');
    return runStagingE2E(task);
  }

  // 0.7 秋米非设备任务（PR3）→ openclaw-agent 执行体：ssh 到主力 worker 起 `openclaw agent`。
  //     不占 claude/codex 槽位，也绝不在 us-vps 本地跑（铁律 96054a8b）。
  //     动态 import：executor.js 是热路径，秋米链路只在真有 qiumi_task 时才拉起来。
  if (task.task_type === 'qiumi_task' || isCommanderVerification(task)) {
    console.log(`[executor] 路由决策: task_type=qiumi_task → openclaw-agent executor (run_id=${task.payload?.run_id})`);
    const { triggerOpenclawAgent } = await import('./openclaw-agent-executor.js');
    return triggerOpenclawAgent(task);
  }

  // 0.8 executor=script（链 bf5088a3 棒3）：确定性脚本步 → Brain 经 ssh 在跑场机执行 payload.cmd，
  //     不占 claude/codex 槽位，也绝不在 us-vps 本地跑（铁律 96054a8b，host 由 script-task-spec 校验只认跑场机）。
  //     动态 import：executor.js 是热路径，脚本链路只在真有 script_run 时才拉起来。
  if (task.task_type === 'script_run') {
    console.log(`[executor] 路由决策: task_type=script_run → script executor (host=${task.payload?.host_id ?? task.payload?.host})`);
    const { triggerScriptRun } = await import('./script-executor.js');
    return triggerScriptRun(task);
  }

  // 1. 显式 override（phase 2 单元1）：payload.{machine,executor} → DB 驱动路由。
  //    REVIEW 短路之后、location-map 路由之前。无显式偏好则整段跳过（零回归）。
  //    resolveExecutor 抛错 → loud-fail（标 failed + return），绝不静默改派。
  let forceUsClaude = false; // [BLOCKER 1] claude override 命中后短路掉下方 location 路由（落到退役收口）
  if (
    (task.payload?.machine || task.payload?.executor)
  ) {
    let route;
    try {
      route = await resolveExecutor(task);
    } catch (err) {
      console.error(`[executor] 显式路由失败 task=${task.id}: ${err.message}`);
      await updateTaskStatus(task.id, 'failed', {
        error_message: `executor route: ${err.message}`.slice(0, 500),
      });
      // [BLOCKER 2] terminal loud-fail：返回 success:true 告诉
      // dispatcher「executor 已处理完毕（已标 failed），无需回退 queued、不污染 cecelia-run 熔断器」。
      return { success: true, taskId: task.id, failed: true, executor: 'route-rejected', error: err.message };
    }
    console.log(`[executor] 显式路由: task=${task.id} → ${route.machineId}/${route.executor} (${route.url})`);
    if (route.executor === 'codex') {
      return triggerCodexBridge(task, route.url);
    }
    // [BLOCKER 1] route.executor === 'claude' → 必须落到下方 US Claude 收口（现为退役拒绝）。
    // 置 forceUsClaude 短路掉后续所有 location 分支（xian / xian_m1 / review / us+codex），
    // 否则天然 location='xian' 的 task_type（codex_dev 等）会被二次劫持送到西安 codex。
    forceUsClaude = true;
  }

  // 2. 西安 Codex Bridge（location='xian'，负载均衡 M4+M1）
  // 动态类型优先走缓存 location，静态类型走 LOCATION_MAP
  if (!forceUsClaude && location === 'xian') {
    const src = dynamicLocation ? 'dynamic-cache' : 'location-map';
    console.log(`[executor] 路由决策: task_type=${task.task_type} → Codex Bridge (location=xian, src=${src})`);
    const xianKind = Object.prototype.hasOwnProperty.call(EXECUTOR_KIND_FOR, task.task_type)
      ? EXECUTOR_KIND_FOR[task.task_type]
      : EXECUTOR_KIND_FOR.__bridge_path;
    await setExecutorKind(task.id, xianKind);
    return triggerCodexBridge(task);
  }

  // 2.1 西安M1 Codex Bridge（location='xian_m1'，钉到 M1 专用节点）
  if (!forceUsClaude && location === 'xian_m1') {
    const src = dynamicLocation ? 'dynamic-cache' : 'location-map';
    console.log(`[executor] 路由决策: task_type=${task.task_type} → Codex Bridge M1 (location=xian_m1, src=${src})`);
    return triggerCodexBridge(task, XIAN_M1_BRIDGE_URL);
  }

  // 2.5 US 本机 Codex CLI（spec_review / code_review_gate 独立 2-slot 池）
  if (!forceUsClaude && (task.task_type === 'spec_review' || task.task_type === 'code_review_gate')) {
    console.log(`[executor] 路由决策: task_type=${task.task_type} → Local Codex CLI (review pool)`);
    return triggerLocalCodexExec(task);
  }

  // 2.8 US 本机 Codex CLI（B类动态任务 executor=codex，前台可配）
  if (!forceUsClaude && location === 'us' && dynamicExecutor === 'codex') {
    console.log(`[executor] 路由决策: task_type=${task.task_type} → Local Codex CLI (dynamic executor=codex)`);
    return triggerLocalCodexExec(task);
  }

  // 3. US → Claude Code（cecelia-bridge /trigger-cecelia → cecelia-run → claude -p）
  //    Claude 无头通道已退役（任务 76a160b3，决策 067867c8）：不 fetch、不起容器，返回 claude_channel_retired。
  //    dispatcher 按 no_executor 收口（不计熔断 / dispatch 失败 / autoblock）。
  console.warn(`[executor] task=${task.id} type=${task.task_type} 落在已退役的 Claude 桥接路径 → ${CLAUDE_CHANNEL_RETIRED_CODE}`);
  return {
    success: false,
    taskId: task.id,
    reason: CLAUDE_CHANNEL_RETIRED_CODE,
    error: CLAUDE_CHANNEL_RETIRED_CODE,
  };
}

/**
 * Check if cecelia-run is available (via cecelia-bridge on port 3457)
 *
 * 传入候选任务（派发前检查）→ 恒可用：Claude 桥接已退役（任务 76a160b3），探活它没有意义，
 * 还会把不经 :3457 的 codex/西安/OpenClaw 任务误判成不可用。落到 claude 路径的任务在执行时由
 * triggerCeceliaRun 返回 claude_channel_retired 拦截。不传 task 的调用方（健康检查等）保持原探活行为。
 */
async function checkCeceliaRunAvailable(task = null) {
  if (task) {
    return { available: true, path: null, bridge: false };
  }
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
    SELECT id, title, payload, started_at, task_type, executor_kind, error_message, claimed_by, claimed_at, updated_at,
           ${EXTERNAL_ACTIVITY_AGE_SQL} AS external_activity_age_sec
    FROM tasks
    WHERE status = 'in_progress'
  `);

  for (const task of result.rows) {
    if (isRetiredDevelopmentTask(task)) continue;
    if (task.payload?.commander_protocol === 'commander-v2') continue;
    if(await reconcileInvocationLiveness(pool,task,{entry:activeProcesses.get(task.id)})){
      suspectProcesses.delete(task.id);continue;
    }
    // 已认领有头会话可能在远端；本机无 PID 不足以判死，沿用合同的 unknown 保留语义。
    if (task.executor_kind === 'headed-session'
        && typeof task.claimed_by === 'string' && task.claimed_by.trim()) {
      const liveness = await assessTaskLiveness(task, { activeProcesses, pool });
      if (liveness.verdict === 'alive' || liveness.verdict === 'unknown') {
        suspectProcesses.delete(task.id);
        continue;
      }
    }

    const runId = task.payload?.current_run_id;
    const entry = activeProcesses.get(task.id);

    let isAlive = false;

    if (entry) {
      // Tracked process — check by PID or task_id in system processes
      if(entry.source==='shared-activity-runner') {
        // 上方固定身份核验未通过；不能借通用无PID条目获得永久alive。
        isAlive=false;
      } else if (entry.pid) {
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

    const EXTERNAL_WATCHDOG_TYPES = new Set(EXTERNAL_WATCHDOG_TASK_TYPES);

    // 外部 run 镜像（workflow_run / device_job source=cron，任务 0004aceb，决策 3c98fb36 阶段1）：
    // wall-report / Notion ssh 直派在执行机上起跑，Brain 行只是账本镜像——从不 claim（下方认领新鲜度分支
    // 接不住）、Brain 从不 spawn（三条 spawn 证据恒空）。09-30 实证 1e84cbad 五次被 no_spawn_evidence 回队
    // 并清 started_at → workflow-run-lost-deadline 永远算不到 4.5h、commander-watchdog 起跑判据被重置，
    // wall-report 阶段回执又设回 in_progress 形成振荡。
    // 活性看镜像心跳（SQL 内算龄：task_runs 阶段回执 / commander 心跳 / 行更新 / 起跑的最新者）；
    // 陈旧也**不回队、不清 started_at**，只留痕 external_liveness_stale（每陈旧窗口一次），
    // 出路归 workflow-run-lost-deadline（总时限判 lost）与 commander-watchdog（接班）。
    if (isExternalRunMirror(task)) {
      suspectProcesses.delete(task.id);
      const ageMs = externalActivityAgeMs(task);
      if (externalStaleNoted.shouldNote(task.id, ageMs)) {
        const staleMinutes = ageMs === null ? null : Math.round(ageMs / 60000);
        await recordTaskEventSafe(pool, task.id, 'external_liveness_stale', {
          reason: 'heartbeat_stale',
          stale_minutes: staleMinutes,
          threshold_minutes: Math.round(EXTERNAL_HEARTBEAT_STALE_MS / 60000),
          task_type: task.task_type,
          source: task.payload?.source || null,
          serial: task.payload?.serial || null,
          tag: task.payload?.tag || null,
        });
        console.log(
          `[liveness] 外部 run 镜像 ${task.id} 心跳陈旧 ${staleMinutes ?? '?'}min（阈值 ${Math.round(EXTERNAL_HEARTBEAT_STALE_MS / 60000)}min）→ 只留痕不回队（归 lost-deadline / commander-watchdog）`
        );
      }
      continue;
    }

    // device_job 由**工作机领单器**在另一台机器上执行（西安的 Mac），进程和日志都在那边，
    // us-vps 本机的三条 spawn 证据（activeProcesses 条目 / /tmp/cecelia-{id}.log /
    // error_message）一条都不会有 —— 于是每一个 device_job 都必然被判死回队。
    //
    // 0923 生产实证（单 e8c1dbce，手机 ANGYVB4311010223）：
    //   21:17:50 领单器认领 → in_progress，真机开始采收
    //   21:28    confirmed DEAD → 零 spawn 证据 → 回队（status 改回 queued）
    //   21:34:09 活真干完了，回执被拒 NOT_RUNNING「这条活已不在执行中」
    //   21:35:19 同一条活又被领走，手机上重跑一遍
    // 后果不只丢回执：回 queued 后会被再次认领，同一个活在真手机上反复执行 ——
    // 机时浪费，且在抖音上重复操作有风控风险。
    //
    // 判据用**认领新鲜度**而不是直接豁免类型：认领过久仍无回执（工作机断电/领单器挂了）
    // 时落回既有 SUSPECT→DEAD 流程，活有出路，不会僵死在 in_progress ——
    // 那种「页面上看着在跑、实际没人做」比误杀更难发现。
    // 宽限期取 45 分钟：真机实测单个词采收 17~25 分钟（逐个点进评论者主页核验身份）。
    if (EXTERNAL_WATCHDOG_TYPES.has(task.task_type) && task.claimed_by && task.claimed_at) {
      const claimAgeMs = Date.now() - new Date(task.claimed_at).getTime();
      if (Number.isFinite(claimAgeMs) && claimAgeMs < EXTERNAL_CLAIM_GRACE_MS) {
        suspectProcesses.delete(task.id);
        continue;
      }
    }

    // 外部执行体（openclaw-agent / script）：进程在 MMV / 跑场机上，本机三条 spawn 证据恒为空，
    // 走下方 SUSPECT→DEAD 必然「零证据回队」——0929 秋米 87c9a08b 起 4 分钟即被回队，而 MMV 上
    // agent 实际在跑。生死交给专属收割器（reapOpenclawAgentRuns / script-reaper 读远端 .exit）
    // 与合同层超时（executor-contracts staleMinutes → zombie-reaper）。
    // 旧device_job保留45分钟策略；独立手机controller由持久租约及远端退出/解锁回执收口。
    if (isPhoneDispatchTask(task) || (isExternallyExecuted(task) && (!EXTERNAL_WATCHDOG_TYPES.has(task.task_type) || EXECUTOR_KIND_FOR[task.task_type] === 'external-worker'))) {
      suspectProcesses.delete(task.id);
      continue;
    }

    // REVIEW 类任务由 triggerCodexReview spawn detached codex，三条进程信号全无
    //（issue f1d6840f：曾 60 秒宽限后恒判死，10~30 分钟审查结构性跑不完）。
    // 活性以 lock 文件为准，与合同层 codex-review-local 共用 SSOT；
    // lock 缺失/超龄 → 不 continue，落入下方既有 SUSPECT→DEAD 双确认流程（回队有出路）。
    if (REVIEW_TASK_TYPES.includes(task.task_type)) {
      if (probeCodexReviewLock(task.id) === 'alive') {
        suspectProcesses.delete(task.id);
        continue;
      }
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

    // ── 假杀堵死（task 94ee0ec4 / 事故任务 b35bfa0c）──────────────────────
    // kill 分类授权前先验 spawn 证据（合同判定点登记表）：存在任一正向 spawn 证据
    // （A: activeProcesses 条目 / B: /tmp/cecelia-{id}.log）或派发回执（D: error_message）
    // 才允许进入 never_started/process_disappeared kill 分类；零证据（A/B/D 全无）
    // → 不得 kill，只做带留痕的安全处置（回 queued，不写 watchdog_kill / error_message /
    // failure learning）。C（started_at）单独不可靠（requeue 会清空，1dfa40f7 已实证）。
    // headed_manual 消费语义（铁律 9f14c074，decisions 拍板留痕）：人工接管任务不进
    // 无头 liveness 假杀路径——安全回队等待有头执行。
    // 信号不完整（日志探测异常）→ 保守视为有证据，维持既有 process_disappeared 兜底。
    let hasSpawnEvidence = Boolean(entry) || Boolean(task.error_message);
    if (!hasSpawnEvidence) {
      try {
        hasSpawnEvidence = existsSync(`/tmp/cecelia-${task.id}.log`);
      } catch {
        hasSpawnEvidence = true;
      }
    }
    const isHeadedManual =
      task.payload?.headed_manual === true || task.payload?.headed_manual === 'true';
    if (!hasSpawnEvidence) {
      const safeEventType = isHeadedManual ? 'watchdog_headed_requeue' : 'watchdog_safe_requeue';
      const safeUpdate = await pool.query(
        `UPDATE tasks SET status = 'queued', claimed_by = NULL, claimed_at = NULL, started_at = NULL
         WHERE id = $1 AND status = 'in_progress'`,
        [task.id]
      );
      await recordTaskEventSafe(pool, task.id, safeEventType, {
        reason: 'no_spawn_evidence',
        headed_manual: isHeadedManual,
        suspect_since: suspect.firstSeen,
        probe_ticks: suspect.tickCount + 1,
        evidence: { active_process: false, process_log: false, dispatch_receipt: false },
      });
      console.log(
        `[liveness] Task ${task.id} 零 spawn 证据（无进程条目/无日志/无派发回执）→ 安全回队不 kill（headed_manual=${isHeadedManual}, requeued=${safeUpdate.rowCount > 0}）`
      );
      actions.push({
        action: 'liveness_safe_requeue',
        task_id: task.id,
        title: task.title,
        headed_manual: isHeadedManual,
        suspect_since: suspect.firstSeen,
      });
      continue;
    }
    // ──────────────────────────────────────────────────────────────────────

    // Clean up activeProcesses entry
    if (entry) {
      activeProcesses.delete(task.id);
    }

    // Auto-fail the task with enhanced diagnostics
    const pid = entry?.pid || null;
    let { reason, diagnostic_info } = await checkExitReason(pid, task.id);

    // never_started 分类（1dfa40f7 防复发）：仅在落入 process_disappeared 兜底时收窄——
    // 从未启动任务（pid 未跟踪 ∧ 无进程日志 ∧ (started_at=null ∨ 已有派发失败 error_message)）
    // 分类为 never_started；其余场景（含曾启动进程消失）分类行为与现状完全一致。
    if (reason === 'process_disappeared' && isNeverStarted(task, entry)) {
      reason = 'never_started';
    }

    const errorDetails = {
      type: 'liveness_probe_failed',
      reason: reason, // oom_killed / oom_likely / killed_signal / timeout / process_disappeared / never_started
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

  externalStaleNoted.prune(new Set(result.rows.map((row) => row.id)));
  return actions;
}

/**
 * Brain 重启后从 lock slot + docker relay 容器重建 activeProcesses Map。
 * 在 syncOrphanTasksOnStartup 之前调用，使后续孤儿检测能正确区分
 * "进程还活着" vs "真正消失"，避免误杀友军。
 *
 * 认领策略：
 *   1. /tmp/cecelia-locks/slot-* /info.json → pid/child_pid 直接探活
 *   2. docker ps --filter name=cecelia-relay- → relay 容器存活
 *   3. touch tasks.updated_at → 给 zombie-reaper / recovery-loop 续命
 *
 * fail-open：docker/fs 探测失败只 warn，不抛错，不误标任务死亡。
 *
 * @param {object} dbPool - pg Pool 实例
 * @returns {Promise<{ reattached: number, touched: number, errors: string[] }>}
 */
async function reAttachActiveExecutors(dbPool) {
  const result = { reattached: 0, touched: 0, errors: [] };
  const taskIdsToTouch = new Set();
  const lockDir = process.env.LOCK_DIR || '/tmp/cecelia-locks';

  // ── 1. Lock slot scan ────────────────────────────────────────────────────
  try {
    const entries = readdirSync(lockDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('slot-')) continue;
      const infoPath = path.join(lockDir, entry.name, 'info.json');
      try {
        const info = JSON.parse(readFileSync(infoPath, 'utf-8'));
        const taskId = info.task_id;
        if (!taskId || typeof taskId !== 'string') continue;

        // child_pid 优先（更精确），fallback pid
        let alivePid = null;
        for (const p of [info.child_pid, info.pid]) {
          const n = p ? Number(p) : NaN;
          if (Number.isFinite(n) && n > 0 && isProcessAlive(n)) { alivePid = n; break; }
        }
        if (!alivePid) continue;

        if (!activeProcesses.has(taskId)) {
          activeProcesses.set(taskId, {
            pid: alivePid,
            pgid: info.pgid ? Number(info.pgid) : alivePid,
            startedAt: info.started || new Date().toISOString(),
            runId: null,
            bridge: false,
            source: 'reattach_slot',
          });
          result.reattached++;
          taskIdsToTouch.add(taskId);
          console.log(`[reattach] slot ${entry.name}: task=${taskId} pid=${alivePid}`);
        }
      } catch { /* corrupt info.json 或 slot 已清理 */ }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      result.errors.push(`slot_scan: ${err.message}`);
      console.warn('[reattach] lock slot scan failed (non-fatal):', err.message);
    }
  }

  // ── 2. Docker relay container scan ────────────────────────────────────────
  try {
    const dockerOut = execSync(
      "docker ps --filter 'name=cecelia-relay-' --format '{{.Names}}'",
      { encoding: 'utf-8', timeout: 8000, stdio: 'pipe' }
    ).trim();
    const containerNames = dockerOut ? dockerOut.split('\n').filter(Boolean) : [];

    if (containerNames.length > 0) {
      // 命名规约: cecelia-relay-<short8>[-cx|-<rand>]，short8 = task.id 前 8 字符
      const shortPrefixes = new Set();
      for (const name of containerNames) {
        const match = name.match(/^cecelia-relay-([0-9a-f]{8})/i);
        if (match) shortPrefixes.add(match[1].toLowerCase());
      }

      if (shortPrefixes.size > 0) {
        const prefixArr = Array.from(shortPrefixes);
        const { rows } = await dbPool.query(
          `SELECT id, started_at, payload
             FROM tasks
            WHERE status = 'in_progress'
              AND LEFT(id::text, 8) = ANY($1::text[])`,
          [prefixArr]
        );
        for (const row of rows) {
          if (!activeProcesses.has(row.id)) {
            activeProcesses.set(row.id, {
              pid: null,
              startedAt: row.started_at || new Date().toISOString(),
              runId: row.payload?.current_run_id || null,
              bridge: true,
              source: 'reattach_docker',
            });
            result.reattached++;
            taskIdsToTouch.add(row.id);
            console.log(`[reattach] docker relay: task=${row.id}`);
          }
        }
      }
    }
  } catch (err) {
    result.errors.push(`docker_scan: ${err.message}`);
    console.warn('[reattach] docker relay scan failed (non-fatal):', err.message);
  }

  // ── 3. Docker task container scan (cecelia-task-*) ──────────────────────────
  // docker-executor 派发的任务容器命名：cecelia-task-{short12}-{rand}
  // short12 = task.id 去掉连字符后取前 12 字符
  try {
    const dockerTaskOut = execSync(
      "docker ps --filter 'name=cecelia-task-' --format '{{.Names}}'",
      { encoding: 'utf-8', timeout: 8000, stdio: 'pipe' }
    ).trim();
    const taskContainerNames = dockerTaskOut ? dockerTaskOut.split('\n').filter(Boolean) : [];

    if (taskContainerNames.length > 0) {
      const short12Set = new Set();
      for (const name of taskContainerNames) {
        const match = name.match(/^cecelia-task-([0-9a-f]{12})/i);
        if (match) short12Set.add(match[1].toLowerCase());
      }

      if (short12Set.size > 0) {
        const prefixes = Array.from(short12Set);
        const { rows: taskRows } = await dbPool.query(
          `SELECT id, started_at, payload
             FROM tasks
            WHERE status = 'in_progress'
              AND LEFT(REPLACE(id::text, '-', ''), 12) = ANY($1::text[])`,
          [prefixes]
        );
        for (const row of taskRows) {
          if (!activeProcesses.has(row.id)) {
            activeProcesses.set(row.id, {
              pid: null,
              startedAt: row.started_at || new Date().toISOString(),
              runId: row.payload?.current_run_id || null,
              docker: true,
              source: 'reattach_docker_task',
            });
            result.reattached++;
            taskIdsToTouch.add(row.id);
            console.log(`[reattach] docker task container: task=${row.id}`);
          }
        }
      }
    }
  } catch (err) {
    result.errors.push(`docker_task_scan: ${err.message}`);
    console.warn('[reattach] docker task scan failed (non-fatal):', err.message);
  }

  // ── 4. Touch updated_at — 给 zombie-reaper 续命 ───────────────────────────
  if (taskIdsToTouch.size > 0) {
    try {
      const ids = Array.from(taskIdsToTouch);
      const touchResult = await dbPool.query(
        `UPDATE tasks SET updated_at = NOW()
          WHERE id = ANY($1::uuid[])
            AND status = 'in_progress'
          RETURNING id`,
        [ids]
      );
      result.touched = touchResult.rowCount || 0;
      console.log(`[reattach] updated_at touched for ${result.touched} tasks`);
    } catch (err) {
      result.errors.push(`touch_updated_at: ${err.message}`);
      console.warn('[reattach] touch updated_at failed (non-fatal):', err.message);
    }
  }

  console.log(`[reattach] done reattached=${result.reattached} touched=${result.touched} errors=${result.errors.length}`);
  return result;
}

/**
 * Synchronize DB state with actual processes on Brain startup.
 * Finds all in_progress tasks and checks if they have matching processes.
 * Tasks without processes are marked as failed (orphan_detected).
 *
 * @returns {Object} - { orphans_found, orphans_fixed, rebuilt }
 */
async function syncOrphanTasksOnStartup() {
  if (process.env.BRAIN_DEPLOY_CANARY === '1') {
    console.log('[startup-sync] Skip orphan recovery on deployment canary; task ownership belongs to primary');
    return { orphans_found: 0, orphans_fixed: 0, requeued: 0, rebuilt: 0, external_skipped: 0 };
  }
  const result = await pool.query(`
    SELECT id, title, payload, started_at, error_message, task_type, executor_kind, claimed_by
    FROM tasks
    WHERE status = 'in_progress'
  `);

  let orphansFound = 0;
  let externalSkipped = 0;
  let orphansFixed = 0;
  let requeued = 0;
  let rebuilt = 0;

  for (const task of result.rows) {
    if (isRetiredDevelopmentTask(task)) continue;
    if (task.payload?.commander_protocol === 'commander-v2') continue;
    if(await reconcileInvocationLiveness(pool,task,{entry:activeProcesses.get(task.id)})){
      externalSkipped++;continue;
    }
    // 外部执行体（device_job 在西安 Mac、openclaw-agent 秋米在 MMV、script 在跑场机）：
    // 本机永远查不到进程，下方孤儿路径会在每次部署重启时把它回 queued 且不清 claimed_by
    // → device_job 被中台 /api/schedule/claim 再领一次，同一活在真手机上重跑（0929 实证）。
    // 不回队、不动 claim、不计孤儿，交给各自收割/对账（reaper 读远端 .exit；device_job 走运行期
    // 认领新鲜度 + 超时兜底）。
    // 有头owner可能在外部宿主/CI；本机无PID不能撤销其执行权。失效交原liveness/lease回收。
    const hasHeadedOwner = task.executor_kind === 'headed-session'
      && typeof task.claimed_by === 'string' && task.claimed_by.trim().length > 0;
    if (isExternallyExecuted(task) || hasHeadedOwner) {
      externalSkipped++;
      console.log(`[startup-sync] skip external executor task=${task.id} type=${task.task_type} kind=${task.executor_kind || '-'}（进程不在本机，归专属收割/对账）`);
      continue;
    }
    // reAttachActiveExecutors 已认领（如 docker-executor 的 cecelia-task-* 容器）→ 跳过孤儿检测
    if (activeProcesses.has(task.id)&&activeProcesses.get(task.id)?.source!=='shared-activity-runner') {
      rebuilt++;
      console.log(`[startup-sync] Already reattached by reAttachActiveExecutors: task=${task.id} title="${task.title}"`);
      continue;
    }

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

      // Tasks with run_id = null never spawned a real process — they are inline
      // inline orchestration markers. On Brain restart these
      // should always be requeued rather than quarantined, because no process
      // actually died; the task was simply running inline when Brain stopped.
      if (!runId) {
        await pool.query(
          `UPDATE tasks SET
            status = 'queued',
            error_message = NULL,
            payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb,
            updated_at = NOW()
          WHERE id = $1`,
          [task.id, JSON.stringify({ watchdog_retry_count: 0 })]
        );
        requeued++;
        console.log(`[startup-sync] Inline task requeued (no process): task=${task.id} title="${task.title}"`);
        continue;
      }

      // startup-sync 使用较保守的 2 次限制（重启时原因未知，不区分 liveness_dead）
      const QUARANTINE_AFTER_KILLS = 2;
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

        await finalizeTask(pool, task.id, 'failed', {
          set: { error_message: `[orphan_detected] reason=${reason} at ${new Date().toISOString()}` },
          mergePayload: { error_details: errorDetails },
        });

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

  console.log(`[startup-sync] Complete: orphans_found=${orphansFound} orphans_fixed=${orphansFixed} requeued=${requeued} rebuilt=${rebuilt} external_skipped=${externalSkipped}`);
  return { orphans_found: orphansFound, orphans_fixed: orphansFixed, requeued, rebuilt, external_skipped: externalSkipped };
}

/**
 * Record a heartbeat for a running task.
 * Updates last_heartbeat in the task's payload.
 *
 * @param {string} taskId - Task ID
 * @param {string} runId - Run ID (for validation)
 * @returns {Object} - { success, message }
 */
async function recordHeartbeat(taskId, _runId) {
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
  triggerCodexReview,
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
  reAttachActiveExecutors,
  syncOrphanTasksOnStartup,
  recordHeartbeat,
  isRunIdProcessAlive,
  isTaskProcessAlive,
  suspectProcesses,
  externalStaleNoted,
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
  // v10: Provider routing
  getProviderForTask,
  // v11: Unified model routing
  getModelForTask,
  // v12: Multi-account credentials
  getCredentialsForTask,
  MODELS,
  MODEL_MAP,
  FIXED_PROVIDER,
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
  // v18: goal-based stop hook
  buildGoalSettings,
  // v14: Input validation for shell commands
  assertSafeId,
  assertSafePid,
  // v15: Token-aware slot allocation
  getTokenPressure,
  TOKEN_PRESSURE_THRESHOLD,
  // v17: Docker Sandbox executor (HARNESS_DOCKER_ENABLED=true) — spawn() 已成唯一入口，
  // 仅保留 callback / 资源 tier / 探活辅助函数对外。
  writeDockerCallback,
  resolveResourceTier,
  isDockerAvailable,
};
