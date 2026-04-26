/**
 * Brain v2 Phase D Part 1.6 — tick.js 4 个 helper 抽出。
 *
 * 原在 tick.js 各处零散位置，瘦身打包到本模块。这 4 个 helper 互无内部依赖，
 * 与 tick.js executeTick 主循环也解耦（仅由 executeTick / dispatchNextTask 调用）：
 *
 *  - routeTask: task → skill 路由（task_type / platform → skill 路径）
 *  - releaseBlockedTasks: SQL 释放 blocked_until 已到期的 blocked 任务
 *  - autoFailTimedOutTasks: in_progress 超 DISPATCH_TIMEOUT_MINUTES 的任务自动失败 + quarantine 检查
 *  - getRampedDispatchMax: 基于 pressure / alertness / post-drain cooldown 动态调整派发速率
 *
 * 未来 D1.7+ 可视复杂度进一步拆 task-skill-router.js / tick-cleanup.js / dispatch-rate.js 三个独立文件。
 */

import pool from './db.js';
import { killProcess, checkServerResources } from './executor.js';
import { handleTaskFailure } from './quarantine.js';
import { emit } from './event-bus.js';
import { getCurrentAlertness, ALERTNESS_LEVELS } from './alertness/index.js';
import { isPostDrainCooldown } from './drain.js';

// ─── 配置常量（从 tick.js 同步迁过来）────────────────────────────────────
const DISPATCH_TIMEOUT_MINUTES = parseInt(process.env.DISPATCH_TIMEOUT_MINUTES || '100', 10);

// ─── Task → skill 路由表（export 供 test 直接引用）────────────────────────
export const TASK_TYPE_AGENT_MAP = {
  'dev': '/dev',           // Caramel - 编程
  'talk': '/talk',         // 对话任务 → HK MiniMax
  'qa': '/code-review',    // 旧类型 → 已迁移到 /code-review
  'audit': '/code-review', // 旧类型 → 已迁移到 /code-review
  'research': null,        // 需要人工/Opus 处理
  'content_publish': null  // Platform-aware routing via routeTask
};

export const PLATFORM_SKILL_MAP = {
  'zhihu': '/zhihu-publisher',
  'douyin': '/douyin-publisher',
  'xiaohongshu': '/xiaohongshu-publisher',
  'weibo': '/weibo-publisher',
  'wechat': '/wechat-publisher',
  'toutiao': '/toutiao-publisher',
  'kuaishou': '/kuaishou-publisher',
  'shipinhao': '/shipinhao-publisher'
};

// ─── 日志 helper（与 tick.js tickLog 同风格）──────────────────────────
function tickLog(...args) {
  const ts = new Date().toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
  console.log(`[${ts}]`, ...args);
}

async function logTickDecision(trigger, inputSummary, decision, result) {
  await pool.query(`
    INSERT INTO decision_log (trigger, input_summary, llm_output_json, action_result_json, status)
    VALUES ($1, $2, $3, $4, $5)
  `, [trigger, inputSummary, decision, result, result?.success ? 'success' : 'failed']);
}

/**
 * Route a task to the appropriate agent based on task_type.
 * @param {Object} task - Task object with task_type field
 * @returns {string|null} - Agent skill path or null if requires manual handling
 */
export function routeTask(task) {
  const taskType = task.task_type || 'dev';
  const agent = TASK_TYPE_AGENT_MAP[taskType];

  if (agent === undefined) {
    console.warn(`[routeTask] Unknown task_type: ${taskType}, defaulting to /dev`);
    return '/dev';
  }

  // Special handling for content_publish: route by platform
  if (taskType === 'content_publish' && task.payload) {
    const platform = task.payload.platform;
    if (platform && PLATFORM_SKILL_MAP[platform]) {
      return PLATFORM_SKILL_MAP[platform];
    }
    console.warn(`[routeTask] Unknown platform: ${platform} in content_publish task ${task.id}`);
    return null;
  }

  return agent;
}

/**
 * 自动释放 blocked_until 已到期的 blocked 任务，将其状态改回 queued.
 * @returns {Promise<Array<{task_id, title, blocked_reason, blocked_duration_ms}>>}
 */
export async function releaseBlockedTasks() {
  const result = await pool.query(`
    UPDATE tasks
    SET status = 'queued',
        blocked_at = NULL,
        blocked_reason = NULL,
        blocked_until = NULL,
        updated_at = NOW()
    WHERE status = 'blocked' AND blocked_until <= NOW()
    RETURNING id AS task_id, title, blocked_reason,
              EXTRACT(EPOCH FROM (NOW() - blocked_at)) * 1000 AS blocked_duration_ms
  `);
  return result.rows;
}

/**
 * Auto-fail in_progress tasks past DISPATCH_TIMEOUT_MINUTES.
 * Checks if task should be quarantined after failure.
 *
 * @param {Object[]} inProgressTasks - Tasks currently in_progress (must include payload, started_at)
 * @returns {Promise<Object[]>} - Actions taken
 */
