/**
 * Brain v2 Phase D Part 1.4 — dispatch helpers 抽出。
 *
 * 原在 tick.js L692-L988，瘦身抽出独立模块。三个函数都是 dispatchNextTask 的辅助：
 *
 *  - selectNextDispatchableTask: 从 queued 池选下一个可派发任务（应用 priorityFilter /
 *    P2 mitigation / payload.depends_on / task_dependencies 表硬边）
 *  - autoCreateTasksFromCortex: Cortex RCA 输出含 create_task action 时批量建任务
 *  - processCortexTask: 单跑 Cortex (RCA + learning + strategy 调整 + auto create)
 *
 * 三函数无 tick.js 私有状态依赖（除 tickLog 这个日志 helper —— 本模块复制本地版本）。
 *
 * tick.js 通过 import 调用，re-export 保 caller 兼容。
 */

import pool from './db.js';
import { updateTask, createTask } from './actions.js';
import { sortTasksByWeight } from './task-weight.js';
import { handleTaskFailure } from './quarantine.js';

// 日志 helper：[tick] 前缀（保持与原 tick.js 输出一致），Asia/Shanghai 时间戳。
function tickLog(...args) {
  const ts = new Date().toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
  console.log(`[${ts}]`, ...args);
}

/**
 * Select the next dispatchable task from queued tasks.
 * Skips tasks with unmet dependencies (payload.depends_on).
 * Returns null if no dispatchable task found.
 *
 * @param {string[]} goalIds - Goal IDs to scope the query
 * @param {string[]} [excludeIds=[]] - Task IDs to exclude (e.g. pre-flight failures)
 * @param {Object} [options]
 * @param {string[]|null} [options.priorityFilter=null] - Allowed priorities (e.g. ['P0','P1'])
 * @returns {Promise<Object|null>} - The next task to dispatch, or null
 */
export async function selectNextDispatchableTask(goalIds, excludeIds = [], options = {}) {
  const { priorityFilter = null } = options;

  // Check if P2 tasks should be paused (alertness mitigation)
  const { getMitigationState } = await import('./alertness-actions.js');
  const mitigationState = getMitigationState();

  // Query queued tasks with payload for dependency checking
  // Watchdog backoff: skip tasks with next_run_at in the future
  // next_run_at is always written as UTC ISO-8601 by requeueTask().
  // Safety: NULL, empty string, or unparseable values are treated as "no backoff".
  // goalIds=null 表示不按 goal 过滤（派发任何可用任务），
  // goalIds=[] 或数组时按 goal_id 过滤（含 goal_id IS NULL）
  const queryParams = [];
  let goalCondition;
  if (goalIds == null) {
    goalCondition = '(1=1)';
  } else {
    queryParams.push(goalIds);
    goalCondition = `(t.goal_id = ANY($${queryParams.length}) OR t.goal_id IS NULL)`;
  }
  let excludeClause = '';
  if (excludeIds.length > 0) {
    queryParams.push(excludeIds);
    excludeClause = `AND t.id != ALL($${queryParams.length})`;
  }
  const result = await pool.query(`
    SELECT t.id, t.title, t.description, t.prd_content, t.status, t.priority, t.started_at, t.updated_at, t.payload,
           t.queued_at, t.task_type, t.created_at, t.metadata, t.project_id
    FROM tasks t
    WHERE ${goalCondition}
      AND t.status = 'queued'
      AND t.claimed_by IS NULL
      AND t.task_type NOT IN ('content-pipeline', 'content-export', 'content-research', 'content-copywriting', 'content-copy-review', 'content-generate', 'content-image-review',
                               'harness_ci_watch', 'harness_deploy_watch')
      ${excludeClause}
      AND (
        t.payload->>'next_run_at' IS NULL
        OR t.payload->>'next_run_at' = ''
        OR (t.payload->>'next_run_at')::timestamptz <= NOW()
      )
      AND (
        t.project_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM tasks t2
          WHERE t2.project_id = t.project_id
            AND t2.status = 'in_progress'
            AND t2.id != t.id
            AND t2.task_type != 'content-pipeline'
        )
      )
      -- 依赖门禁：task_dependencies 表里有未完成 edge 的 task 不可派发
      -- 参考 harness-dag.js:nextRunnableTask —— from_task_id=本 task，
      -- to_task_id 的依赖 status 不在 completed/cancelled/canceled 即阻塞。
      -- 修复：普通 dispatch 路径原先只看 payload.depends_on，对 task_dependencies
      -- 表的硬边盲视，导致 Initiative 子任务（ws1/ws2/ws3/ws4）在 queued 状态下
      -- 被并行派发，基于错误 worktree 状态产出冲突 PR。
      AND NOT EXISTS (
        SELECT 1 FROM task_dependencies d
        JOIN tasks dep ON dep.id = d.to_task_id
        WHERE d.from_task_id = t.id
          AND dep.status NOT IN ('completed', 'cancelled', 'canceled')
      )
    ORDER BY
      CASE t.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
      t.created_at ASC
  `, queryParams);

  // Apply weight-based sorting on top of the DB result
  // This allows dynamic adjustment (wait time, retry count, task type) without changing SQL
  const weightedTasks = sortTasksByWeight(result.rows);

  for (const task of weightedTasks) {
    // Skip tasks not matching quota guard priority filter
    if (priorityFilter && !priorityFilter.includes(task.priority)) {
      tickLog(`[tick] Skipping ${task.priority} task ${task.id} (quota guard: only ${priorityFilter.join('/')} allowed)`);
      continue;
    }

    // Skip P2 tasks if mitigation is active (EMERGENCY+ state)
    if (mitigationState.p2_paused && task.priority === 'P2') {
      tickLog(`[tick] Skipping P2 task ${task.id} (alertness mitigation active)`);
      continue;
    }

    const dependsOn = task.payload?.depends_on;
    if (Array.isArray(dependsOn) && dependsOn.length > 0) {
      // Check if all dependencies are resolved (completed or cancelled — both unblock downstream)
      const depResult = await pool.query(
        "SELECT COUNT(*) FROM tasks WHERE id = ANY($1) AND status NOT IN ('completed', 'cancelled', 'canceled')",
        [dependsOn]
      );
      if (parseInt(depResult.rows[0].count) > 0) {
        continue; // Skip: has unmet dependencies
      }
    }

    // NOTE: task_dependencies 表依赖检查已在主 SELECT 的 WHERE 子句
    // （NOT EXISTS + from_task_id 子查询）完成，见 harness-dag.js:nextRunnableTask
    // 的同款做法。本循环此处只需处理 payload.depends_on 的软依赖。
    return task;
  }
  return null;
}

