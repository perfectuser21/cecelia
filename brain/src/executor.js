/**
 * Cecelia Executor - Trigger headless Claude Code execution
 *
 * v2: Process-level tracking to prevent runaway dispatch.
 * - Tracks child PIDs in memory (activeProcesses Map)
 * - Deduplicates by taskId before spawning
 * - Cleans up orphan `claude -p` processes on startup
 * - Dynamic resource check before spawning (CPU load + memory)
 */

/* global console */
import { spawn, execSync } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import { readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import pool from './db.js';
import { getTaskLocation } from './task-router.js';

// HK MiniMax Executor URL (via Tailscale)
const HK_MINIMAX_URL = process.env.HK_MINIMAX_URL || 'http://100.86.118.99:5226';

// Configuration
const CECELIA_RUN_PATH = process.env.CECELIA_RUN_PATH || '/home/xx/bin/cecelia-run';
const PROMPT_DIR = '/tmp/cecelia-prompts';
const WORK_DIR = process.env.CECELIA_WORK_DIR || '/home/xx/dev/cecelia-workspace';

// Resource thresholds — don't spawn if server is overloaded
const CPU_CORES = os.cpus().length;
const TOTAL_MEM_MB = Math.round(os.totalmem() / 1024 / 1024);
const LOAD_THRESHOLD = CPU_CORES * 0.8;        // 80% of cores (e.g. 6.4 for 8-core)
const MEM_AVAILABLE_MIN_MB = TOTAL_MEM_MB * 0.2; // Must have 20% free (e.g. ~3GB for 15GB)
const SWAP_USED_MAX_PCT = 50;                    // Don't spawn if swap > 50% used

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

  const metrics = {
    load_avg_1m: loadAvg1,
    load_threshold: LOAD_THRESHOLD,
    free_mem_mb: freeMem,
    mem_min_mb: MEM_AVAILABLE_MIN_MB,
    swap_used_pct: swapUsedPct,
    swap_max_pct: SWAP_USED_MAX_PCT,
    cpu_cores: CPU_CORES,
    total_mem_mb: TOTAL_MEM_MB,
  };

  if (loadAvg1 > LOAD_THRESHOLD) {
    return { ok: false, reason: `CPU overloaded: load ${loadAvg1.toFixed(1)} > threshold ${LOAD_THRESHOLD}`, metrics };
  }
  if (freeMem < MEM_AVAILABLE_MIN_MB) {
    return { ok: false, reason: `Low memory: ${freeMem}MB free < ${MEM_AVAILABLE_MIN_MB}MB min`, metrics };
  }
  if (swapUsedPct > SWAP_USED_MAX_PCT) {
    return { ok: false, reason: `Swap overused: ${swapUsedPct}% > ${SWAP_USED_MAX_PCT}% max`, metrics };
  }

  return { ok: true, reason: null, metrics };
}

/**
 * In-memory process registry: taskId -> { pid, startedAt, runId, process }
 */
const activeProcesses = new Map();

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

      // Update task with result
      await pool.query(`
        UPDATE tasks
        SET
          status = 'completed',
          completed_at = NOW(),
          payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
            'minimax_result', $2::text,
            'minimax_usage', $3::jsonb,
            'run_id', $4::text
          )
        WHERE id = $1
      `, [task.id, result.result, JSON.stringify(result.usage || {}), runId]);

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

    // Prepare prompt content and permission mode based on task_type
    const taskType = task.task_type || 'dev';
    const promptContent = preparePrompt(task);
    const permissionMode = getPermissionModeForTaskType(taskType);

    // Update task with run info before execution
    await updateTaskRunInfo(task.id, runId, 'triggered');

    // Call original cecelia-bridge via HTTP (POST /trigger-cecelia)
    console.log(`[executor] Calling cecelia-bridge for task=${task.id} type=${taskType} mode=${permissionMode}`);

    const response = await fetch(`${EXECUTOR_BRIDGE_URL}/trigger-cecelia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: task.id,
        checkpoint_id: checkpointId,
        prompt: promptContent,
        task_type: taskType,
        permission_mode: permissionMode
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
  // v3 additions
  HK_MINIMAX_URL,
};
