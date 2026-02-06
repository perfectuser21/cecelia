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
import { validateDecision, hasDangerousActions } from './thalamus.js';

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
      params.type || 'objective',
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
      INSERT INTO cecelia_events (type, source, data)
      VALUES ('user_notification', 'thalamus', $1)
    `, [JSON.stringify(params)]);

    return { success: true };
  },

  /**
   * 记录事件
   */
  async log_event(params, context) {
    await pool.query(`
      INSERT INTO cecelia_events (type, source, data)
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
      INSERT INTO cecelia_events (type, source, data, status)
      VALUES ('human_review_request', 'thalamus', $1, 'pending')
    `, [JSON.stringify(params)]);

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
  // Cortex (皮层) Actions
  // ============================================================

  /**
   * 调整系统策略参数
   */
  async adjust_strategy(params, context) {
    const { key, new_value, reason } = params;
    console.log(`[executor] Adjusting strategy: ${key} = ${new_value} (${reason})`);

    // 写入 brain_config 表
    await pool.query(`
      INSERT INTO brain_config (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
    `, [`strategy_${key}`, String(new_value)]);

    // 记录变更事件
    await pool.query(`
      INSERT INTO cecelia_events (type, source, data)
      VALUES ('strategy_change', 'cortex', $1)
    `, [JSON.stringify({ key, new_value, reason, changed_at: new Date().toISOString() })]);

    return { success: true, key, new_value };
  },

  /**
   * 记录学习到的经验
   */
  async record_learning(params, context) {
    const { learning, category, event_context } = params;
    console.log(`[executor] Recording learning: ${learning}`);

    await pool.query(`
      INSERT INTO cecelia_events (type, source, data)
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
// Executor
// ============================================================

/**
 * 执行 Decision
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
    started_at: new Date().toISOString(),
    completed_at: null,
    requires_human: false
  };

  // 1. 验证 Decision
  const validation = validateDecision(decision);
  if (!validation.valid) {
    report.success = false;
    report.error = `Invalid decision: ${validation.errors.join('; ')}`;
    report.completed_at = new Date().toISOString();
    return report;
  }

  // 2. 检查危险操作
  if (hasDangerousActions(decision)) {
    if (!decision.safety) {
      report.success = false;
      report.error = 'Dangerous actions require safety: true';
      report.completed_at = new Date().toISOString();
      return report;
    }
    report.requires_human = true;
  }

  // 3. 执行 actions
  for (const action of decision.actions) {
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
    }
  }

  // 4. 记录执行日志
  await logExecution(decision, report);

  report.success = report.actions_failed.length === 0;
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
};
