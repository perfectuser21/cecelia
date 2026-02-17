/**
 * Decision Executor - 执行丘脑的决策
 *
 * 核心原则：LLM 只能下"指令"，代码负责执行
 *
 * 职责：
 * 1. 接收 Decision
 * 2. 验证 Decision 合法性
 * 3. 按顺序执行 actions
 * 4. 记录执行结果
 * 5. 返回执行报告
 */

/* global console */
import pool from './db.js';
import { createTask, updateTask } from './actions.js';
import { validateDecision, hasDangerousActions, ACTION_WHITELIST } from './thalamus.js';
import { CORTEX_ACTION_WHITELIST } from './cortex.js';

// ============================================================
// Action Handlers
// ============================================================

const actionHandlers = {
  /**
   * 派发任务
   */
  async dispatch_task(params, context) {
    // 这里调用现有的 tick 派发逻辑
    const { dispatchNextTask } = await import('./tick.js');
    const result = await dispatchNextTask(params.trigger || 'thalamus');
    return { success: true, dispatched: result };
  },

  /**
   * 创建任务
   */
  async create_task(params, context) {
    const result = await createTask({
      title: params.title,
      description: params.description,
      task_type: params.task_type || 'dev',
      priority: params.priority || 'P1',
      project_id: params.project_id,
      goal_id: params.goal_id,
      payload: params.payload
    });
    return { success: result.success, task_id: result.task?.id };
  },

  /**
   * 取消任务
   */
  async cancel_task(params, context) {
    const result = await updateTask({
      task_id: params.task_id,
      status: 'cancelled'
    });
    return { success: result.success };
  },

  /**
   * 重试任务
   */
  async retry_task(params, context) {
    const result = await updateTask({
      task_id: params.task_id,
      status: 'queued'
    });
    return { success: result.success };
  },

  /**
   * 调整优先级
   */
  async reprioritize_task(params, context) {
    const result = await updateTask({
      task_id: params.task_id,
      priority: params.priority
    });
    return { success: result.success };
  },

  /**
   * 暂停任务
   */
  async pause_task(params, context) {
    const result = await updateTask({
      task_id: params.task_id,
      status: 'paused'
    });
    return { success: result.success };
  },

  /**
   * 恢复任务（从暂停或阻塞状态恢复到队列）
   */
  async resume_task(params, context) {
    const result = await updateTask({
      task_id: params.task_id,
      status: 'queued'
    });
    return { success: result.success };
  },

  /**
   * 标记任务为阻塞（记录阻塞原因）
   */
  async mark_task_blocked(params, context) {
    const result = await updateTask({
      task_id: params.task_id,
      status: 'blocked'
    });
    return { success: result.success, reason: params.reason };
  },

  /**
   * 隔离任务（调用隔离模块，dangerous=true）
   */
  async quarantine_task(params, context) {
    const { quarantineTask } = await import('./quarantine.js');
    const result = await quarantineTask(params.task_id, params.reason || 'thalamus_decision', {
      failure_class: params.failure_class || 'quality'
    });
    return { success: result.success, already_quarantined: result.already_quarantined };
  },

  /**
   * 创建 OKR
   */
  async create_okr(params, context) {
    const result = await pool.query(`
      INSERT INTO goals (title, description, type, status, priority, project_id)
      VALUES ($1, $2, $3, 'ready', $4, $5)
      RETURNING id
    `, [
      params.title,
      params.description || '',
      params.type || 'global_okr',
      params.priority || 'P1',
      params.project_id || null
    ]);
    return { success: true, goal_id: result.rows[0]?.id };
  },

  /**
   * 更新 OKR 进度
   */
  async update_okr_progress(params, context) {
    await pool.query(`
      UPDATE goals SET progress = $1, updated_at = NOW()
      WHERE id = $2
    `, [params.progress, params.goal_id]);
    return { success: true };
  },

  /**
   * 交给秋米拆解
   */
  async assign_to_autumnrice(params, context) {
    // 创建 decomposition 任务
    const result = await createTask({
      title: `OKR 拆解: ${params.okr_title}`,
      description: params.okr_description,
      task_type: 'dev',
      priority: 'P0',
      goal_id: params.goal_id,
      payload: {
        decomposition: 'true',
        objective_id: params.goal_id
      }
    });
    return { success: result.success, task_id: result.task?.id };
  },

  /**
   * 通知用户
   */
  async notify_user(params, context) {
    // TODO: 实现通知逻辑（可以是 WebSocket、Slack、邮件等）
    console.log(`[executor] Notify user: ${params.message}`);

    // 写入事件表
    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ('user_notification', 'thalamus', $1)
    `, [JSON.stringify(params)]);

    return { success: true };
  },

  /**
   * 记录事件
   */
  async log_event(params, context) {
    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ($1, 'thalamus', $2)
    `, [params.event_type || 'log', JSON.stringify(params.data || {})]);
    return { success: true };
  },

  /**
   * 升级到 Brain LLM
   */
  async escalate_to_brain(params, context) {
    // 创建一个需要 Brain 处理的任务
    const result = await createTask({
      title: `Brain 决策: ${params.reason}`,
      description: `需要 Brain LLM 深度思考的问题:\n${params.context || ''}`,
      task_type: 'talk', // Brain 用 talk 类型
      priority: 'P0',
      payload: {
        escalation: true,
        original_event: params.original_event,
        reason: params.reason
      }
    });
    return { success: result.success, task_id: result.task?.id };
  },

  /**
   * 请求人工确认
   */
  async request_human_review(params, context) {
    console.log(`[executor] Human review requested: ${params.reason}`);

    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ('human_review_request', 'thalamus', $1)
    `, [JSON.stringify({ ...params, status: 'pending' })]);

    return { success: true, requires_human: true };
  },

  /**
   * 分析失败原因
   */
  async analyze_failure(params, context) {
    // 创建分析任务
    const result = await createTask({
      title: `分析失败: ${params.task_title}`,
      description: `任务失败 ${params.retry_count} 次，需要分析原因`,
      task_type: 'research',
      priority: 'P1',
      payload: {
        analysis_type: 'failure',
        failed_task_id: params.task_id,
        error_message: params.error
      }
    });
    return { success: result.success, analysis_task_id: result.task?.id };
  },

  /**
   * 预测进度
   */
  async predict_progress(params, context) {
    // TODO: 实现进度预测逻辑
    console.log(`[executor] Progress prediction requested for: ${params.goal_id}`);
    return { success: true, prediction: 'not_implemented' };
  },

  /**
   * 不需要操作
   */
  async no_action(params, context) {
    return { success: true, action: 'none' };
  },

  /**
   * 降级到纯代码 Tick
   */
  async fallback_to_tick(params, context) {
    console.log('[executor] Falling back to code-based Tick');
    // 不做任何事，让 Tick 的代码逻辑接管
    return { success: true, fallback: true };
  },

  // ============================================================
  // 任务生命周期 Actions
  // ============================================================

  /**
   * 更新任务 PRD 内容
   * 用于探索任务完成后，将发现的信息更新回 PRD
   */
  async update_task_prd(params, context) {
    const { task_id, prd_content } = params;
    if (!task_id) {
      return { success: false, error: 'task_id is required' };
    }
    if (!prd_content) {
      return { success: false, error: 'prd_content is required' };
    }
    await pool.query(
      `UPDATE tasks SET prd_content = $1, updated_at = NOW() WHERE id = $2`,
      [prd_content, task_id]
    );
    console.log(`[executor] Updated PRD for task: ${task_id}`);
    return { success: true, task_id };
  },

  /**
   * 归档完成/超期任务
   * 将任务状态设置为 archived，用于清理长期未执行或已过期的任务
   */
  async archive_task(params, context) {
    const { task_id, reason } = params;
    if (!task_id) {
      return { success: false, error: 'task_id is required' };
    }
    await pool.query(
      `UPDATE tasks SET status = 'archived', updated_at = NOW() WHERE id = $1`,
      [task_id]
    );
    console.log(`[executor] Archived task: ${task_id}, reason: ${reason || 'not specified'}`);
    return { success: true, task_id, reason: reason || null };
  },

  /**
   * 延迟任务到指定时间
   * 更新 tasks.due_at 字段，任务保持 queued 状态等待调度器处理
   */
  async defer_task(params, context) {
    const { task_id, defer_until } = params;
    if (!task_id) {
      return { success: false, error: 'task_id is required' };
    }
    if (!defer_until) {
      return { success: false, error: 'defer_until is required (ISO 8601 timestamp)' };
    }
    const deferDate = new Date(defer_until);
    if (isNaN(deferDate.getTime())) {
      return { success: false, error: 'defer_until must be a valid ISO 8601 timestamp' };
    }
    await pool.query(
      `UPDATE tasks SET due_at = $1, updated_at = NOW() WHERE id = $2`,
      [deferDate.toISOString(), task_id]
    );
    console.log(`[executor] Deferred task: ${task_id} until ${defer_until}`);
    return { success: true, task_id, defer_until };
  },

  // ============================================================
  // Cortex (皮层) Actions
  // ============================================================

  /**
   * 调整系统策略参数（受限）
   *
   * 安全限制：
   * 1. 只允许调整白名单内的参数
   * 2. 只能是 numeric 参数
   * 3. 调整幅度限制 ±20%
   * 4. 禁止调整安全相关参数
   */
  async adjust_strategy(params, context) {
    const { key, new_value, reason } = params;

    // 白名单：只允许调整这些参数
    const ADJUSTABLE_PARAMS = {
      // 派发相关（允许调整）
      'dispatch_interval_ms': { min: 3000, max: 60000, default: 5000 },
      'max_concurrent_tasks': { min: 1, max: 10, default: 3 },
      'task_timeout_ms': { min: 60000, max: 1800000, default: 600000 },

      // 阈值相关（允许调整）
      'failure_rate_threshold': { min: 0.2, max: 0.5, default: 0.3 },
      'retry_delay_ms': { min: 5000, max: 120000, default: 30000 },
    };

    // 禁止列表：绝对不能调整的参数
    const FORBIDDEN_PARAMS = [
      'quarantine_threshold',
      'alertness_thresholds',
      'dangerous_action_list',
      'action_whitelist',
      'security_level',
    ];

    // 检查是否在禁止列表
    if (FORBIDDEN_PARAMS.includes(key)) {
      console.error(`[executor] BLOCKED: Cannot adjust forbidden parameter: ${key}`);
      return { success: false, error: 'forbidden_parameter', key };
    }

    // 检查是否在白名单
    const paramConfig = ADJUSTABLE_PARAMS[key];
    if (!paramConfig) {
      console.error(`[executor] BLOCKED: Parameter not in whitelist: ${key}`);
      return { success: false, error: 'not_in_whitelist', key };
    }

    // 验证新值是数字
    const numValue = parseFloat(new_value);
    if (isNaN(numValue)) {
      return { success: false, error: 'must_be_numeric', key };
    }

    // 验证范围
    if (numValue < paramConfig.min || numValue > paramConfig.max) {
      return {
        success: false,
        error: 'out_of_range',
        key,
        allowed_range: { min: paramConfig.min, max: paramConfig.max }
      };
    }

    // 获取当前值
    const currentResult = await pool.query(
      `SELECT value FROM brain_config WHERE key = $1`,
      [`strategy_${key}`]
    );
    const currentValue = currentResult.rows[0]?.value
      ? parseFloat(currentResult.rows[0].value)
      : paramConfig.default;

    // 检查调整幅度（最多 ±20%）
    const MAX_CHANGE_RATIO = 0.2;
    const changeRatio = Math.abs(numValue - currentValue) / currentValue;
    if (changeRatio > MAX_CHANGE_RATIO) {
      return {
        success: false,
        error: 'change_too_large',
        key,
        max_change: `±${MAX_CHANGE_RATIO * 100}%`,
        actual_change: `${(changeRatio * 100).toFixed(1)}%`
      };
    }

    console.log(`[executor] Adjusting strategy: ${key} = ${currentValue} → ${numValue} (${reason})`);

    // 写入 brain_config 表
    await pool.query(`
      INSERT INTO brain_config (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
    `, [`strategy_${key}`, String(numValue)]);

    // 记录变更事件（包含 previous_value 用于回滚）
    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ('strategy_change', 'cortex', $1)
    `, [JSON.stringify({
      key,
      previous_value: currentValue,
      new_value: numValue,
      change_ratio: changeRatio,
      reason,
      changed_at: new Date().toISOString(),
      can_rollback: true
    })]);

    return { success: true, key, previous_value: currentValue, new_value: numValue };
  },

  /**
   * 记录学习到的经验
   */
  async record_learning(params, context) {
    const { learning, category, event_context } = params;
    console.log(`[executor] Recording learning: ${learning}`);

    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ('learning', 'cortex', $1)
    `, [JSON.stringify({
      learning,
      category: category || 'general',
      context: event_context,
      recorded_at: new Date().toISOString()
    })]);

    return { success: true };
  },

  /**
   * 创建根因分析报告
   */
  async create_rca_report(params, context) {
    const { task_id, root_cause, contributing_factors, recommended_actions } = params;
    console.log(`[executor] Creating RCA report for task: ${task_id}`);

    // 存入 decision_log 作为 RCA 记录
    await pool.query(`
      INSERT INTO decision_log (trigger, input_summary, llm_output_json, action_result_json, status)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      'rca',
      `Root Cause Analysis for task ${task_id}`,
      { root_cause, contributing_factors, recommended_actions },
      { task_id, created_at: new Date().toISOString() },
      'completed'
    ]);

    return { success: true, task_id };
  },
};

