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
import pool from './db.js';
import { getTaskLocation } from './task-router.js';
import { updateTaskStatus, updateTaskProgress } from './task-updater.js';

// HK MiniMax Executor URL (via Tailscale)
const HK_MINIMAX_URL = process.env.HK_MINIMAX_URL || 'http://100.86.118.99:5226';

// Configuration
const CECELIA_RUN_PATH = process.env.CECELIA_RUN_PATH || '/home/xx/bin/cecelia-run';
const PROMPT_DIR = '/tmp/cecelia-prompts';
const WORK_DIR = process.env.CECELIA_WORK_DIR || '/home/xx/dev/cecelia-workspace';

// Resource thresholds — dynamic seat scaling based on actual load
const CPU_CORES = os.cpus().length;
const TOTAL_MEM_MB = Math.round(os.totalmem() / 1024 / 1024);
const MEM_PER_TASK_MB = 500;                      // ~500MB avg per claude process (200-850MB observed)
const CPU_PER_TASK = 0.5;                         // ~0.5 core avg per claude process (20-30% bursts, often idle waiting API)
const USABLE_MEM_MB = TOTAL_MEM_MB * 0.8;        // 80% of total memory is usable (keep 20% headroom)
const USABLE_CPU = CPU_CORES * 0.8;              // 80% of CPU is usable (keep 20% headroom)
// Max seats = min(memory capacity, CPU capacity), floor of 2
const MAX_SEATS = parseInt(process.env.CECELIA_MAX_CONCURRENT || String(
  Math.max(Math.floor(Math.min(USABLE_MEM_MB / MEM_PER_TASK_MB, USABLE_CPU / CPU_PER_TASK)), 2)
), 10);
const LOAD_THRESHOLD = CPU_CORES * 0.85;          // Hard stop: 85% of cores
const MEM_AVAILABLE_MIN_MB = TOTAL_MEM_MB * 0.15; // Hard stop: must have 15% free
const SWAP_USED_MAX_PCT = 50;                     // Hard stop: swap > 50%

/**
 * Check server resource availability before spawning.
 * Returns { ok, reason, metrics } — ok=false means don't spawn.
 */
