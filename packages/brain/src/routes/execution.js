import { Router } from 'express';
import pool from '../db.js';
import crypto from 'crypto';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';
import { runTickSafe, getTickStatus } from '../tick.js';
import { generatePrdFromTask, generatePrdFromGoalKR, generateTrdFromGoal, generateTrdFromGoalKR, validatePrd, validateTrd, prdToJson, trdToJson, PRD_TYPE_MAP } from '../templates.js';
import { compareGoalProgress, generateDecision, executeDecision, rollbackDecision } from '../decision.js';
import { planNextTask, getPlanStatus, handlePlanInput, getGlobalState, selectTopAreas, selectActiveInitiativeForArea, ACTIVE_AREA_COUNT } from '../planner.js';
import { processEvent as thalamusProcessEvent, EVENT_TYPES } from '../thalamus.js';
import { executeDecision as executeThalamusDecision } from '../decision-executor.js';
import { generateTaskEmbeddingAsync } from '../embedding-service.js';
import { publishTaskCompleted, publishTaskFailed } from '../events/taskEvents.js';
import { emit as emitEvent } from '../event-bus.js';
import { recordSuccess as cbSuccess, recordFailure as cbFailure, reset as resetCB } from '../circuit-breaker.js';
import { notifyTaskCompleted } from '../notifier.js';
import { getAvailableMemoryMB } from '../platform-utils.js';
import { raise } from '../alerting.js';
import { handleTaskFailure, classifyFailure } from '../quarantine.js';
import { triggerCeceliaRun, checkCeceliaRunAvailable } from '../executor.js';
import { updateDesireFromTask } from '../desire-feedback.js';
import { checkAndCreateCodeReviewTrigger } from '../code-review-trigger.js';
import { getActiveExecutionPaths, INVENTORY_CONFIG, resolveRelatedFailureMemories } from './shared.js';
import { processExecutionCallback } from '../callback-processor.js';

const router = Router();
const execAsync = promisify(exec);
const HEARTBEAT_PATH = new URL('../../../HEARTBEAT.md', import.meta.url);

/**
 * POST /api/brain/execution-callback
 *
 * 改造后：将 callback 数据写入 callback_queue 表后立即返回 HTTP 200。
 * 由 callback-worker 异步处理队列记录，调用共享函数 processExecutionCallback。
 * 当 DB INSERT 失败时降级为直接调用 processExecutionCallback（兼容旧 Bridge）。
 */
router.post('/execution-callback', async (req, res) => {
  try {
    const {
      task_id,
      run_id,
      checkpoint_id,
      status,
      result,
      pr_url,
      duration_ms,
      iterations,
      exit_code,
      stderr,
      failure_class,
      account_id,
    } = req.body;

    if (!task_id) {
      return res.status(400).json({
        success: false,
        error: 'task_id is required'
      });
    }

    console.log(`[execution-callback] Received callback for task ${task_id}, status: ${status}`);

    // 将 callback 写入 callback_queue，由 worker 异步处理
    // 额外字段（pr_url、account_id）存入 result_json._meta，worker 读取时还原
    try {
      const resultJson = {
        ...(result !== null && typeof result === 'object' ? result : (result != null ? { _raw: result } : {})),
        _meta: {
          pr_url: pr_url || null,
          account_id: account_id || null,
        },
      };
      const stderrTail = stderr ? String(stderr).slice(-500) : null;
      const attemptVal = req.body.attempt || iterations || null;

      await pool.query(
        `INSERT INTO callback_queue
           (task_id, checkpoint_id, run_id, status, result_json, stderr_tail, duration_ms, attempt, exit_code, failure_class)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)`,
        [
          task_id,
          checkpoint_id || null,
          run_id || null,
          status || null,
          JSON.stringify(resultJson),
          stderrTail,
          duration_ms != null ? parseInt(duration_ms) : null,
          attemptVal != null ? parseInt(attemptVal) : null,
          exit_code != null ? parseInt(exit_code) : null,
          failure_class || null,
        ]
      );

      console.log(`[execution-callback] Queued callback for task ${task_id} (run_id=${run_id})`);
      return res.json({ success: true, queued: true });
    } catch (queueErr) {
      // callback_queue INSERT 失败时降级为直接处理（兼容表不存在等边缘情况）
      console.warn(`[execution-callback] callback_queue INSERT failed, falling back to direct processing: ${queueErr.message}`);
      try {
        const data = {
          task_id, run_id, checkpoint_id, status, result,
          pr_url, duration_ms, iterations, exit_code, stderr, failure_class, account_id,
        };
        await processExecutionCallback(data, pool);
        return res.json({ success: true });
      } catch (directErr) {
        console.error('[execution-callback] Direct processing also failed:', directErr.message);
        return res.status(500).json({ success: false, error: directErr.message });
      }
    }

  } catch (err) {
    console.error('[execution-callback] Error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to process execution callback',
      details: err.message
    });
  }
});