// ============================================================
// Dangerous Action Detection
// ============================================================

/**
 * 检查单个 action 是否危险
 * @param {Object} action
 * @returns {boolean}
 */
function isActionDangerous(action) {
  const config = ACTION_WHITELIST[action.type] || CORTEX_ACTION_WHITELIST?.[action.type];
  return config?.dangerous === true;
}

/**
 * 将危险动作入队待审批
 * @param {Object} action
 * @param {Object} context
 * @param {Object} client - DB 事务客户端
 * @returns {Promise<Object>}
 */
async function enqueueDangerousAction(action, context, client) {
  const result = await client.query(`
    INSERT INTO pending_actions (action_type, params, context, decision_id, status, expires_at)
    VALUES ($1, $2, $3, $4, 'pending_approval', NOW() + INTERVAL '24 hours')
    RETURNING id
  `, [
    action.type,
    JSON.stringify(action.params || {}),
    JSON.stringify(context),
    context.decision_id || null
  ]);

  console.log(`[executor] Dangerous action queued for approval: ${action.type} (id: ${result.rows[0].id})`);

  return {
    success: true,
    pending_approval: true,
    pending_action_id: result.rows[0].id
  };
}

// ============================================================
// Pending Actions Management
// ============================================================

/**
 * 获取待审批动作列表
 */