export async function autoFailTimedOutTasks(inProgressTasks) {
  const actions = [];
  for (const task of inProgressTasks) {
    const triggeredAt = task.payload?.run_triggered_at || task.started_at;
    if (!triggeredAt) continue;

    const elapsed = (Date.now() - new Date(triggeredAt).getTime()) / (1000 * 60);
    if (elapsed > DISPATCH_TIMEOUT_MINUTES) {
      // Kill the actual process before marking failed to prevent orphans
      killProcess(task.id);
      // Write structured error details for retry-analyzer
      const errorDetails = {
        type: 'timeout',
        message: `Task timed out after ${Math.round(elapsed)} minutes (limit: ${DISPATCH_TIMEOUT_MINUTES}min)`,
        elapsed_minutes: Math.round(elapsed),
        timeout_limit: DISPATCH_TIMEOUT_MINUTES,
      };
      await pool.query(
        `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
        [task.id, JSON.stringify({ error_details: errorDetails })]
      );

      // Check if task should be quarantined
      const quarantineResult = await handleTaskFailure(task.id);
      if (quarantineResult.quarantined) {
        tickLog(`[tick] Task ${task.id} quarantined: ${quarantineResult.result?.reason}`);
        actions.push({
          action: 'quarantine',
          task_id: task.id,
          title: task.title,
          reason: quarantineResult.result?.reason,
          elapsed_minutes: Math.round(elapsed)
        });
      } else {
        // Not quarantined yet — requeue for retry (failure_count already incremented by handleTaskFailure)
        // Clearing started_at prevents immediate re-timeout on next tick evaluation
        await pool.query(
          `UPDATE tasks SET status = 'queued', started_at = NULL, updated_at = NOW() WHERE id = $1`,
          [task.id]
        );
        actions.push({
          action: 'auto-requeue-timeout',
          task_id: task.id,
          title: task.title,
          elapsed_minutes: Math.round(elapsed),
          failure_count: quarantineResult.failure_count,
          retry_attempt: quarantineResult.failure_count
        });
      }

      await emit('patrol_cleanup', 'patrol', {
        task_id: task.id,
        title: task.title,
        elapsed_minutes: Math.round(elapsed)
      });
      await logTickDecision(
        'tick',
        `Auto-requeued timed-out task: ${task.title} (${Math.round(elapsed)}min, attempt ${quarantineResult.failure_count})`,
        { action: 'auto-requeue-timeout', task_id: task.id, quarantined: quarantineResult.quarantined },
        { success: true, elapsed_minutes: Math.round(elapsed) }
      );
    }
  }
  return actions;
}

/**
 * Get ramped dispatch max - gradually increase/decrease dispatch rate
 * based on system load and alertness level.
 *
 * @param {number} effectiveDispatchMax - The calculated dispatch max from slot budget
 * @returns {Promise<number>} The ramped dispatch max (0 to effectiveDispatchMax)
 */
export async function getRampedDispatchMax(effectiveDispatchMax) {
  // Read current ramp state from working_memory
  const stateResult = await pool.query(`
    SELECT value_json FROM working_memory WHERE key = 'dispatch_ramp_state'
  `);

  // Cold start: no ramp record → start at min(2, max) to avoid burst on restart
  // (Having no ramp record means Brain just restarted — avoid immediately dispatching 9 tasks)
  let currentRate = stateResult.rows.length > 0
    ? (stateResult.rows[0].value_json.current_rate || effectiveDispatchMax)
    : Math.min(2, effectiveDispatchMax);

  // Check current system resources and alertness
  const resources = checkServerResources();
  const pressure = resources.metrics.max_pressure;
  const alertness = getCurrentAlertness();

  // Decide rate adjustment based on load
  let newRate = currentRate;
  let reason = 'stable';

  if (alertness.level >= ALERTNESS_LEVELS.ALERT) {
    // High alertness - exponential decay (/2 instead of -1)
    newRate = Math.max(0, Math.floor(currentRate / 2));
    reason = `alertness=${alertness.levelName}`;
  } else if (pressure > 0.9) {
    // Critical pressure - force to 1
    newRate = 1;
    reason = `pressure_critical=${pressure.toFixed(2)}`;
  } else if (pressure > 0.8) {
    // High pressure - exponential decay
    newRate = Math.max(1, Math.floor(currentRate / 2));
    reason = `pressure=${pressure.toFixed(2)}`;
  } else if (pressure < 0.5 && alertness.level <= ALERTNESS_LEVELS.AWARE) {
    // Low pressure and calm - speed up
    newRate = currentRate + 1;
    reason = 'low_load';
  }

  // Bootstrap guard: if stuck at 0 but system is not in PANIC, allow minimum rate
  // Prevents deadlock: AWARE/ALERT alertness + current_rate=0 → nothing dispatches → stays stuck
  // Only PANIC (level=4, true disaster) should completely stop dispatch
  if (newRate === 0 && alertness.level < ALERTNESS_LEVELS.PANIC && pressure < 0.8) {
    newRate = 1;
    reason = `bootstrap (alertness=${alertness.levelName}, pressure=${pressure.toFixed(2)})`;
  }

  // Cap at effectiveDispatchMax
  newRate = Math.min(newRate, effectiveDispatchMax);

  // Post-drain cooldown: limit dispatch rate to 1 for 5 minutes after drain completes
  if (isPostDrainCooldown() && newRate > 1) {
    newRate = 1;
    reason = 'post_drain_cooldown';
  }

  // Save new state
  await pool.query(`
    INSERT INTO working_memory (key, value_json, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()
  `, ['dispatch_ramp_state', { current_rate: newRate }]);

  // Log rate changes
  if (newRate !== currentRate) {
    tickLog(`[tick] Ramped dispatch: ${currentRate} → ${newRate} (pressure: ${pressure.toFixed(2)}, alertness: ${alertness.levelName}, reason: ${reason})`);
  }

  return newRate;
}