function checkServerResources() {
  const loadAvg1 = os.loadavg()[0];
  const freeMem = Math.round(os.freemem() / 1024 / 1024);

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

  // Calculate resource pressure (0.0 = idle, 1.0 = at threshold)
  const cpuPressure = loadAvg1 / LOAD_THRESHOLD;                      // e.g. 4.0/6.4 = 0.625
  const memPressure = 1 - (freeMem / (TOTAL_MEM_MB * 0.8));           // invert: more free = less pressure
  const swapPressure = swapUsedPct / SWAP_USED_MAX_PCT;               // e.g. 20/50 = 0.4
  const maxPressure = Math.max(cpuPressure, Math.max(memPressure, swapPressure));

  // Dynamic seat scaling based on highest pressure
  //   pressure < 0.5  → full seats (MAX_SEATS)
  //   pressure 0.5-0.7 → 2/3 of seats
  //   pressure 0.7-0.9 → 1/3 of seats
  //   pressure >= 0.9  → 1 seat (minimum)
  //   pressure >= 1.0  → 0 (hard stop, ok=false)
  let effectiveSlots = MAX_SEATS;
  if (maxPressure >= 1.0) {
    effectiveSlots = 0;
  } else if (maxPressure >= 0.9) {
    effectiveSlots = 1;
  } else if (maxPressure >= 0.7) {
    effectiveSlots = Math.max(Math.round(MAX_SEATS / 3), 1);
  } else if (maxPressure >= 0.5) {
    effectiveSlots = Math.max(Math.round(MAX_SEATS * 2 / 3), 1);
  }

  const metrics = {
    load_avg_1m: loadAvg1,
    load_threshold: LOAD_THRESHOLD,
    free_mem_mb: freeMem,
    mem_min_mb: MEM_AVAILABLE_MIN_MB,
    swap_used_pct: swapUsedPct,
    swap_max_pct: SWAP_USED_MAX_PCT,
    cpu_cores: CPU_CORES,
    total_mem_mb: TOTAL_MEM_MB,
    cpu_pressure: Math.round(cpuPressure * 100) / 100,
    mem_pressure: Math.round(memPressure * 100) / 100,
    swap_pressure: Math.round(swapPressure * 100) / 100,
    max_pressure: Math.round(maxPressure * 100) / 100,
    max_seats: MAX_SEATS,
    effective_slots: effectiveSlots,
  };

  if (effectiveSlots === 0) {
    const reasons = [];
    if (cpuPressure >= 1.0) reasons.push(`CPU load ${loadAvg1.toFixed(1)} > ${LOAD_THRESHOLD}`);
    if (freeMem < MEM_AVAILABLE_MIN_MB) reasons.push(`Memory ${freeMem}MB < ${MEM_AVAILABLE_MIN_MB}MB`);
    if (swapUsedPct > SWAP_USED_MAX_PCT) reasons.push(`Swap ${swapUsedPct}% > ${SWAP_USED_MAX_PCT}%`);
    return { ok: false, reason: `Server overloaded: ${reasons.join(', ')}`, effectiveSlots: 0, metrics };
  }

  return { ok: true, reason: null, effectiveSlots, metrics };
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
    if (!isProcessAlive(entry.pid)) {
      console.log(`[executor] Pruning dead process: task=${taskId} pid=${entry.pid}`);
      activeProcesses.delete(taskId);
    }
  }

  // Count ALL claude processes on the system (headed + headless)
  let systemClaudeCount = 0;
  try {
    const result = execSync('pgrep -c "^claude$" 2>/dev/null || echo 0', { encoding: 'utf-8' });
    systemClaudeCount = parseInt(result.trim(), 10) || 0;
  } catch {
    // pgrep failed, fall back to ps
    try {
      const result = execSync('ps aux | grep -E "^[^ ]+[ ]+[0-9]+.*claude$" | grep -v grep | wc -l', { encoding: 'utf-8' });
      systemClaudeCount = parseInt(result.trim(), 10) || 0;
    } catch {
      systemClaudeCount = 0;
    }
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
    const output = execSync(
      "ps aux | grep 'claude -p /dev' | grep -v grep | awk '{print $2}'",
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();

    if (!output) {
      console.log('[executor] No orphan claude processes found');
      return 0;
    }

    const pids = output.split('\n').map(p => parseInt(p, 10)).filter(p => !isNaN(p));
    const trackedPids = new Set([...activeProcesses.values()].map(e => e.pid));

    let killed = 0;
    for (const pid of pids) {
      if (!trackedPids.has(pid)) {
        try {
          process.kill(pid, 'SIGTERM');
          killed++;
          console.log(`[executor] Killed orphan process: pid=${pid}`);
        } catch {
          // already dead
        }
      }
    }

    console.log(`[executor] Orphan cleanup: found=${pids.length} killed=${killed} tracked=${trackedPids.size}`);
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
  const timestamp = Date.now();
  return `run-${taskId.slice(0, 8)}-${timestamp}`;
}

/**
 * Task Type 权限模型（v2 - 合并 QA + Audit → Review）：
 *
 * | 类型       | Skill    | 权限模式           | 说明                     |
 * |------------|----------|-------------------|--------------------------|
 * | dev        | /dev     | bypassPermissions | 完整代码读写              |
 * | review     | /review  | plan              | 只读代码，输出报告/PRD    |
 * | talk       | /talk    | plan              | 只写文档，不改代码        |
 * | automation | /nobel   | bypassPermissions | 调 N8N API               |
 * | research   | -        | plan              | 完全只读                 |
 *
 * 注意：qa 和 audit 已合并为 review，保留兼容映射
 */

/**
 * Get skill command based on task_type
 */
function getSkillForTaskType(taskType) {
  const skillMap = {
    'dev': '/dev',           // 开发：完整代码读写
    'review': '/review',     // 审查：Plan Mode，只读代码，输出报告
    'qa_init': '/review init', // QA 初始化：设置 CI 和分支保护
    'automation': '/nobel',  // N8N：调 API
    'talk': '/talk',         // 对话：写文档，不改代码
    'research': null,        // 研究：完全只读
    // 兼容旧类型（映射到 review）
    'qa': '/review',
    'audit': '/review',
  };
  return skillMap[taskType] || '/dev';
}

/**
 * Get model for a task based on task properties
 * Returns model name or null (use default Sonnet)
 */
function getModelForTask(task) {
  // OKR decomposition → Opus (strategic thinking)
  if (task.payload?.decomposition === 'true') return 'opus';
  // Review/QA tasks → Sonnet (good enough for code review)
  if (['review', 'qa', 'audit'].includes(task.task_type)) return null;
  // Default: null (cecelia-run default = Sonnet)
  return null;
}

/**
 * Get permission mode based on task_type
 * plan = 只读/Plan Mode，不能修改文件
 * bypassPermissions = 完全自动化，跳过权限检查
 */
function getPermissionModeForTaskType(taskType) {
  const modeMap = {
    'dev': 'bypassPermissions',        // 完整代码读写
    'automation': 'bypassPermissions', // 调 N8N API
    'qa_init': 'bypassPermissions',    // QA 初始化需要写文件和调 gh API
    'review': 'plan',                  // 只读代码，输出报告
    'talk': 'plan',                    // 只写文档，不改代码
    'research': 'plan',                // 只读，不改文件
    // 兼容旧类型（都用 plan mode）
    'qa': 'plan',
    'audit': 'plan',
  };
  return modeMap[taskType] || 'bypassPermissions';
}

/**
 * Prepare prompt content from task
 * Routes to different skills based on task.task_type
 */
function preparePrompt(task) {
  const taskType = task.task_type || 'dev';
  const skill = getSkillForTaskType(taskType);

  // OKR 拆解任务：秋米用 /okr skill + Opus
  if (task.payload?.decomposition === 'true') {
    return `/okr

# OKR 拆解: ${task.title}

${task.description || ''}`;
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

  // Automation 类型：调用 N8N，不写代码
  if (taskType === 'automation') {
    return `/nobel

# 自动化任务 - ${task.title}

${task.description || ''}

权限约束：
- ✅ 可以调用 N8N workflow API
- ✅ 可以查看 workflow 状态
- ❌ 不能修改代码文件`;
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
 * v3: Routes to HK MiniMax for talk/research/automation tasks.
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

  try {
    // === DEDUP CHECK ===
    const existing = activeProcesses.get(task.id);
    if (existing && isProcessAlive(existing.pid)) {
      console.log(`[executor] Task ${task.id} already running (pid=${existing.pid}), skipping`);
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
      return {
        success: false,
        taskId: task.id,
        reason: 'server_overloaded',
        detail: resources.reason,
        metrics: resources.metrics,
      };
    }

    const runId = generateRunId(task.id);
    const checkpointId = `cp-${task.id.slice(0, 8)}`;

    // Prepare prompt content, permission mode, and model based on task_type
    const taskType = task.task_type || 'dev';
    const promptContent = preparePrompt(task);
    const permissionMode = getPermissionModeForTaskType(taskType);
    const model = getModelForTask(task);

    // Update task with run info before execution
    await updateTaskRunInfo(task.id, runId, 'triggered');

    // Resolve repo_path from task's project
    let repoPath = null;
    if (task.project_id) {
      try {
        const projResult = await pool.query('SELECT repo_path FROM projects WHERE id = $1', [task.project_id]);
        repoPath = projResult.rows[0]?.repo_path || null;
      } catch { /* ignore */ }
    }

    // Call original cecelia-bridge via HTTP (POST /trigger-cecelia)
    console.log(`[executor] Calling cecelia-bridge for task=${task.id} type=${taskType} mode=${permissionMode}${model ? ` model=${model}` : ''}${repoPath ? ` repo=${repoPath}` : ''}`);

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
        model: model
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
      // Tracked process — check by PID or run_id
      if (entry.pid) {
        isAlive = isProcessAlive(entry.pid);
      } else if (entry.bridge && runId) {
        isAlive = isRunIdProcessAlive(runId);
      } else {
        // Bridge without run_id — cannot verify, assume alive
        isAlive = true;
      }
    } else if (runId) {
      // Not tracked in memory but has run_id — check system processes
      isAlive = isRunIdProcessAlive(runId);
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

    // Auto-fail the task
    const errorDetails = {
      type: 'liveness_probe_failed',
      message: `Process not found after double-confirm probe (suspect since ${suspect.firstSeen})`,
      first_suspect_at: suspect.firstSeen,
      probe_ticks: suspect.tickCount + 1,
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

    // Check if process exists
    let processExists = false;

    if (runId) {
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

      const errorDetails = {
        type: 'orphan_detected',
        message: 'Task was in_progress but no matching process found on Brain startup',
        detected_at: new Date().toISOString(),
        run_id: runId || null,
      };

      await pool.query(
        `UPDATE tasks SET
          status = 'failed',
          payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
        WHERE id = $1`,
        [task.id, JSON.stringify({ error_details: errorDetails })]
      );

      orphansFixed++;
      console.log(`[startup-sync] Orphan fixed: task=${task.id} title="${task.title}"`);
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
  generateRunId,
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
  suspectProcesses,
  MAX_SEATS,
};