// ==================== (legacy handler body removed — now handled by callback-worker) ====================
// The original ~2800-line execution-callback handler has been extracted to:
//   packages/brain/src/callback-processor.js → processExecutionCallback()
//   packages/brain/src/callback-worker.js → startCallbackWorker()

// ==================== Heartbeat File API ====================


const HEARTBEAT_DEFAULT_TEMPLATE = `# HEARTBEAT.md — Cecelia 巡检清单

## 巡检项目

- [ ] 系统健康检查
- [ ] 任务队列状态
- [ ] 资源使用率
`;

/**
 * GET /api/brain/heartbeat
 * Read HEARTBEAT.md file content.
 * Returns default template if file does not exist.
 */
router.get('/heartbeat', async (req, res) => {
  try {
    const { readFile } = await import('fs/promises');
    const content = await readFile(HEARTBEAT_PATH, 'utf-8');
    res.json({ success: true, content });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.json({ success: true, content: HEARTBEAT_DEFAULT_TEMPLATE });
    }
    console.error('[heartbeat-file] GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/brain/heartbeat
 * Write content to HEARTBEAT.md file.
 * Request body: { content: "..." }
 */
router.put('/heartbeat', async (req, res) => {
  try {
    const { content } = req.body;
    if (content === undefined || content === null) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }
    const { writeFile } = await import('fs/promises');
    await writeFile(HEARTBEAT_PATH, content, 'utf-8');
    res.json({ success: true });
  } catch (err) {
    console.error('[heartbeat-file] PUT error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/brain/heartbeat
 * Heartbeat endpoint for running tasks to report liveness.
 *
 * Request body:
 *   {
 *     task_id: "uuid",
 *     run_id: "run-xxx-timestamp"  // optional, for validation
 *   }
 */
router.post('/heartbeat', async (req, res) => {
  try {
    const { task_id, run_id } = req.body;

    if (!task_id) {
      return res.status(400).json({ success: false, error: 'task_id is required' });
    }

    const { recordHeartbeat } = await import('../executor.js');
    const result = await recordHeartbeat(task_id, run_id);

    res.json(result);
  } catch (err) {
    console.error('[heartbeat] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/brain/executor/status
 * Check if cecelia-run executor is available
 */
router.get('/executor/status', async (req, res) => {
  try {
    const { checkCeceliaRunAvailable } = await import('../executor.js');
    const status = await checkCeceliaRunAvailable();
    res.json(status);
  } catch (err) {
    res.status(500).json({
      available: false,
      error: err.message
    });
  }
});

// ==================== Cluster Status API ====================

/**
 * GET /api/brain/cluster/status
 * Get status of all servers in the cluster (US + HK)
 */
router.get('/cluster/status', async (req, res) => {
  try {
    const os = await import('os');

    // Get US VPS slots using same logic as /vps-slots
    let usProcesses = [];
    try {
      const { stdout } = await execAsync('ps aux | grep -E " claude( |$)" | grep -v "grep" | grep -v "/bin/bash"');
      const lines = stdout.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 11) {
          usProcesses.push({
            pid: parseInt(parts[1]),
            cpu: `${parts[2]}%`,
            memory: `${parts[3]}%`,
            startTime: parts[8],
            command: parts.slice(10).join(' ').slice(0, 80)
          });
        }
      }
    } catch { /* no processes */ }

    const usUsed = usProcesses.length;
    const usCpuLoad = os.loadavg()[0];
    const usCpuCores = os.cpus().length;
    const usMemTotal = Math.round(os.totalmem() / (1024 * 1024 * 1024) * 10) / 10;
    const usMemFree = Math.round(getAvailableMemoryMB() / 1024 * 10) / 10;
    const usMemUsedPct = Math.round((1 - getAvailableMemoryMB() / (os.totalmem() / 1024 / 1024)) * 100);

    // 动态计算可用席位 (85% 安全阈值)
    const CPU_PER_CLAUDE = 0.5;
    const MEM_PER_CLAUDE_GB = 1.0;
    const SAFETY_MARGIN = 0.85;

    const usCpuTarget = usCpuCores * SAFETY_MARGIN;
    const usCpuHeadroom = Math.max(0, usCpuTarget - usCpuLoad);
    const usCpuAllowed = Math.floor(usCpuHeadroom / CPU_PER_CLAUDE);
    const usMemAvailable = Math.max(0, usMemFree - 2); // 保留 2GB
    const usMemAllowed = Math.floor(usMemAvailable / MEM_PER_CLAUDE_GB);
    const usDynamicMax = Math.min(usCpuAllowed, usMemAllowed, 12); // 硬上限 12

    const usServer = {
      id: 'us',
      name: 'US VPS',
      location: '🇺🇸 美国',
      ip: '146.190.52.84',
      status: 'online',
      resources: {
        cpu_cores: usCpuCores,
        cpu_load: Math.round(usCpuLoad * 10) / 10,
        cpu_pct: Math.round((usCpuLoad / usCpuCores) * 100),
        mem_total_gb: usMemTotal,
        mem_free_gb: usMemFree,
        mem_used_pct: usMemUsedPct
      },
      slots: {
        max: 12,              // 理论最大
        dynamic_max: usDynamicMax, // 当前资源可支持的最大
        used: usUsed,
        available: Math.max(0, usDynamicMax - usUsed - 1), // 减 1 预留
        reserved: 1,
        processes: usProcesses
      },
      task_types: ['dev', 'review', 'qa', 'audit']
    };

    // HK server status (via bridge)
    let hkServer = {
      id: 'hk',
      name: 'HK VPS',
      location: '🇭🇰 香港',
      ip: '124.156.138.116',
      status: 'offline',
      resources: null,
      slots: {
        max: 5,               // 理论最大
        dynamic_max: 0,       // 当前资源可支持的最大
        used: 0,
        available: 0,
        reserved: 0,
        processes: []
      },
      task_types: ['talk', 'research', 'data']
    };

    // Try to fetch HK status from bridge
    try {
      const hkBridgeUrl = process.env.HK_BRIDGE_URL || 'http://100.86.118.99:5225';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const hkRes = await fetch(`${hkBridgeUrl}/status`, { signal: controller.signal });
      clearTimeout(timeout);

      if (hkRes.ok) {
        const hkData = await hkRes.json();
        const hkResources = hkData.resources || {
          cpu_cores: 4,
          cpu_load: 0,
          cpu_pct: 0,
          mem_total_gb: 7.6,
          mem_free_gb: 5,
          mem_used_pct: 30
        };

        // 计算 HK 动态可用席位
        const hkCpuTarget = hkResources.cpu_cores * SAFETY_MARGIN;
        const hkCpuHeadroom = Math.max(0, hkCpuTarget - hkResources.cpu_load);
        const hkCpuAllowed = Math.floor(hkCpuHeadroom / CPU_PER_CLAUDE);
        const hkMemAvailable = Math.max(0, hkResources.mem_free_gb - 1.5); // HK 保留 1.5GB
        const hkMemAllowed = Math.floor(hkMemAvailable / MEM_PER_CLAUDE_GB);
        const hkDynamicMax = Math.min(hkCpuAllowed, hkMemAllowed, 5); // 硬上限 5
        const hkUsed = hkData.slots?.used || 0;

        hkServer = {
          ...hkServer,
          status: 'online',
          resources: hkResources,
          slots: {
            max: 5,
            dynamic_max: hkDynamicMax,
            used: hkUsed,
            available: Math.max(0, hkDynamicMax - hkUsed),
            reserved: 0,
            processes: hkData.slots?.processes || []
          }
        };
      }
    } catch {
      // HK bridge not available, keep offline status
    }

    // Calculate cluster totals
    const totalSlots = usServer.slots.max + hkServer.slots.max;
    const totalUsed = usServer.slots.used + hkServer.slots.used;
    const totalAvailable = usServer.slots.available + hkServer.slots.available;

    res.json({
      success: true,
      cluster: {
        total_slots: totalSlots,
        total_used: totalUsed,
        total_available: totalAvailable,
        servers: [usServer, hkServer]
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get cluster status',
      details: err.message
    });
  }
});

// ==================== Generate API ====================

/**
 * POST /api/brain/generate/prd
 * Generate a PRD from task description
 */
router.post('/generate/prd', async (req, res) => {
  try {
    const { title, description, type = 'feature', goal_id } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'title is required'
      });
    }

    if (goal_id) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(goal_id)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid goal_id format (must be UUID)'
        });
      }

      // 先查 key_results，再查 objectives（向后兼容）
      let goalResult = await pool.query(
        `SELECT id, title,
                CASE WHEN target_value > 0 THEN ROUND(current_value / target_value * 100) ELSE 0 END AS progress,
                metadata->>'priority' AS priority
         FROM key_results WHERE id = $1`,
        [goal_id]
      );
      if (goalResult.rows.length === 0) {
        goalResult = await pool.query(
          `SELECT id, title, NULL::numeric AS progress, NULL::text AS priority FROM objectives WHERE id = $1`,
          [goal_id]
        );
      }
      const goal = goalResult.rows[0];

      let projectData = null;
      if (goal) {
        const linkResult = await pool.query(
          'SELECT id, title AS name, NULL::text AS repo_path FROM okr_projects WHERE kr_id = $1 LIMIT 1',
          [goal_id]
        );
        if (linkResult.rows[0]) {
          projectData = { name: linkResult.rows[0].name, repo_path: linkResult.rows[0].repo_path };
        }
      }

      const prd = generatePrdFromGoalKR({
        title,
        description: description || '',
        kr: goal ? { title: goal.title, progress: goal.progress, priority: goal.priority } : undefined,
        project: projectData || undefined
      });

      if (req.body.format === 'json') {
        return res.json({ success: true, data: prdToJson(prd), metadata: { title, goal_id, goal_found: !!goal, generated_at: new Date().toISOString() } });
      }

      return res.json({
        success: true,
        prd,
        metadata: {
          title,
          goal_id,
          goal_found: !!goal,
          generated_at: new Date().toISOString()
        }
      });
    }

    const validTypes = Object.keys(PRD_TYPE_MAP);
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    const prd = generatePrdFromTask({ title, description, type });

    if (req.body.format === 'json') {
      return res.json({ success: true, data: prdToJson(prd), metadata: { title, type, generated_at: new Date().toISOString() } });
    }

    res.json({
      success: true,
      prd,
      metadata: {
        title,
        type,
        generated_at: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to generate PRD',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/generate/trd
 * Generate a TRD from goal description
 */
router.post('/generate/trd', async (req, res) => {
  try {
    const { title, description, milestones = [], kr, project } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'title is required'
      });
    }

    const trd = kr
      ? generateTrdFromGoalKR({ title, description, milestones, kr, project })
      : generateTrdFromGoal({ title, description, milestones });

    if (req.body.format === 'json') {
      return res.json({ success: true, data: trdToJson(trd), metadata: { title, milestones_count: milestones.length, generated_at: new Date().toISOString() } });
    }

    res.json({
      success: true,
      trd,
      metadata: {
        title,
        milestones_count: milestones.length,
        generated_at: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to generate TRD',
      details: err.message
    });
  }
});

// ==================== Validate API ====================

/**
 * POST /api/brain/validate/prd
 * Validate PRD content against standardization rules
 */
router.post('/validate/prd', (req, res) => {
  try {
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }

    const result = validatePrd(content);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Validation failed', details: err.message });
  }
});

/**
 * POST /api/brain/validate/trd
 * Validate TRD content against standardization rules
 */
router.post('/validate/trd', (req, res) => {
  try {
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }

    const result = validateTrd(content);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Validation failed', details: err.message });
  }
});

// TRD API — removed (decomposer.js deleted, TRD decomposition now handled by 秋米 /okr)


/**
 * POST /api/brain/goal/compare
 * Compare goal progress against expected progress
 */
router.post('/goal/compare', async (req, res) => {
  try {
    const { goal_id } = req.body;
    const report = await compareGoalProgress(goal_id || null);

    res.json({
      success: true,
      ...report
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to compare goal progress',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/decide
 * Generate decision based on current state
 */
router.post('/decide', async (req, res) => {
  try {
    const context = req.body.context || {};
    const decision = await generateDecision(context);

    res.json({
      success: true,
      ...decision
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to generate decision',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/decision/:id/execute
 * Execute a pending decision
 */
router.post('/decision/:id/execute', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await executeDecision(id);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({
      success: false,
      error: 'Failed to execute decision',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/decision/:id/rollback
 * Rollback an executed decision
 */
router.post('/decision/:id/rollback', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await rollbackDecision(id);

    res.json({
      success: true,
      ...result
    });
  } catch (err) {
    res.status(err.message.includes('not found') ? 404 : 500).json({
      success: false,
      error: 'Failed to rollback decision',
      details: err.message
    });
  }
});

// ==================== VPS Slots API ====================


/**
 * GET /api/brain/slots
 * Three-pool slot allocation status
 */
router.get('/slots', async (req, res) => {
  try {
    const { getSlotStatus } = await import('../slot-allocator.js');
    const status = await getSlotStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/brain/capacity
 * Return current concurrency ceiling configuration
 */
router.get('/capacity', async (req, res) => {
  try {
    const { getBudgetCap, INTERACTIVE_RESERVE } = await import('../executor.js');
    const { budget, physical, effective } = getBudgetCap();
    res.json({
      max_seats: effective,
      physical_capacity: physical,
      budget_cap: budget,
      interactive_reserve: INTERACTIVE_RESERVE,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/brain/budget-cap
 * Set or clear the budget cap (dual-layer capacity model)
 */
router.put('/budget-cap', async (req, res) => {
  try {
    const { setBudgetCap } = await import('../executor.js');
    const result = setBudgetCap(req.body.slots ?? null);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/brain/vps-slots
 * Get real Claude process information with task details
 */
router.get('/vps-slots', async (req, res) => {
  try {
    const tickStatus = await getTickStatus();
    const MAX_SLOTS = tickStatus.max_concurrent || 6;

    // Get tracked processes from executor
    let trackedProcesses = [];
    try {
      const { getActiveProcesses } = await import('../executor.js');
      trackedProcesses = getActiveProcesses();
    } catch {
      // executor not available
    }

    // Get Claude processes from OS
    let slots = [];
    try {
      const { stdout } = await execAsync('ps aux | grep -E " claude( |$)" | grep -v "grep" | grep -v "/bin/bash"');
      const lines = stdout.trim().split('\n').filter(Boolean);

      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 11) {
          const pid = parseInt(parts[1]);
          const cpu = parts[2];
          const mem = parts[3];
          const startTime = parts[8];
          const command = parts.slice(10).join(' ');

          // Match PID to tracked process for task details
          const tracked = trackedProcesses.find(p => p.pid === pid);

          slots.push({
            pid,
            cpu: `${cpu}%`,
            memory: `${mem}%`,
            startTime,
            taskId: tracked?.taskId || null,
            runId: tracked?.runId || null,
            startedAt: tracked?.startedAt || null,
            command: command.slice(0, 100) + (command.length > 100 ? '...' : '')
          });
        }
      }
    } catch {
      slots = [];
    }

    // Enrich with task details from DB
    const taskIds = slots.map(s => s.taskId).filter(Boolean);
    let taskMap = {};
    if (taskIds.length > 0) {
      try {
        const result = await pool.query(
          `SELECT id, title, priority, status, task_type FROM tasks WHERE id = ANY($1)`,
          [taskIds]
        );
        for (const row of result.rows) {
          taskMap[row.id] = row;
        }
      } catch {
        // continue without task details
      }
    }

    const enrichedSlots = slots.map(s => {
      const task = s.taskId ? taskMap[s.taskId] : null;
      return {
        ...s,
        taskTitle: task?.title || null,
        taskPriority: task?.priority || null,
        taskType: task?.task_type || null,
      };
    });

    res.json({
      success: true,
      total: MAX_SLOTS,
      used: enrichedSlots.length,
      available: MAX_SLOTS - enrichedSlots.length,
      slots: enrichedSlots
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get VPS slots',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/execution-history
 * Get cecelia execution history from decision_log
 */
router.get('/execution-history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;

    // Get execution records from decision_log where trigger = 'cecelia-executor' or 'tick'
    const result = await pool.query(`
      SELECT
        id,
        trigger,
        input_summary,
        action_result_json,
        status,
        created_at
      FROM decision_log
      WHERE trigger IN ('cecelia-executor', 'tick', 'execution-callback')
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);

    const executions = result.rows.map(row => ({
      id: row.id,
      trigger: row.trigger,
      summary: row.input_summary,
      result: row.action_result_json,
      status: row.status,
      timestamp: row.created_at
    }));

    // Count today's executions
    const todayResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM decision_log
      WHERE trigger IN ('cecelia-executor', 'tick', 'execution-callback')
        AND created_at >= CURRENT_DATE
    `);

    res.json({
      success: true,
      total: executions.length,
      today: parseInt(todayResult.rows[0].count),
      executions
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get execution history',
      details: err.message
    });
  }
});

// ==================== Execution Status API ====================

/**
 * GET /api/brain/cecelia/overview
 * Overview of Cecelia execution: running/completed/failed counts + recent runs
 */
router.get('/cecelia/overview', async (req, res) => {
  try {
    const { getActiveProcesses, getActiveProcessCount } = await import('../executor.js');

    // Get task counts from database
    const countsResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'in_progress') as running,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) as total
      FROM tasks
      WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
    `);

    const counts = countsResult.rows[0];

    // Get recent runs (tasks with execution info)
    const recentResult = await pool.query(`
      SELECT
        t.id,
        t.title as project,
        t.status,
        t.priority,
        t.task_type,
        t.created_at as started_at,
        t.completed_at,
        t.payload->>'current_run_id' as run_id,
        t.payload->>'run_status' as run_status,
        t.payload->'last_run_result' as last_result,
        COALESCE(t.payload->>'feature_branch', '') as feature_branch
      FROM tasks t
      WHERE t.created_at >= CURRENT_DATE - INTERVAL '7 days'
      ORDER BY t.created_at DESC
      LIMIT 20
    `);

    // Map to expected format
    const recentRuns = recentResult.rows.map(row => ({
      id: row.id,
      project: row.project || 'Unknown',
      feature_branch: row.feature_branch || '',
      status: row.status || 'pending',
      total_checkpoints: 11,
      completed_checkpoints: row.status === 'completed' ? 11 : row.status === 'in_progress' ? 5 : 0,
      failed_checkpoints: row.status === 'failed' ? 1 : 0,
      current_checkpoint: row.run_status || null,
      started_at: row.started_at,
      updated_at: row.completed_at || row.started_at,
    }));

    // Get live process info
    const activeProcs = getActiveProcesses();
    const activeCount = getActiveProcessCount();

    res.json({
      success: true,
      total_runs: parseInt(counts.total),
      running: parseInt(counts.running),
      completed: parseInt(counts.completed),
      failed: parseInt(counts.failed),
      active_processes: activeCount,
      recent_runs: recentRuns,
      live_processes: activeProcs,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get cecelia overview',
      details: err.message,
    });
  }
});

/**
 * GET /api/brain/dev/health
 * Health check for dev task tracking
 */
router.get('/dev/health', async (req, res) => {
  try {
    const { checkCeceliaRunAvailable, getActiveProcessCount } = await import('../executor.js');

    const executorAvailable = await checkCeceliaRunAvailable();
    const activeCount = getActiveProcessCount();

    // Check DB connectivity
    const dbResult = await pool.query('SELECT 1 as ok');
    const dbOk = dbResult.rows.length > 0;

    res.json({
      success: true,
      data: {
        status: dbOk && executorAvailable.available ? 'healthy' : 'degraded',
        trackedRepos: [],
        executor: {
          available: executorAvailable.available,
          activeProcesses: activeCount,
        },
        database: {
          connected: dbOk,
        },
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Health check failed',
      details: err.message,
    });
  }
});

/**
 * GET /api/brain/dev/tasks
 * Get all active dev tasks with step status
 */
router.get('/dev/tasks', async (req, res) => {
  try {
    const { getActiveProcesses } = await import('../executor.js');

    // Get active tasks (in_progress or recently completed dev tasks)
    const result = await pool.query(`
      SELECT
        t.id,
        t.title,
        t.status,
        t.priority,
        t.task_type,
        t.created_at,
        t.completed_at,
        t.payload,
        g.title as goal_title,
        NULL::text as project_name,
        NULL::text as repo_path
      FROM tasks t
      LEFT JOIN key_results g ON t.goal_id = g.id
      WHERE t.task_type IN ('dev', 'review')
        AND (t.status IN ('in_progress', 'queued') OR t.completed_at >= CURRENT_DATE - INTERVAL '1 day')
      ORDER BY
        CASE t.status WHEN 'in_progress' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
        t.created_at DESC
      LIMIT 20
    `);

    // Get live process info
    const activeProcs = getActiveProcesses();
    const procMap = new Map(activeProcs.map(p => [p.taskId, p]));

    // Map to DevTaskStatus format
    const tasks = result.rows.map(row => {
      const payload = row.payload || {};
      const proc = procMap.get(row.id);

      // Build step items from payload or defaults
      const stepNames = ['PRD', 'Detect', 'Branch', 'DoD', 'Code', 'Test', 'Quality', 'PR', 'CI', 'Learning', 'Cleanup'];
      const steps = stepNames.map((name, idx) => {
        const stepKey = `step_${idx + 1}`;
        const stepStatus = payload[stepKey] || 'pending';
        return {
          id: idx + 1,
          name,
          status: stepStatus === 'done' ? 'done' : stepStatus,
        };
      });

      // Determine current step
      const currentStep = steps.find(s => s.status === 'in_progress');
      const completedSteps = steps.filter(s => s.status === 'done').length;

      return {
        repo: {
          name: row.project_name || row.title,
          path: row.repo_path || '',
          remoteUrl: '',
        },
        branches: {
          main: 'main',
          develop: 'develop',
          feature: payload.feature_branch || null,
          current: payload.feature_branch || 'develop',
          type: payload.feature_branch?.startsWith('cp-') ? 'cp' : payload.feature_branch?.startsWith('feature/') ? 'feature' : 'unknown',
        },
        task: {
          name: row.title,
          createdAt: row.created_at,
          prNumber: payload.pr_number || null,
          prUrl: payload.pr_url || null,
          prState: payload.pr_state || null,
        },
        steps: {
          current: currentStep ? currentStep.id : completedSteps + 1,
          total: 11,
          items: steps,
        },
        quality: {
          ci: payload.ci_status || 'unknown',
          codex: 'unknown',
          lastCheck: row.completed_at || row.created_at,
        },
        updatedAt: row.completed_at || row.created_at,
        processAlive: proc ? proc.alive : false,
      };
    });

    res.json({
      success: true,
      data: tasks,
      count: tasks.length,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get dev tasks',
      details: err.message,
    });
  }
});

/**
 * GET /api/brain/dev/repos
 * Get list of tracked repositories
 */
router.get('/dev/repos', async (req, res) => {
  try {
    const result = await pool.query(`
      -- 迁移：projects → okr_projects/okr_scopes/okr_initiatives metadata.repo_path
      SELECT DISTINCT op.title AS name, op.metadata->>'repo_path' AS repo_path
      FROM okr_projects op
      WHERE op.metadata->>'repo_path' IS NOT NULL
      UNION
      SELECT DISTINCT os.title AS name, os.metadata->>'repo_path' AS repo_path
      FROM okr_scopes os
      WHERE os.metadata->>'repo_path' IS NOT NULL
      UNION
      SELECT DISTINCT oi.title AS name, oi.metadata->>'repo_path' AS repo_path
      FROM okr_initiatives oi
      WHERE oi.metadata->>'repo_path' IS NOT NULL
      ORDER BY name
    `);

    res.json({
      success: true,
      data: result.rows.map(r => r.repo_path || r.name),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get repos',
      details: err.message,
    });
  }
});

// ==================== Planner API ====================

/**
 * POST /api/brain/plan
 * Accept input and create resources at the correct OKR level
 */
router.post('/plan', async (req, res) => {
  try {
    const { input, dry_run = false } = req.body;

    if (!input || typeof input !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'input is required and must be an object containing one of: objective, key_result, project, task'
      });
    }

    const result = await handlePlanInput(input, dry_run);

    res.json({
      success: true,
      dry_run,
      ...result
    });
  } catch (err) {
    const status = err.message.startsWith('Hard constraint') ? 400 : 500;
    res.status(status).json({
      success: false,
      error: err.message
    });
  }
});

// POST /api/brain/plan/llm — removed (planner-llm.js deleted, task planning now handled by 秋米 /okr)

/**
 * GET /api/brain/plan/status
 * Get current planning status (target KR, project, queued tasks)
 */
router.get('/plan/status', async (req, res) => {
  try {
    const status = await getPlanStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to get plan status',
      details: err.message
    });
  }
});

/**
 * POST /api/brain/plan/next
 * Trigger planner to select next task (same as what tick does)
 */
router.post('/plan/next', async (req, res) => {
  try {
    const result = await planNextTask();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to plan next task',
      details: err.message
    });
  }
});

/**
 * GET /api/brain/planner/initiatives-without-tasks
 * 监控端点：返回所有有 active Initiative 但无 queued/in_progress Task 的 KR 及其 Initiative 列表
 */
router.get('/planner/initiatives-without-tasks', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        kr.id AS kr_id,
        kr.title AS kr_title,
        NULL AS kr_priority,
        CASE WHEN kr.target_value > 0 THEN ROUND(kr.current_value / kr.target_value * 100) ELSE 0 END AS kr_progress,
        kr.status AS kr_status,
        op.id AS project_id,
        op.title AS project_name,
        json_agg(json_build_object(
          'id', oi.id,
          'name', oi.title,
          'status', oi.status,
          'created_at', oi.created_at
        ) ORDER BY oi.created_at ASC) AS initiatives_needing_planning
      FROM key_results kr
      INNER JOIN okr_projects op ON op.kr_id = kr.id AND op.status = 'active'
      INNER JOIN okr_scopes os ON os.project_id = op.id
      INNER JOIN okr_initiatives oi
        ON oi.scope_id = os.id
        AND oi.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM tasks t
          WHERE t.okr_initiative_id = oi.id
            AND t.status IN ('queued', 'in_progress')
        )
      WHERE kr.status NOT IN ('completed', 'cancelled')
      GROUP BY kr.id, kr.title, kr.current_value, kr.target_value, kr.status, op.id, op.title
      ORDER BY kr.id
    `);

    res.json({
      success: true,
      count: result.rows.length,
      krs_with_unplanned_initiatives: result.rows
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Failed to query initiatives without tasks',
      details: err.message
    });
  }
});

// ==================== Work Streams API ====================

/**
 * GET /api/brain/work/streams
 * 返回当前 Area Stream 调度状态，供前端展示
 * 使用 planner.js 的 selectTopAreas + selectActiveInitiativeForArea
 */
router.get('/work/streams', async (_req, res) => {
  try {
    const state = await getGlobalState();
    const topAreas = selectTopAreas(state, ACTIVE_AREA_COUNT);

    const streams = topAreas.map(area => {
      const areaKRs = state.keyResults.filter(kr => kr.parent_id === area.id);
      const areaKRIds = new Set(areaKRs.map(kr => kr.id));

      const areaTasks = state.activeTasks.filter(
        t => (t.status === 'queued' || t.status === 'in_progress') && areaKRIds.has(t.goal_id)
      );
      const totalQueuedTasks = areaTasks.filter(t => t.status === 'queued').length;

      const initiativeResult = selectActiveInitiativeForArea(area, state);
      let activeInitiative = null;
      if (initiativeResult) {
        const { initiative, kr } = initiativeResult;
        const initTasks = areaTasks.filter(t => t.project_id === initiative.id);
        const inProgressCount = initTasks.filter(t => t.status === 'in_progress').length;
        const queuedCount = initTasks.filter(t => t.status === 'queued').length;
        // lockReason: in_progress 任务存在 → 'in_progress'，否则 → 'fifo'
        const lockReason = inProgressCount > 0 ? 'in_progress' : 'fifo';
        activeInitiative = {
          initiative: {
            id: initiative.id,
            name: initiative.name,
            status: initiative.status,
            created_at: initiative.created_at,
          },
          kr: { id: kr.id, title: kr.title || kr.name },
          lockReason,
          inProgressTasks: inProgressCount,
          queuedTasks: queuedCount,
        };
      }

      return {
        area: {
          id: area.id,
          title: area.title || area.name,
          priority: area.priority,
          status: area.status,
          progress: area.progress || 0,
        },
        activeInitiative,
        totalQueuedTasks,
      };
    });

    res.json({
      activeAreaCount: ACTIVE_AREA_COUNT,
      streams,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[work/streams] Error:', err);
    res.status(500).json({ error: 'Failed to get work streams', details: err.message });
  }
});

// ============================================================
// POST /dispatch-now — 不经过 tick loop，直接派发任务执行
// ============================================================
// 用途：/dev 工作流注册 Codex 审查任务后立即触发，不依赖调度器状态
// 调用 executor.triggerCeceliaRun() 直接执行（完全独立于 tick loop）
router.post('/dispatch-now', async (req, res) => {
  try {
    const { task_id } = req.body;
    if (!task_id) {
      return res.status(400).json({ error: 'task_id is required' });
    }

    // 从 DB 加载 task
    const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [task_id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found', id: task_id });
    }

    const task = result.rows[0];

    // 检查 task 状态（不重复执行已完成的任务）
    if (task.status === 'completed' || task.status === 'cancelled') {
      return res.status(409).json({
        error: `Task already ${task.status}`,
        id: task_id,
        status: task.status,
      });
    }

    // 标记为 in_progress
    await pool.query(
      'UPDATE tasks SET status = $1, started_at = NOW() WHERE id = $2',
      ['in_progress', task_id]
    );

    // 直接触发执行（不经过 tick loop）
    const execResult = await triggerCeceliaRun(task);

    if (execResult.success) {
      console.log(`[dispatch-now] Task ${task_id} dispatched successfully (executor: ${execResult.executor || 'local'})`);
      res.json({
        success: true,
        taskId: task_id,
        runId: execResult.runId,
        executor: execResult.executor || 'local',
      });
    } else {
      // 执行失败：回退 status
      await pool.query(
        'UPDATE tasks SET status = $1 WHERE id = $2',
        ['queued', task_id]
      );
      console.error(`[dispatch-now] Task ${task_id} dispatch failed: ${execResult.error}`);
      res.status(500).json({
        success: false,
        error: execResult.error,
        taskId: task_id,
      });
    }
  } catch (err) {
    console.error(`[dispatch-now] Error: ${err.message}`);
    res.status(500).json({ error: 'Failed to dispatch', details: err.message });
  }
});

export default router;