async function getPendingActions() {
  const result = await pool.query(`
    SELECT id, action_type, params, context, decision_id, created_at, status, expires_at
    FROM pending_actions
    WHERE status = 'pending_approval'
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY created_at ASC
  `);
  return result.rows;
}

/**
 * 批准并执行待审批动作
 * @param {string} actionId
 * @param {string} reviewer
 */
async function approvePendingAction(actionId, reviewer = 'unknown') {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 获取待审批动作
    const actionResult = await client.query(
      'SELECT * FROM pending_actions WHERE id = $1 FOR UPDATE',
      [actionId]
    );

    if (actionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Action not found' };
    }

    const action = actionResult.rows[0];

    if (action.status !== 'pending_approval') {
      await client.query('ROLLBACK');
      return { success: false, error: `Action is ${action.status}, not pending_approval` };
    }

    // 检查是否过期
    if (action.expires_at && new Date(action.expires_at) < new Date()) {
      await client.query(
        'UPDATE pending_actions SET status = $1, reviewed_at = NOW() WHERE id = $2',
        ['expired', actionId]
      );
      await client.query('COMMIT');
      return { success: false, error: 'Action has expired' };
    }

    // 执行动作
    const handler = actionHandlers[action.action_type];
    if (!handler) {
      await client.query('ROLLBACK');
      return { success: false, error: `No handler for action type: ${action.action_type}` };
    }

    const params = typeof action.params === 'string' ? JSON.parse(action.params) : action.params;
    const context = typeof action.context === 'string' ? JSON.parse(action.context) : action.context;

    const executionResult = await handler(params, { ...context, approved_by: reviewer });

    // 更新状态
    await client.query(`
      UPDATE pending_actions
      SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), execution_result = $2
      WHERE id = $3
    `, [reviewer, JSON.stringify(executionResult), actionId]);

    await client.query('COMMIT');

    console.log(`[executor] Pending action ${actionId} approved and executed by ${reviewer}`);

    return { success: true, execution_result: executionResult };

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[executor] Failed to approve action:', err.message);
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}