/**
 * 从皮层 RCA 结果中自动创建建议任务
 * @param {Object} rcaResult - performRCA 返回的分析结果
 * @param {Object} [context] - { goal_id, project_id } 继承自失败任务（可选）
 * @returns {Promise<Array>} - 创建的任务列表（含 deduplicated 字段）
 */
export async function autoCreateTasksFromCortex(rcaResult, context = {}) {
  const createTaskActions = (rcaResult.recommended_actions || [])
    .filter((a) => a.type === 'create_task' && a.params?.title);

  if (createTaskActions.length === 0) return [];

  const created = [];
  for (const action of createTaskActions) {
    try {
      const result = await createTask({
        title: action.params.title,
        description: action.params.description || '',
        priority: action.params.priority || 'P1',
        task_type: action.params.task_type || 'dev',
        trigger_source: 'cortex',
        goal_id: action.params.goal_id || context.goal_id || null,
        project_id: action.params.project_id || context.project_id || null,
      });
      created.push({ title: action.params.title, deduplicated: result.deduplicated || false });
      tickLog(`[tick] autoCreateTasksFromCortex: "${action.params.title}" created (dedup=${result.deduplicated || false})`);
    } catch (err) {
      console.error(`[tick] autoCreateTasksFromCortex: failed to create "${action.params.title}": ${err.message}`);
    }
  }
  return created;
}

/**
 * Process Cortex task (Brain-internal RCA analysis).
 * @param {Object} task - Task requiring Cortex processing
 * @param {Array} actions - Actions array to append to
 * @returns {Promise<Object>} - Dispatch result
 */
