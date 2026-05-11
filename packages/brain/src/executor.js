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
import { spawn, execSync, exec } from 'child_process';
import { writeFile, mkdir, access } from 'fs/promises';
import { readFileSync, readdirSync, unlinkSync } from 'fs';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import pool from './db.js';
import { buildLearningContext } from './learning-retriever.js';
import { getDecisionsSummary } from './decisions-context.js';
import { recordExpectedReward } from './dopamine.js';
import { getActiveProfile, FALLBACK_PROFILE } from './model-profile.js';
import { getTaskLocation } from './task-router.js';
import { loadCache as _loadCache, getCachedLocation, getCachedConfig, refreshCache as _refreshCache } from './task-type-config-cache.js';
import { updateTaskStatus, updateTaskProgress as _updateTaskProgress } from './task-updater.js';
import { traceStep, LAYER, STATUS, EXECUTOR_HOSTS } from './trace.js';
import { getAccountUsage } from './account-usage.js';
import { writeDockerCallback, resolveResourceTier, isDockerAvailable } from './docker-executor.js';
import { spawn as spawnDocker } from './spawn/index.js';
import {
  sampleCpuUsage as platformSampleCpuUsage,
  _resetCpuSampler as platformResetCpuSampler,
  getSwapUsedPct,
  getDmesgInfo as platformGetDmesgInfo,
  countClaudeProcesses,
  calculatePhysicalCapacity,
  evaluateMemoryHealth,
  getBrainRssMB,
  IS_DARWIN,
} from './platform-utils.js';

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

// 多机 Codex Bridge 列表（负载均衡）
const CODEX_BRIDGES = (process.env.CODEX_BRIDGES || 'http://100.86.57.69:3458,http://100.88.166.55:3458')
  .split(',').map(s => s.trim()).filter(Boolean);

/**
 * 从多个 Codex Bridge 中选择最空闲的
 */