/**
 * 拒绝待审批动作
 * @param {string} actionId
 * @param {string} reviewer
 * @param {string} reason
 */
async function rejectPendingAction(actionId, reviewer = 'unknown', reason = '') {
  const result = await pool.query(`
    UPDATE pending_actions
    SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(),
        execution_result = $2
    WHERE id = $3 AND status = 'pending_approval'
    RETURNING id
  `, [reviewer, JSON.stringify({ rejected: true, reason }), actionId]);

  if (result.rowCount === 0) {
    return { success: false, error: 'Action not found or already processed' };
  }

  console.log(`[executor] Pending action ${actionId} rejected by ${reviewer}: ${reason}`);
  return { success: true };
}

// ============================================================
// Executor (Transactional)
// ============================================================

/**
 * 执行 Decision（事务化）
 * @param {Decision} decision
 * @param {Object} context - 执行上下文
 * @returns {Promise<ExecutionReport>}
 */
async function executeDecision(decision, context = {}) {
  const report = {
    success: true,
    decision_level: decision.level,
    actions_executed: [],
    actions_failed: [],
    actions_pending_approval: [],
    started_at: new Date().toISOString(),
    completed_at: null,
    requires_human: false,
    rolled_back: false
  };

  // 1. 验证 Decision
  const validation = validateDecision(decision);
  if (!validation.valid) {
    report.success = false;
    report.error = `Invalid decision: ${validation.errors.join('; ')}`;
    report.completed_at = new Date().toISOString();
    return report;
  }

  // 2. 检查危险操作是否有 safety 标记
  if (hasDangerousActions(decision)) {
    if (!decision.safety) {
      report.success = false;
      report.error = 'Dangerous actions require safety: true';
      report.completed_at = new Date().toISOString();
      return report;
    }
    report.requires_human = true;
  }

  // 3. 事务化执行 actions
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const action of decision.actions) {
      // 3a. 危险动作入队待审批，不直接执行
      if (isActionDangerous(action)) {
        const pendingResult = await enqueueDangerousAction(action, {
          ...context,
          decision_id: decision.id || null
        }, client);

        report.actions_pending_approval.push({
          type: action.type,
          pending_action_id: pendingResult.pending_action_id
        });
        continue;
      }

      // 3b. 非危险动作正常执行
      const handler = actionHandlers[action.type];

      if (!handler) {
        report.actions_failed.push({
          type: action.type,
          error: 'No handler found'
        });
        continue;
      }

      try {
        console.log(`[executor] Executing action: ${action.type}`);
        const result = await handler(action.params || {}, context);

        report.actions_executed.push({
          type: action.type,
          result
        });

        if (result.requires_human) {
          report.requires_human = true;
        }

      } catch (err) {
        console.error(`[executor] Action failed: ${action.type}`, err.message);
        report.actions_failed.push({
          type: action.type,
          error: err.message
        });
        // 有失败则抛出，触发回滚
        throw err;
      }
    }

    await client.query('COMMIT');

  } catch (err) {
    await client.query('ROLLBACK');
    report.rolled_back = true;
    report.success = false;
    report.error = `Transaction rolled back: ${err.message}`;
    console.error('[executor] Decision execution rolled back:', err.message);

    // 记录回滚事件
    try {
      await pool.query(`
        INSERT INTO cecelia_events (event_type, source, payload)
        VALUES ('decision_rollback', 'executor', $1)
      `, [JSON.stringify({
        decision_level: decision.level,
        rationale: decision.rationale,
        error: err.message,
        actions_attempted: decision.actions.map(a => a.type),
        rolled_back_at: new Date().toISOString()
      })]);
    } catch { /* best effort */ }

  } finally {
    client.release();
  }

  // 4. 记录执行日志
  await logExecution(decision, report);

  report.success = report.actions_failed.length === 0 && !report.rolled_back;
  report.completed_at = new Date().toISOString();

  return report;
}

/**
 * 记录执行日志
 */
async function logExecution(decision, report) {
  try {
    await pool.query(`
      INSERT INTO decision_log (trigger, input_summary, llm_output_json, action_result_json, status)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      'thalamus',
      decision.rationale,
      decision,
      report,
      report.success ? 'success' : 'failed'
    ]);
  } catch (err) {
    console.error('[executor] Failed to log execution:', err.message);
  }
}

// ============================================================
// Exports
// ============================================================

export {
  executeDecision,
  actionHandlers,

  // Pending Actions API
  getPendingActions,
  approvePendingAction,
  rejectPendingAction,
  isActionDangerous,
};