export async function processCortexTask(task, actions) {
  try {
    tickLog(`[tick] Processing Cortex task: ${task.title} (id=${task.id})`);

    // Update status to in_progress
    await updateTask({ task_id: task.id, status: 'in_progress' });
    actions.push({ action: 'cortex-start', task_id: task.id, title: task.title });

    // Import Cortex module
    const { performRCA } = await import('./cortex.js');

    // Extract signals from payload (kept for forward compatibility; currently unused)
    const _signals = task.payload.signals || {};
    const trigger = task.payload.trigger || 'unknown';

    // Execute RCA analysis
    const rcaResult = await performRCA(
      { id: task.id, title: task.title, description: task.description, payload: task.payload },
      [] // history - can be enhanced later
    );

    // Save analysis results to cecelia_events
    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ($1, $2, $3)
    `, ['cortex_rca_complete', 'cortex', JSON.stringify({
      task_id: task.id,
      trigger,
      analysis: rcaResult.analysis,
      recommended_actions: rcaResult.recommended_actions,
      learnings: rcaResult.learnings,
      confidence: rcaResult.confidence,
      completed_at: new Date().toISOString()
    })]);

    // Auto-create tasks from cortex create_task recommendations
    try {
      const createdTasks = await autoCreateTasksFromCortex(rcaResult, {
        goal_id: task.payload.goal_id || null,
        project_id: task.payload.project_id || null,
      });
      if (createdTasks.length > 0) {
        actions.push({ action: 'cortex-tasks-created', count: createdTasks.length });
      }
    } catch (autoCreateErr) {
      console.error(`[tick] autoCreateTasksFromCortex error: ${autoCreateErr.message}`);
    }

    // If this is a learning task, record learning and apply strategy adjustments
    if (task.payload.requires_learning === true) {
      try {
        const { recordLearning, applyStrategyAdjustments } = await import('./learning.js');

        // Record learning
        const learningRecord = await recordLearning(rcaResult);
        tickLog(`[tick] Learning recorded: ${learningRecord.id}`);

        // Apply strategy adjustments if any
        const strategyAdjustments = rcaResult.recommended_actions?.filter(
          (action) => action.type === 'adjust_strategy'
        ) || [];

        if (strategyAdjustments.length > 0) {
          const applyResult = await applyStrategyAdjustments(strategyAdjustments, learningRecord.id);
          tickLog(`[tick] Strategy adjustments applied: ${applyResult.applied}, skipped: ${applyResult.skipped}`);
        }
      } catch (learningErr) {
        console.error(`[tick] Learning processing failed: ${learningErr.message}`);
        // Don't fail the task, just log the error
      }
    }

    // Update task to completed with result in payload
    const updatedPayload = {
      ...task.payload,
      rca_result: {
        root_cause: rcaResult.analysis.root_cause,
        mitigations: rcaResult.recommended_actions?.slice(0, 3),
        confidence: rcaResult.confidence,
        completed_at: new Date().toISOString()
      }
    };
    await pool.query(`
      UPDATE tasks SET status = $1, payload = $2, completed_at = NOW(), updated_at = NOW()
      WHERE id = $3
    `, ['completed', JSON.stringify(updatedPayload), task.id]);

    tickLog(`[tick] Cortex task completed: ${task.id}, confidence=${rcaResult.confidence}`);

    actions.push({
      action: 'cortex-complete',
      task_id: task.id,
      confidence: rcaResult.confidence,
      learnings_count: rcaResult.learnings?.length || 0
    });

    return {
      dispatched: true,
      reason: 'cortex_processed',
      task_id: task.id,
      actions
    };

  } catch (err) {
    console.error(`[tick] Cortex task failed: ${err.message}`);

    // Record error details in payload
    await pool.query(
      `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
      [task.id, JSON.stringify({
        rca_error: { error: err.message, failed_at: new Date().toISOString() }
      })]
    );

    // Use handleTaskFailure for quarantine check (repeated failures → auto-quarantine)
    const quarantineResult = await handleTaskFailure(task.id);
    if (quarantineResult.quarantined) {
      tickLog(`[tick] Cortex task ${task.id} quarantined: ${quarantineResult.result?.reason}`);
      actions.push({
        action: 'cortex-quarantined',
        task_id: task.id,
        error: err.message,
        reason: quarantineResult.result?.reason
      });
    } else {
      // Not quarantined — mark as failed normally
      await updateTask({ task_id: task.id, status: 'failed' });
      actions.push({
        action: 'cortex-failed',
        task_id: task.id,
        error: err.message,
        failure_count: quarantineResult.failure_count
      });
    }

    return {
      dispatched: false,
      reason: 'cortex_error',
      task_id: task.id,
      error: err.message,
      actions
    };
  }
}