async function selectBestBridge() {
  const results = await Promise.allSettled(
    CODEX_BRIDGES.map(async (url) => {
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
    // learning fdf87ba0: 旧实现 fallback 到 XIAN_CODEX_BRIDGE_URL 会向已死端点派任务，
    // 让任务卡在 in_progress 永远占据 Codex 并发池 slot。
    // 改为返回 null，让调用方（triggerCodexBridge）跳过 dispatch，task 回 queued，slot 释放。
    console.warn('[executor] 所有 Codex Bridge /health 失败 — 跳过 dispatch（避免向死端点派任务造成并发池死锁）');
    return null;
  }

  const selected = healthy[0];
  console.log(`[executor] Bridge 选择: ${selected.url} (avgPct=${selected.avgPct.toFixed(1)}%, accounts=${selected.accountCount})`);
  return selected.url;
}

// 机器注册表（Machine Registry）
// tags 决定机器能执行哪类任务：
//   has_git     = 需要代码/git 访问（US M4 独有）
//   general     = 通用任务，任意机器均可
//   has_browser = 需要 Browser/CDP 访问（将来扩展）
const MACHINE_REGISTRY = [
  {
    id: 'us-m4',
    url: process.env.EXECUTOR_BRIDGE_URL || 'http://localhost:3457',
    type: 'claude_code',
    tags: ['has_git', 'general'],
  },
  {
    id: 'xian-m4',
    url: XIAN_CODEX_BRIDGE_URL,
    type: 'codex',
    tags: ['general'],
  },
  {
    id: 'xian-m1',
    url: XIAN_M1_BRIDGE_URL,
    type: 'codex',
    tags: ['general'],
  },
];

/**
 * 从机器注册表中选择最适合的机器
 * @param {string[]} requiredTags - 任务所需的 capability tags
 * @returns {Promise<Object>} - 最佳机器配置（fallback 到 us-m4）
 */
async function selectBestMachine(requiredTags) {
  const candidates = MACHINE_REGISTRY.filter(m =>
    requiredTags.every(tag => m.tags.includes(tag))
  );

  if (candidates.length === 0) {
    console.warn(`[executor] selectBestMachine: 无机器匹配 tags=${JSON.stringify(requiredTags)}，降级到 us-m4`);
    return MACHINE_REGISTRY.find(m => m.id === 'us-m4') || MACHINE_REGISTRY[0];
  }

  if (candidates.length === 1) return candidates[0];

  // 多台候选时，优先在 Codex 机器之间负载均衡
  const codexCandidates = candidates.filter(m => m.type === 'codex');
  if (codexCandidates.length > 0) {
    const bestUrl = await selectBestBridge();
    const matched = codexCandidates.find(m => m.url === bestUrl);
    return matched || codexCandidates[0];
  }

  return candidates[0];
}

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
const CODEX_REVIEW_LOCK_DIR = '/tmp/codex-review-locks';
const CODEX_REVIEW_MAX = 2;

// 审查任务类型列表（由 triggerCodexReview 以本机 codex CLI 执行，走独立 codex-review-locks 池）
// 编码类 B類任务（需读代码上下文）也走本机 Codex，不走 cecelia-run（Claude Code）
const REVIEW_TASK_TYPES = [
  // Gate 审查（原有）
  'spec_review', 'code_review_gate', 'prd_review', 'initiative_review',
  // 编码类 B類（新增：需读代码，US 本机 Codex CLI 执行）
  'code_review', 'decomp_review',
  'initiative_plan', 'initiative_verify',
  'arch_review', 'architecture_design', 'architecture_scan',
];

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

    // Fallback to okr_initiatives/okr_scopes/okr_projects metadata.repo_path（迁移：projects → new tables）
    const result = await pool.query(
      `SELECT metadata->>'repo_path' AS repo_path, NULL::uuid AS parent_id
       FROM okr_initiatives WHERE id = $1
       UNION ALL
       SELECT metadata->>'repo_path' AS repo_path, NULL::uuid AS parent_id
       FROM okr_scopes WHERE id = $1
       UNION ALL
       SELECT metadata->>'repo_path' AS repo_path, NULL::uuid AS parent_id
       FROM okr_projects WHERE id = $1
       LIMIT 1`,
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
  const cpuPressure = _cpuHistory.length > 0 ? _avgHistory(_cpuHistory) : rawCpuPressure;
  let memPressure = _memHistory.length > 0 ? _maxHistory(_memHistory) : rawMemPressure;
  const swapPressure = swapUsedPct / SWAP_USED_MAX_PCT;

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
        INSERT INTO learnings (title, category, trigger_event, content, metadata, content_hash, version, is_latest, digested, task_id)
        VALUES ($1, 'failure_pattern', 'watchdog_kill', $2, $3, $4, 1, true, false, $5)
      `, [
        failureTitle,
        failureContent,
        JSON.stringify({ task_id: taskId, task_type: task_type || null, project_id: project_id || null }),
        contentHash,
        taskId || null,
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
    'research': '',          // 研究：完全只读，不挂 skill，由 preparePrompt 直接构建 prompt
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
    'content-pipeline': '/content-creator',      // 编排入口：触发完整内容生成流程
    'content-research': '/notebooklm',           // 调研阶段：NotebookLM 深度调研
    'content-copywriting': '/content-creator',   // 文案生成阶段
    'content-copy-review': '/content-creator',   // 文案审核阶段
    'content-generate': '/content-creator',      // 生成阶段：图片+文案生成
    'content-image-review': '/content-creator',  // 图片审核阶段
    'content-review': '/content-creator',        // 审核阶段：AI 质量评分
    'content-export': '/content-creator',        // 导出阶段：NAS 存储 + manifest
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
    'pipeline_rescue': '/dev',       // 卡住的 pipeline 接管修复 → /dev 全流程
    'codex_test_gen': '/codex-test-gen',  // Codex 自动生成测试 → 西安 M4
    'platform_scraper': '/media-scraping', // 平台数据采集 → CN Mac mini (/media-scraping skill)
    // 注意：harness_generate/harness_fix 等不在此处
    // 它们由 preparePrompt() 提前路由，不经过 skillMap。
    // 实际路由见 task-router.js LOCATION_MAP。
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
    // 迁移：projects → okr_projects（name → title）
    const projResult = await pool.query(
      `SELECT op.id, op.title AS name, op.status, NULL::int AS sequence_order,
              NULL::int AS time_budget_days, op.created_at, op.completed_at
       FROM okr_projects op
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

// ─── Sprint 跨 worktree 文件读取（git fetch + git show） ─────────────────────

async function _fetchSprintFile(branch, filePath) {
  try {
    execSync('git fetch origin', { cwd: WORK_DIR, stdio: 'pipe' });
  } catch {
    // fetch 失败不阻塞，继续尝试 show
  }
  try {
    const content = execSync(`git show origin/${branch}:${filePath}`, {
      cwd: WORK_DIR,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return content;
  } catch {
    return null;
  }
}

// ─── preparePrompt 子函数 ────────────────────────────────────────────────────

function _prepareContinueDecompWithInitiative(task, krId, krTitle, initiativeId) {
  const previousResult = task.payload?.previous_result || '';
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

function _prepareInitiativeSupplementDecomp(task, krId, krTitle, projectId, initiativeId) {
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

async function _prepareFirstDecomp(task, krId, krTitle) {
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

okr_projects.kr_id 已在创建时直接绑定到该 KR（无需额外的桥接表）。

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
2. ✅ okr_projects.kr_id 已设置为当前 KR（新表直接存储，无需桥接表）
3. ✅ Initiatives 的 parent_id = 新建 Project（不是 cecelia-core）
4. ✅ 第一个 Task 的 task_type='dev'
5. ✅ 所有 Task 的 goal_id = ${krId}
6. ✅ 所有 Task 的 project_id 指向 Initiative（不是 Project）

参考：~/.claude/skills/okr/SKILL.md Stage 2 (Line 332-408)`;
}

async function _prepareDecompositionPrompt(task) {
  const krId = task.goal_id || task.payload?.kr_id || '';
  const krTitle = task.title?.replace(/^(OKR 拆解|拆解|继续拆解)[：:]\s*/, '') || '';
  const projectId = task.project_id || task.payload?.project_id || '';
  const isContinue = task.payload?.decomposition === 'continue';
  const initiativeId = task.payload?.initiative_id || task.payload?.feature_id || '';

  if (isContinue && initiativeId) return _prepareContinueDecompWithInitiative(task, krId, krTitle, initiativeId);
  if (!isContinue && initiativeId) return _prepareInitiativeSupplementDecomp(task, krId, krTitle, projectId, initiativeId);
  return _prepareFirstDecomp(task, krId, krTitle);
}

function _prepareScopePlanPrompt(task) {
  const formatHint = [
    '\n\n## 输出格式要求',
    '用结构化 Markdown 输出。每个 Initiative：',
    '### Initiative N：名称',
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
  return `/decomp\n\n[scope_plan] ${task.description || task.title}${formatHint}`;
}

function _prepareProjectPlanPrompt(task) {
  const formatHint = [
    '\n\n## 输出格式要求',
    '用结构化 Markdown 输出。每个 Scope：',
    '### Scope N：名称',
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
    '| Scope | 对应成功标准 | 预计天数 | 执行顺序 |',
    '|-------|------------|---------|---------|',
  ].join('\n');
  return `/decomp\n\n[project_plan] ${task.description || task.title}${formatHint}`;
}

function _prepareSprintPrompt(task, taskType) {
  const payload = task.payload || {};
  const sprintDir = payload.sprint_dir || 'sprints';
  const evalRound = payload.eval_round || 0;
  const isFixMode = ['sprint_fix', 'harness_fix'].includes(taskType);
  const isHarnessV4 = ['harness_generate', 'harness_fix'].includes(taskType);
  const skillCmd = isHarnessV4 ? '/harness-generator' : '/sprint-generator';
  const mode = isFixMode ? taskType : (isHarnessV4 ? 'harness_generate' : 'sprint_generate');
  const headerText = isHarnessV4
    ? `## Harness v4.0 — ${isFixMode ? 'Fix (Round ' + evalRound + ')' : 'Generate'}`
    : `## Harness v3.1 — ${isFixMode ? 'Sprint Fix (Round ' + evalRound + ')' : 'Sprint Generate'}`;
  return `${skillCmd}

${headerText}

**task_type**: ${mode}
**task_id**: ${task.id}
**sprint_dir**: ${sprintDir}
${isFixMode ? `**eval_round**: ${evalRound}\n**读取 eval-round-${evalRound}.md 中的 FAIL 反馈进行修复**\n**ci_fail_context**: ${payload.ci_fail_context || ''}` : ''}

任务描述:
${task.description || task.title}`;
}

function _prepareSprintEvaluatePrompt(task) {
  const payload = task.payload || {};
  const sprintDir = payload.sprint_dir || 'sprints';
  const devTaskId = payload.dev_task_id || '';
  const evalRound = payload.eval_round || 1;
  return `/sprint-evaluator

## Harness v2.0 — Sprint Evaluator (R${evalRound})

**任务 ID**: ${task.id}
**Sprint 目录**: ${sprintDir}
**Dev Task ID**: ${devTaskId}
**评估轮次**: R${evalRound}
**Initiative**: ${task.project_id || 'unknown'}

你的目标: 读取 ${sprintDir}/sprint-contract.md，逐条验证 Generator 的代码。
输出: ${sprintDir}/evaluation.md (PASS 或 FAIL + 具体问题)`;
}

async function _prepareHarnessEvaluatePrompt(task) {
  const payload = task.payload || {};
  const sprintDir = payload.sprint_dir || 'sprints';
  const prUrl = payload.pr_url || '';
  const evalRound = payload.eval_round || 1;
  const contractBranch = payload.contract_branch || '';

  // v5.0: Evaluator 是对抗性 E2E 验收 Agent，不是机械命令执行器
  // 注入合同内容供 Evaluator 理解验收标准（Given-When-Then）
  let contractContent = '';
  if (contractBranch) {
    const content = await _fetchSprintFile(contractBranch, `${sprintDir}/sprint-contract.md`);
    if (content) contractContent = `\n\n## ${sprintDir}/sprint-contract.md（来自 ${contractBranch}）\n${content}`;
  }

  return `/harness-evaluator

## Harness v5.0 — Evaluator (R${evalRound})

**task_id**: ${task.id}
**sprint_dir**: ${sprintDir}
**pr_url**: ${prUrl}
**eval_round**: ${evalRound}
**contract_branch**: ${contractBranch}

目标：部署服务（重启 Brain / Dashboard），然后对照合同验收标准（Given-When-Then）进行 E2E 功能验收。
用 curl 验证 API，用 Playwright/浏览器验证前端。你的工作是找到失败，不是确认成功。
写入 ${sprintDir}/eval-round-${evalRound}.md。${contractContent}`;
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

// ─── preparePrompt 子函数（Harness 系列）────────────────────────────────────

async function _prepareHarnessGeneratePrompt(task) {
  const taskType = task.task_type || 'dev';
  const sprintDir = task.payload?.sprint_dir || 'sprints';
  const contractBranch = task.payload?.contract_branch || null;
  const workstreamIndex = task.payload?.workstream_index || null;
  const workstreamCount = task.payload?.workstream_count || 1;
  let basePrompt = _prepareSprintPrompt(task, taskType);
  if (workstreamIndex) {
    basePrompt += `\nworkstream_index: ${workstreamIndex}\nworkstream_count: ${workstreamCount}`;
  }
  if (contractBranch) {
    const contractContent = await _fetchSprintFile(contractBranch, `${sprintDir}/sprint-contract.md`);
    if (contractContent) {
      basePrompt += `\n\n## ${sprintDir}/sprint-contract.md（来自 ${contractBranch}）\n${contractContent}`;
    }
  }
  return basePrompt;
}

function _prepareHarnessReportPrompt(task, taskType) {
  const sprintDir = task.payload?.sprint_dir || 'sprints';
  const skillName = taskType === 'harness_report' ? '/harness-report' : '/sprint-report';
  return `${skillName}\n\n## Harness v4.0 — Report\n\ntask_id: ${task.id}\nsprint_dir: ${sprintDir}\npr_url: ${task.payload?.pr_url || ''}\n\n${task.description || task.title}`;
}

function _prepareHarnessPlannerPrompt(task, _taskType) {
  // harness_planner task_type 已退役（retire-harness-planner PR），此函数仅 sprint_planner 调用
  const sprintDir = task.payload?.sprint_dir || 'sprints';
  return `/sprint-planner\n\n## Harness v4.0 — Planner\n\ntask_id: ${task.id}\nsprint_dir: ${sprintDir}\n\n${task.description || task.title}`;
}

async function _prepareContractProposePrompt(task, taskType) {
  const sprintDir = task.payload?.sprint_dir || 'sprints';
  const proposeRound = task.payload?.propose_round || 1;
  const plannerBranch = task.payload?.planner_branch || null;
  const reviewBranch = task.payload?.review_branch || null;
  const skillName = taskType === 'harness_contract_propose' ? '/harness-contract-proposer' : '/sprint-contract-proposer';
  let basePrompt = `${skillName}\n\n## Harness v4.0 — Contract Proposer\n\ntask_id: ${task.id}\nsprint_dir: ${sprintDir}\npropose_round: ${proposeRound}\nplanner_task_id: ${task.payload?.planner_task_id || ''}\nplanner_branch: ${plannerBranch || ''}\nreview_feedback_task_id: ${task.payload?.review_feedback_task_id || ''}\nreview_branch: ${reviewBranch || ''}\n\n${task.description || task.title}`;
  if (plannerBranch) {
    const sprintPrdContent = await _fetchSprintFile(plannerBranch, `${sprintDir}/sprint-prd.md`);
    if (sprintPrdContent) {
      basePrompt += `\n\n## ${sprintDir}/sprint-prd.md（来自 ${plannerBranch}）\n${sprintPrdContent}`;
    }
  }
  if (reviewBranch) {
    const reviewFeedback = await _fetchSprintFile(reviewBranch, `${sprintDir}/contract-review-feedback.md`);
    if (reviewFeedback) {
      basePrompt += `\n\n## ${sprintDir}/contract-review-feedback.md（来自 ${reviewBranch}）\n${reviewFeedback}`;
    }
  }
  return basePrompt;
}

async function _prepareContractReviewPrompt(task, taskType) {
  const sprintDir = task.payload?.sprint_dir || 'sprints';
  const plannerBranch = task.payload?.planner_branch || null;
  const proposeBranch = task.payload?.propose_branch || null;
  const skillName = taskType === 'harness_contract_review' ? '/harness-contract-reviewer' : '/sprint-contract-reviewer';
  let basePrompt = `${skillName}\n\n## Harness v4.0 — Contract Reviewer\n\ntask_id: ${task.id}\nsprint_dir: ${sprintDir}\npropose_task_id: ${task.payload?.propose_task_id || ''}\npropose_round: ${task.payload?.propose_round || 1}\nplanner_branch: ${plannerBranch || ''}\npropose_branch: ${proposeBranch || ''}\n\n${task.description || task.title}`;
  if (plannerBranch) {
    const sprintPrdContent = await _fetchSprintFile(plannerBranch, `${sprintDir}/sprint-prd.md`);
    if (sprintPrdContent) {
      basePrompt += `\n\n## ${sprintDir}/sprint-prd.md（来自 ${plannerBranch}）\n${sprintPrdContent}`;
    }
  }
  if (proposeBranch) {
    const contractDraftContent = await _fetchSprintFile(proposeBranch, `${sprintDir}/contract-draft.md`);
    if (contractDraftContent) {
      basePrompt += `\n\n## ${sprintDir}/contract-draft.md（来自 ${proposeBranch}）\n${contractDraftContent}`;
    }
  }
  return basePrompt;
}

// ─── preparePrompt 辅助：条件判断 + 路由内联 lambda 拆分 ────────────────────

function _isSprintOrHarnessDevMode(taskType, payload) {
  return ['sprint_generate', 'sprint_fix'].includes(taskType)
    || (taskType === 'dev' && payload?.harness_mode);
}

function _prepareInitiativePlanPrompt(t) {
  return `/decomp\n\n${t.description || t.title}`;
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
const _HARNESS_GENERATE_TYPES = new Set(['harness_generate', 'harness_fix']);

// 路由表：taskType → handler（模块级常量，避免每次调用重建）
const _TASK_ROUTES = {
  sprint_report:            (t) => _prepareHarnessReportPrompt(t, 'sprint_report'),
  harness_report:           (t) => _prepareHarnessReportPrompt(t, 'harness_report'),
  sprint_planner:           (t) => _prepareHarnessPlannerPrompt(t, 'sprint_planner'),
  sprint_contract_propose:  (t) => _prepareContractProposePrompt(t, 'sprint_contract_propose'),
  harness_contract_propose: (t) => _prepareContractProposePrompt(t, 'harness_contract_propose'),
  sprint_contract_review:   (t) => _prepareContractReviewPrompt(t, 'sprint_contract_review'),
  harness_contract_review:  (t) => _prepareContractReviewPrompt(t, 'harness_contract_review'),
  initiative_plan:          _prepareInitiativePlanPrompt,
  scope_plan:               _prepareScopePlanPrompt,
  project_plan:             _prepareProjectPlanPrompt,
  sprint_evaluate:          _prepareSprintEvaluatePrompt,
  harness_evaluate:         _prepareHarnessEvaluatePrompt,
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
};

// ─── preparePrompt 主入口（dispatcher）────────────────────────────────────────

async function preparePrompt(task) {
  const taskType = task.task_type || 'dev';
  const skill = task.payload?.skill_override ?? getSkillForTaskType(taskType, task.payload);

  if (_DECOMP_TYPES.has(task.payload?.decomposition)) return _prepareDecompositionPrompt(task);
  if (_HARNESS_GENERATE_TYPES.has(taskType)) return _prepareHarnessGeneratePrompt(task);
  if (_isSprintOrHarnessDevMode(taskType, task.payload)) return _prepareSprintPrompt(task, taskType);

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
    const promptContent = await preparePrompt(task);

    // 写 prompt 文件
    await mkdir(PROMPT_DIR, { recursive: true });
    const promptFile = path.join(PROMPT_DIR, `codex-review-${task.id}.txt`);
    await writeFile(promptFile, promptContent);

    // 获取锁文件（标记槽位占用）
    const lockFile = path.join(CODEX_REVIEW_LOCK_DIR, `${task.id}.lock`);
    await writeFile(lockFile, JSON.stringify({ taskId: task.id, runId, startedAt: new Date().toISOString() }));

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

    const child = spawn(codexBin, ['exec', '-c', 'approval_policy="never"', promptContent], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: WORK_DIR,
      env: { ...process.env, TASK_ID: task.id, RUN_ID: runId, BRAIN_URL: process.env.BRAIN_URL || 'http://localhost:5221' },
    });

    // 收集 stdout，解析审查结果后回调 Brain
    let stdout = '';
    child.stdout?.on('data', (d) => { stdout += d.toString(); });

    child.on('error', async (err) => {
      console.error(`[executor] codex spawn error: ${err.message} task=${task.id}`);
      try { unlinkSync(lockFile); } catch {}
      try {
        const brainUrl = process.env.BRAIN_URL || 'http://localhost:5221';
        await fetch(`${brainUrl}/api/brain/execution-callback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
          headers: { 'Content-Type': 'application/json' },
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
async function buildCodexPromptContent(task) {
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

/** Build runner config for the bridge payload (codex_dev / crystallize / prompt modes). */
function buildCodexRunnerConfig(task, taskBranch, isCodexDev, isCrystallize) {
  if (isCodexDev) {
    return {
      runner: 'packages/engine/runners/codex/runner.sh',
      runner_args: ['--branch', taskBranch, '--task-id', task.id],
    };
  }
  if (isCrystallize) {
    return {
      runner: 'packages/engine/runners/codex/playwright-runner.sh',
      runner_args: ['--task-id', task.id],
    };
  }
  return { runner: undefined, runner_args: undefined };
}

/** Assemble the full request body for the Codex Bridge /run endpoint. */
function buildCodexBridgePayload(task, promptContent, taskBranch, injectedAccounts, isCodexDev, isCrystallize) {
  const { runner, runner_args } = buildCodexRunnerConfig(task, taskBranch, isCodexDev, isCrystallize);
  return {
    task_id: task.id,
    checkpoint_id: null,
    prompt: promptContent,
    task_type: task.task_type,
    work_dir: task.payload?.repo_path,
    timeout_ms: 10 * 60 * 1000,
    runner,
    runner_args,
    branch: taskBranch,
    accounts: injectedAccounts.length > 0 ? injectedAccounts : undefined,
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
 * codex_dev → runner 模式：启动 runners/codex/runner.sh，source devloop-check.sh 驱动完整 /dev 循环
 *
 * @param {Object} task - The task object from database
 * @returns {Object} - { success, taskId, runId, error? }
 */
async function triggerCodexBridge(task, forceBridgeUrl = null) {
  const runId = generateRunId(task.id);
  try {
    const isCodexDev = task.task_type === 'codex_dev';
    const isCrystallize = task.task_type === 'crystallize_forge' || task.task_type === 'crystallize_verify';

    console.log(`[executor] Calling Xian Codex Bridge for task=${task.id} type=${task.task_type}${forceBridgeUrl ? ` (pinned: ${forceBridgeUrl})` : ''}`);

    const promptContent = await buildCodexPromptContent(task);
    const taskBranch = buildCodexTaskBranch(task, isCodexDev);
    const injectedAccounts = await selectCodexAccounts();

    const bridgeUrl = forceBridgeUrl ?? await selectBestBridge();
    if (!bridgeUrl) {
      // selectBestBridge 返回 null 表示所有 bridge /health 都失败 — 直接放弃 dispatch，
      // 让 dispatcher 把 task 回 queued，释放 Codex 并发池 slot（learning fdf87ba0 死锁防御）。
      console.warn(`[executor] Codex Bridge 不可用 — task=${task.id} 跳过 dispatch`);
      return { success: false, taskId: task.id, error: 'no_live_codex_bridge', executor: 'codex-bridge' };
    }

    // Dispatch 层 preflight 存活检查：forceBridgeUrl 路径绕过了 selectBestBridge 的健康过滤，
    // 而 selectBestBridge 的结果也可能在选完后到这里的几毫秒间端点掉线。
    // 派任务前做一次短超时存活探测，失败即放弃，避免 task 被死端点吞掉永远占 slot。
    // 根因：learning fdf87ba0 — Codex 端点断联 8 天产生永久并发池死锁。
    try {
      const livenessRes = await fetch(`${bridgeUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (!livenessRes.ok) throw new Error(`HTTP ${livenessRes.status}`);
    } catch (preflightErr) {
      console.warn(`[executor] Codex Bridge preflight 失败 ${bridgeUrl}: ${preflightErr.message} (task=${task.id})`);
      return { success: false, taskId: task.id, error: `codex_bridge_preflight_failed: ${preflightErr.message}`, executor: 'codex-bridge' };
    }

    const payload = buildCodexBridgePayload(task, promptContent, taskBranch, injectedAccounts, isCodexDev, isCrystallize);
    const response = await fetch(`${bridgeUrl}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    const result = await response.json();

    if (!result.ok) {
      console.log(`[executor] Codex Bridge rejected: ${result.error}`);
      return { success: false, taskId: task.id, error: result.error, executor: 'codex-bridge' };
    }

    console.log(`[executor] Codex Bridge accepted task=${task.id} account=${result.account}`);
    return { success: true, taskId: task.id, runId, executor: 'codex-bridge', account: result.account };
  } catch (err) {
    console.error(`[executor] Codex Bridge error: ${err.message}`);
    return { success: false, taskId: task.id, error: err.message, executor: 'codex-bridge' };
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
      `curl -s -X POST "${WEBHOOK_URL}" -H "Content-Type: application/json" \\`,
      `  -d "{\\"task_id\\":\\"${task.id}\\",\\"run_id\\":\\"${runId}\\",\\"status\\":\\"AI Done\\",\\"exit_code\\":$EXIT}" \\`,
      '  --max-time 10 2>/dev/null || true',
    ].join('\n');
    await writeFile(tmpScriptFile, scriptContent, { mode: 0o755 });

    const proc = spawn('bash', [tmpScriptFile], { detached: true, stdio: 'ignore' });
    proc.unref();

    console.log(`[executor] Local Codex spawned task=${task.id} pid=${proc.pid} slot=${path.basename(slotPath)}`);
    return { success: true, taskId: task.id, runId, executor: 'local-codex', pid: proc.pid };
  } catch (err) {
    console.error(`[executor] Local Codex error for task=${task.id}: ${err.message}`);
    return { success: false, taskId: task.id, error: err.message, executor: 'local-codex' };
  }
}

/**
 * runHarnessInitiativeRouter — harness_initiative 路由分支的可测函数化。
 *
 * Spec: docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md
 * §W1 (thread_id 版本化), §W3 (AbortSignal + watchdog), §W4 (streamMode → events)
 *
 * - W1: thread_id = `harness-initiative:<id>:<attemptN>`，attemptN = task.execution_attempts + 1。
 *       payload.resume_from_checkpoint=true 才续 checkpoint，否则 fresh start。
 *       同 attemptN 已有 checkpoint 但未 resume → 升 N 写新 thread。
 * - W3: invoke 加 AbortSignal，deadline 来源 initiative_runs.deadline_at fallback 6h。
 *       逾期触发 abort，标 task.failure_class='watchdog_deadline'。
 * - W4: invoke → stream({streamMode:'updates'})，逐 node 推 emitGraphNodeUpdate
 *       事件到 task_events 表（cap 100 防写爆）。
 *
 * @param {object} task - tasks 表行
 * @param {object} [opts] - { pool, compiled } 测试可注入
 * @returns {Promise<{ ok: boolean, threadId: string, attemptN: number, finalState?: object, error?: string }>}
 */
export async function runHarnessInitiativeRouter(task, opts = {}) {
  const dbPool = opts.pool || pool;
  const { compileHarnessFullGraph } = await import('./workflows/harness-initiative.graph.js');
  const { getPgCheckpointer } = await import('./orchestrator/pg-checkpointer.js');
  const { emitGraphNodeUpdate } = await import('./events/taskEvents.js');
  const compiled = opts.compiled || await compileHarnessFullGraph();
  const initiativeId = task.payload?.initiative_id || task.id;

  // W1 — thread_id 版本化
  const baseAttemptN = (task.execution_attempts || 0) + 1;
  let attemptN = baseAttemptN;
  let threadId = `harness-initiative:${initiativeId}:${attemptN}`;

  const checkpointer = await getPgCheckpointer();
  const existing = await checkpointer.get({ configurable: { thread_id: threadId } });
  const resumeRequested = task.payload?.resume_from_checkpoint === true;
  let input;
  if (existing && resumeRequested) {
    input = null;  // 显式 resume from checkpoint
  } else if (existing && !resumeRequested) {
    // 同 attemptN 已有 checkpoint 但未 resume → 升 N，留旧 checkpoint 诊断
    attemptN = baseAttemptN + 1;
    threadId = `harness-initiative:${initiativeId}:${attemptN}`;
    input = { task };
    await dbPool.query('UPDATE tasks SET execution_attempts=$1 WHERE id=$2', [attemptN, task.id]);
  } else {
    input = { task };  // fresh start
  }

  // W3 — AbortSignal + watchdog
  const deadlineRow = await dbPool.query(
    'SELECT deadline_at FROM initiative_runs WHERE initiative_id=$1 ORDER BY created_at DESC LIMIT 1',
    [initiativeId]
  );
  const deadlineAt = deadlineRow.rows[0]?.deadline_at;
  const deadlineMs = deadlineAt
    ? Math.max(60_000, new Date(deadlineAt).getTime() - Date.now())  // 至少 1min
    : 6 * 3600 * 1000;  // fallback 6h
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new Error(`harness_watchdog: deadline exceeded for ${initiativeId} thread=${threadId}`)),
    deadlineMs
  );

  let final = null;
  try {
    // W4 — streamMode='updates' 逐节点推 task_events
    const stream = await compiled.stream(input, {
      configurable: { thread_id: threadId },
      recursionLimit: 500,
      signal: ctrl.signal,
      streamMode: 'updates',
    });
    let nodeCount = 0;
    const MAX_EVENTS = 100;  // 防写爆
    for await (const update of stream) {
      for (const [nodeName, partialState] of Object.entries(update || {})) {
        if (nodeCount < MAX_EVENTS) {
          try {
            await emitGraphNodeUpdate({
              taskId: task.id,
              initiativeId,
              threadId,
              nodeName,
              attemptN,
              payloadSummary: summarizeNodeState(partialState),
            });
          } catch (emitErr) {
            console.warn(`[executor] emitGraphNodeUpdate failed (non-fatal): ${emitErr.message}`);
          }
          nodeCount++;
        }
        final = { ...(final || {}), ...partialState };
      }
    }
  } catch (err) {
    if (err.name === 'AbortError' || /watchdog/i.test(err.message)) {
      try {
        await dbPool.query(
          `UPDATE tasks SET error_message=$1,
             custom_props = jsonb_set(COALESCE(custom_props,'{}'::jsonb), '{failure_class}', '"watchdog_deadline"'::jsonb)
           WHERE id=$2`,
          [`watchdog deadline at ${new Date().toISOString()}`, task.id]
        );
      } catch (markErr) {
        console.warn(`[executor] mark watchdog failure failed (non-fatal): ${markErr.message}`);
      }
      return { ok: false, threadId, attemptN, error: 'watchdog_deadline' };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  return {
    ok: computeHarnessInitiativeOk(final),
    error: computeHarnessInitiativeError(final),
    threadId,
    attemptN,
    finalState: {
      initiativeId,
      sub_tasks: final?.sub_tasks,
      final_e2e_verdict: final?.final_e2e_verdict,
      final_e2e_failed_scenarios: final?.final_e2e_failed_scenarios,
      error: final?.error,
    },
  };
}

/**
 * Bug 3 fix: 判断 harness initiative graph 是否成功完成
 * verdict=FAIL 必须返 false（即便 error 字段没设）
 *
 * @param {object|null} final - graph 最终 state
 * @returns {boolean} ok
 */
export function computeHarnessInitiativeOk(final) {
  if (!final) return false;
  if (final.error) return false;
  if (final.final_e2e_verdict === 'FAIL') return false;
  return true;
}

/**
 * Bug 3 fix: 计算 harness initiative 失败时的 error_message
 * 优先使用 final.error；其次从 final_e2e_verdict=FAIL 的 failed_scenarios 拼装
 * 保证 ≤ 500 字符（DB 字段长度限制）
 *
 * @param {object|null} final - graph 最终 state
 * @returns {string|undefined} error message or undefined if no error（保持 r.error undefined 跟现有 watchdog 集成测试一致）
 */
export function computeHarnessInitiativeError(final) {
  if (!final) return 'harness graph returned no state (null final)';
  if (final.error) {
    if (typeof final.error === 'string') return final.error.slice(0, 500);
    return (final.error.message || JSON.stringify(final.error)).slice(0, 500);
  }
  if (final.final_e2e_verdict === 'FAIL') {
    const scenarios = (final.final_e2e_failed_scenarios || [])
      .map((s) => s.name || s.failed_step || 'unknown')
      .join('; ');
    return `final_e2e_verdict=FAIL: ${scenarios}`.slice(0, 500);
  }
  return undefined;
}

/**
 * 安全 summarize node state — 长字符串截断、对象/数组只记 shape，避免 task_events 写爆。
 * @param {object} state
 * @returns {object}
 */
export function summarizeNodeState(state) {
  const out = {};
  for (const [k, v] of Object.entries(state || {})) {
    if (v == null) continue;
    if (typeof v === 'string') out[k] = v.length > 200 ? v.slice(0, 200) + '…' : v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = `[Array ${v.length}]`;
    else if (typeof v === 'object') out[k] = `{Object ${Object.keys(v).length} keys}`;
  }
  return out;
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
//   location='us'   → US cecelia-bridge（Claude Code，10-slot 池）
// 注意：Coding 通道（dev/codex_dev/initiative_plan 等）在 task-router.js 中标注为 'us'，
//       不需要在此维护第二份白名单，改 task-router.js 即可影响路由。

async function triggerCeceliaRun(task) {
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

  // 2. 西安 Codex Bridge（location='xian'，负载均衡 M4+M1）
  // 动态类型优先走缓存 location，静态类型走 LOCATION_MAP
  if (location === 'xian') {
    const src = dynamicLocation ? 'dynamic-cache' : 'location-map';
    console.log(`[executor] 路由决策: task_type=${task.task_type} → Codex Bridge (location=xian, src=${src})`);
    return triggerCodexBridge(task);
  }

  // 2.1 西安M1 Codex Bridge（location='xian_m1'，钉到 M1 专用节点）
  if (location === 'xian_m1') {
    const src = dynamicLocation ? 'dynamic-cache' : 'location-map';
    console.log(`[executor] 路由决策: task_type=${task.task_type} → Codex Bridge M1 (location=xian_m1, src=${src})`);
    return triggerCodexBridge(task, XIAN_M1_BRIDGE_URL);
  }

  // 2.5 US 本机 Codex CLI（spec_review / code_review_gate 独立 2-slot 池）
  if (task.task_type === 'spec_review' || task.task_type === 'code_review_gate') {
    console.log(`[executor] 路由决策: task_type=${task.task_type} → Local Codex CLI (review pool)`);
    return triggerLocalCodexExec(task);
  }

  // 2.8 US 本机 Codex CLI（B类动态任务 executor=codex，前台可配）
  if (location === 'us' && dynamicExecutor === 'codex') {
    console.log(`[executor] 路由决策: task_type=${task.task_type} → Local Codex CLI (dynamic executor=codex)`);
    return triggerLocalCodexExec(task);
  }

  // 2.85 Harness Full Graph (Phase A+B+C) — 一个 graph 跑到底，默认路径。
  // W1 (thread_id 版本化) + W3 (AbortSignal + watchdog) + W4 (streamMode events)
  // 实现下沉到 runHarnessInitiativeRouter，便于测试 + 复用。
  if (task.task_type === 'harness_initiative') {
    console.log(`[executor] 路由决策: task_type=${task.task_type} → Harness Full Graph (A+B+C)`);
    try {
      const result = await runHarnessInitiativeRouter(task);
      // harness_initiative 是同步阻塞执行（无回调），executor 必须自行回写状态
      if (result.ok) {
        await updateTaskStatus(task.id, 'completed');
      } else {
        await updateTaskStatus(task.id, 'failed', { error_message: String(result.error || 'harness graph failed').slice(0, 500) });
      }
      return {
        success: true, // executor 已处理完毕，dispatcher 无需回退 queued
        taskId: task.id,
        initiative: true,
        fullGraph: true,
        threadId: result.threadId,
        attemptN: result.attemptN,
        finalState: result.finalState,
        error: result.error,
      };
    } catch (err) {
      console.error(`[executor] Harness Full Graph error task=${task.id}: ${err.message}`);
      try {
        await updateTaskStatus(task.id, 'failed', { error_message: err.message.slice(0, 500) });
      } catch (updateErr) {
        console.error(`[executor] 状态回写失败 task=${task.id}: ${updateErr.message}`);
      }
      return { success: true, taskId: task.id, initiative: true, error: err.message?.slice(0, 500) };
    }
  }

  // Retired harness task_types — 全部归入 harness_initiative full-graph sub-graph。
  // - Sprint 1 (PR #2640)：harness_task / harness_ci_watch / harness_fix / harness_final_e2e
  // - retire-harness-planner (PR 本次)：harness_planner（subsumed by harness_initiative full graph）
  // 老数据派到 executor → 标 terminal failure 防止"复活"。
  const _RETIRED_HARNESS_TYPES = new Set([
    'harness_task', 'harness_ci_watch', 'harness_fix', 'harness_final_e2e',
    'harness_planner',  // retired in PR retire-harness-planner; subsumed by harness_initiative full graph
  ]);
  if (_RETIRED_HARNESS_TYPES.has(task.task_type)) {
    console.warn(`[executor] retired task_type=${task.task_type} task=${task.id} → marking pipeline_terminal_failure`);
    try {
      await pool.query(
        `UPDATE tasks SET status='failed', completed_at=NOW(),
          error_message=$2,
          payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('failure_class', 'pipeline_terminal_failure')
         WHERE id=$1::uuid`,
        [task.id, `task_type ${task.task_type} retired (subsumed by harness_initiative full graph)`]
      );
    } catch (err) {
      console.error(`[executor] mark retired task failed: ${err.message}`);
    }
    return { success: false, retired: true, taskType: task.task_type };
  }

  // 3. US → Claude Code（本机 cecelia-bridge，10-slot 池）
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
    // 无头模式下 tty 不可用，注入 CLAUDE_SESSION_ID 供 Stop Hook _session_matches() 会话隔离
    // worktree-manage.sh 写 .dev-lock 时读取此变量作为 session_id 字段
    extraEnv.CLAUDE_SESSION_ID = task.id;
    const model = getModelForTask(task);

    // Update task with run info before execution
    await updateTaskRunInfo(task.id, runId, 'triggered');

    // RPE 基线：记录期望奖赏（fire-and-forget，失败不阻塞派发）
    const skill = task.payload?.skill || taskType;
    recordExpectedReward(task.id, taskType, skill)
      .catch(e => console.warn(`[executor] recordExpectedReward 失败（非阻断）: ${e.message}`));

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

    // 凭据：profile 显式配置的就传给 spawn()，由其内层 account-rotation middleware
    // 检查 spending cap / auth fail 并按 cascade 兜底。caller 不再做内联 fallback，
    // dispatched_account 记账由 spawn 外层 billing middleware 接管。
    const credentials = getCredentialsForTask(task);
    if (credentials) {
      extraEnv.CECELIA_CREDENTIALS = credentials;
    }

    // ── Docker Sandbox 分支（HARNESS_DOCKER_ENABLED=true）───────────────────
    // 用 Docker container 替换 cecelia-run.sh + worktree spawn 的脆弱模式。
    // 完成后写 callback_queue，下游 callback-worker 与 bridge 路径一致。
    if (process.env.HARNESS_DOCKER_ENABLED === 'true') {
      const extraEnvKeys = Object.keys(extraEnv);
      const tier = resolveResourceTier(taskType);
      console.log(
        `[executor] HARNESS_DOCKER_ENABLED=true → spawn() task=${task.id} type=${taskType} tier=${tier.tier}${repoPath ? ` repo=${repoPath}` : ''}${extraEnvKeys.length ? ` extra_env=[${extraEnvKeys.join(',')}]` : ''}`
      );

      // 注入 webhook + 上下文（与 cecelia-run 行为对齐）
      const dockerEnv = {
        ...extraEnv,
        WEBHOOK_URL: `${process.env.BRAIN_URL || 'http://localhost:5221'}/api/brain/execution-callback`,
        CECELIA_CORE_API: process.env.BRAIN_URL || 'http://localhost:5221',
        CECELIA_PERMISSION_MODE: permissionMode,
        CECELIA_TASK_TYPE: taskType,
      };
      if (model) dockerEnv.CECELIA_MODEL = model;
      if (provider) dockerEnv.CECELIA_PROVIDER = provider;

      const dockerResult = await spawnDocker({
        task,
        prompt: promptContent,
        env: dockerEnv,
        worktreePath: repoPath || undefined,
      });

      activeProcesses.set(task.id, {
        pid: null,
        startedAt: dockerResult.started_at,
        runId,
        checkpointId,
        docker: true,
        container: dockerResult.container,
      });

      // 完成后写 callback_queue（保持下游路径兼容）
      try {
        await writeDockerCallback(task, runId, checkpointId, dockerResult);
      } catch (cbErr) {
        console.error(`[executor] writeDockerCallback failed task=${task.id}: ${cbErr.message}`);
      }

      await trace.end({
        status: dockerResult.exit_code === 0 ? STATUS.SUCCESS : STATUS.FAILED,
        outputSummary: {
          checkpoint_id: checkpointId,
          container: dockerResult.container,
          exit_code: dockerResult.exit_code,
          duration_ms: dockerResult.duration_ms,
          timed_out: dockerResult.timed_out,
        },
      });

      recordSessionStart();

      return {
        success: dockerResult.exit_code === 0 && !dockerResult.timed_out,
        runId,
        taskId: task.id,
        checkpointId,
        docker: true,
        container: dockerResult.container,
        exitCode: dockerResult.exit_code,
        durationMs: dockerResult.duration_ms,
        timedOut: dockerResult.timed_out,
      };
    }

    // Call original cecelia-bridge via HTTP (POST /trigger-cecelia)
    const extraEnvKeys = Object.keys(extraEnv);
    console.log(`[executor] Calling cecelia-bridge for task=${task.id} type=${taskType} mode=${permissionMode}${model ? ` model=${model}` : ''}${provider ? ` provider=${provider}` : ''}${repoPath ? ` repo=${repoPath}` : ''}${extraEnvKeys.length ? ` extra_env=[${extraEnvKeys.join(',')}]` : ''}`);

    const response = await fetch(`${EXECUTOR_BRIDGE_URL}/trigger-cecelia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
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
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      console.error(`[executor] Bridge /trigger-cecelia timed out (30s) for task=${task.id} — bridge may be unresponsive`);
    } else {
      console.error(`[executor] Error triggering via bridge: ${err.message}`);
    }

    // Trace: failure
    await trace.end({
      status: STATUS.FAILED,
      error: err,
    });

    return {
      success: false,
      taskId: task.id,
      error: err.name === 'AbortError' || err.name === 'TimeoutError' ? 'bridge_timeout' : err.message,
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

    // content-pipeline parent tasks and all content-* stage tasks are orchestrated externally
    // by the ZJ pipeline-worker (Python LangGraph, see PR zenithjoy#216). They have no OS
    // process inside Brain, so the liveness probe must skip them — otherwise it would mark
    // legitimate ZJ-managed tasks as zombies.
    const CONTENT_PIPELINE_TYPES = new Set([
      'content-pipeline', 'content-research', 'content-copywriting',
      'content-copy-review', 'content-generate', 'content-image-review', 'content-export',
    ]);
    if (CONTENT_PIPELINE_TYPES.has(task.task_type) || task.payload?.pipeline_orchestrated === true) {
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

      // Tasks with run_id = null never spawned a real process — they are inline
      // orchestration markers (e.g. content-pipeline). On Brain restart these
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
  // v16: Machine Registry + capability tags routing
  MACHINE_REGISTRY,
  selectBestMachine,
  // v17: Docker Sandbox executor (HARNESS_DOCKER_ENABLED=true) — spawn() 已成唯一入口，
  // 仅保留 callback / 资源 tier / 探活辅助函数对外。
  writeDockerCallback,
  resolveResourceTier,
  isDockerAvailable,
};
