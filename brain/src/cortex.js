/**
 * Cortex - 皮层（深度思考）
 *
 * 仿人脑设计：
 * - 由丘脑 (thalamus) 唤醒
 * - 只处理 level=2 的复杂决策
 * - 用 Opus 模型深度思考
 *
 * 职责：
 * 1. 跨部门资源权衡
 * 2. 复杂异常分析 (RCA)
 * 3. 战略决策与调整
 * 4. 复盘与学习
 *
 * 核心原则：LLM 只能下"指令"，不能直接改世界
 */

/* global console */

import pool from './db.js';
import { ACTION_WHITELIST, validateDecision, recordLLMError, recordTokenUsage } from './thalamus.js';
import { searchRelevantLearnings } from './learning.js';

// ============================================================
// Cortex Prompt
// ============================================================

const CORTEX_PROMPT = `你是 Cecelia 的皮层（Cortex），负责深度思考和战略决策。

## 你被唤醒的原因

丘脑（Thalamus）判断当前事件复杂度为 Level 2，需要你深度思考。
Level 2 事件包括：
- 跨部门资源冲突
- 连续失败需要根因分析
- 战略方向调整
- 复盘与学习

## 你的职责

1. **深度分析**：不要急于给结论，先分析所有相关因素
2. **根因追溯**：找到问题的真正原因，不是表面症状
3. **权衡取舍**：多个方案时，分析利弊，做出选择
4. **生成策略**：输出具体可执行的 actions
5. **策略调整**：基于失败模式，生成系统参数调整建议（strategy_updates）

## 可用 Actions（白名单）
${Object.entries(ACTION_WHITELIST).map(([type, config]) => `- ${type}: ${config.description}`).join('\n')}

## 额外 Cortex Actions
- adjust_strategy: 调整系统策略参数
- record_learning: 记录学习到的经验
- create_rca_report: 创建根因分析报告

## 输出格式（严格 JSON）
{
  "level": 2,
  "analysis": {
    "root_cause": "问题根因分析",
    "contributing_factors": ["因素1", "因素2"],
    "impact_assessment": "影响评估"
  },
  "actions": [
    {"type": "action_type", "params": {...}}
  ],
  "strategy_updates": [
    {"key": "策略键", "old_value": "旧值", "new_value": "新值", "reason": "原因"}
  ],
  "learnings": ["学到的经验1", "经验2"],
  "rationale": "深度决策原因",
  "confidence": 0.0-1.0,
  "safety": false
}

## strategy_updates 规则（CRITICAL）

**当执行 RCA 分析时，必须生成 strategy_updates 建议**。

可调整参数（白名单）：
- alertness.emergency_threshold (0.5-1.0): Emergency alertness threshold
- alertness.alert_threshold (0.3-0.8): Alert threshold
- retry.max_attempts (1-5): Maximum retry attempts
- retry.base_delay_minutes (1-30): Base delay between retries (minutes)
- resource.max_concurrent (1-20): Maximum concurrent tasks
- resource.memory_threshold_mb (500-4000): Memory threshold (MB)

**输出格式示例**：
{
  "strategy_updates": [
    {
      "key": "retry.max_attempts",
      "old_value": 3,
      "new_value": 5,
      "reason": "Increase retry attempts to handle transient network failures"
    }
  ]
}

**要求**：
1. 只调整白名单中的参数
2. 新值必须在允许范围内
3. 必须提供调整原因（reason）
4. 如果没有需要调整的参数，返回空数组 []

## 规则

1. 必须提供 analysis 分析过程
2. 只能使用白名单内的 action
3. 危险操作必须 safety: true
4. 记录 learnings 供未来参考
5. RCA 分析必须包含 strategy_updates 建议

请深度分析以下事件：`;

// ============================================================
// Cortex Action 扩展
// ============================================================

const CORTEX_ACTION_WHITELIST = {
  ...ACTION_WHITELIST,
  'adjust_strategy': { dangerous: true, description: '调整系统策略参数' },
  'record_learning': { dangerous: false, description: '记录学习到的经验' },
  'create_rca_report': { dangerous: false, description: '创建根因分析报告' },
};

// ============================================================
// Opus API 调用
// ============================================================

/**
 * 调用 Opus API 进行深度分析
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function callOpus(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  console.log('[cortex] Calling Opus for deep analysis...');
  const startTime = Date.now();

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-20250514',
      max_tokens: 4096,  // 允许更长输出
      messages: [
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Opus API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const elapsed = Date.now() - startTime;
  console.log(`[cortex] Opus responded in ${elapsed}ms`);

  // Build #4: 记录 token 消耗
  await recordTokenUsage('cortex', 'claude-opus-4-20250514', data.usage, {
    elapsed_ms: elapsed,
  });

  return data.content[0].text;
}

// ============================================================
// 深度分析
// ============================================================

/**
 * 从 Opus 响应中解析 Decision
 * @param {string} response
 * @returns {Object}
 */
function parseCortexDecision(response) {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in Opus response');
  }
  return JSON.parse(jsonMatch[0]);
}

/**
 * 验证 Cortex Decision
 * @param {Object} decision
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateCortexDecision(decision) {
  const errors = [];

  // 基本验证
  if (decision.level !== 2) {
    errors.push('Cortex decision must have level=2');
  }

  if (!decision.analysis) {
    errors.push('Cortex decision must have analysis');
  }

  if (!Array.isArray(decision.actions)) {
    errors.push('actions must be array');
  }

  if (typeof decision.rationale !== 'string') {
    errors.push('rationale must be string');
  }

  if (typeof decision.confidence !== 'number') {
    errors.push('confidence must be number');
  }

  // 验证 actions 在白名单内
  if (Array.isArray(decision.actions)) {
    for (const action of decision.actions) {
      if (!CORTEX_ACTION_WHITELIST[action.type]) {
        errors.push(`action type "${action.type}" not in whitelist`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 创建 Cortex 降级 Decision
 * @param {Object} event
 * @param {string} reason
 * @returns {Object}
 */
function createCortexFallback(event, reason) {
  return {
    level: 2,
    analysis: {
      root_cause: 'Cortex analysis failed',
      contributing_factors: [reason],
      impact_assessment: 'Unable to perform deep analysis'
    },
    actions: [{ type: 'request_human_review', params: { reason, event_type: event.type } }],
    strategy_updates: [],
    learnings: [`Cortex failed: ${reason}`],
    rationale: `皮层降级：${reason}，需要人工介入`,
    confidence: 0.3,
    safety: true,
    _fallback: true
  };
}

/**
 * 皮层深度分析入口
 * @param {Object} event - 事件包
 * @param {Object} thalamusDecision - 丘脑的初步判断
 * @returns {Promise<Object>} - Cortex Decision
 */
async function analyzeDeep(event, thalamusDecision = null) {
  console.log(`[cortex] Deep analysis triggered for event: ${event.type}`);

  // 构建上下文
  const context = {
    event,
    thalamus_judgment: thalamusDecision,
    timestamp: new Date().toISOString()
  };

  // 获取相关历史（最近的决策日志）
  try {
    const historyResult = await pool.query(`
      SELECT trigger, input_summary, llm_output_json, status, created_at
      FROM decision_log
      WHERE created_at > NOW() - INTERVAL '24 hours'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    context.recent_decisions = historyResult.rows;
  } catch (err) {
    console.error('[cortex] Failed to fetch decision history:', err.message);
    context.recent_decisions = [];
  }

  // 获取当前系统状态
  try {
    const statusResult = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM tasks WHERE status = 'in_progress') as tasks_in_progress,
        (SELECT COUNT(*) FROM tasks WHERE status = 'failed' AND updated_at > NOW() - INTERVAL '24 hours') as recent_failures,
        (SELECT COUNT(*) FROM goals WHERE status = 'in_progress') as active_goals
    `);
    context.system_status = statusResult.rows[0];
  } catch (err) {
    console.error('[cortex] Failed to fetch system status:', err.message);
  }

  // Build #1: 注入历史经验到皮层（使用语义检索）
  const learnings = await searchRelevantLearnings({
    task_type: event.failed_task?.task_type || event.task?.task_type,
    failure_class: event.failure_history?.[0]?.failure_classification?.class,
    event_type: event.type
  }, 20);

  if (learnings.length > 0) {
    context.historical_learnings = learnings.map((l, i) => ({
      rank: i + 1,
      relevance_score: l.relevance_score || 0,
      title: l.title,
      insight: (l.content || '').slice(0, 300)
    }));
  }

  // Build #2: 注入历史 Cortex 分析（相似问题的深度分析结论）
  try {
    const historicalAnalyses = await searchRelevantAnalyses({
      task_type: event.failed_task?.task_type || event.task?.task_type,
      failure_class: event.failure_history?.[0]?.failure_classification?.class,
      trigger_event: event.type
    }, 5);

    if (historicalAnalyses.length > 0) {
      context.historical_analyses = historicalAnalyses.map((a, i) => ({
        rank: i + 1,
        relevance_score: a.relevance_score || 0,
        root_cause: a.root_cause,
        mitigations: a.mitigations ? JSON.parse(a.mitigations).slice(0, 3) : [],
        created_at: a.created_at
      }));
    }
  } catch (err) {
    console.error('[cortex] Failed to fetch historical analyses:', err.message);
  }

  // Inject adjustable parameters for RCA requests
  if (event.type === 'rca_request' && thalamusDecision?.adjustable_params) {
    context.adjustable_params = thalamusDecision.adjustable_params;
  }

  const contextJson = JSON.stringify(context, null, 2);
  const prompt = `${CORTEX_PROMPT}\n\n\`\`\`json\n${contextJson}\n\`\`\``;

  try {
    const response = await callOpus(prompt);
    const decision = parseCortexDecision(response);

    // 验证
    const validation = validateCortexDecision(decision);
    if (!validation.valid) {
      console.error('[cortex] Invalid decision:', validation.errors);
      return createCortexFallback(event, validation.errors.join('; '));
    }

    // 记录到决策日志
    await logCortexDecision(event, decision);

    // 记录 learnings
    if (decision.learnings && decision.learnings.length > 0) {
      await recordLearnings(decision.learnings, event);
    }

    return decision;

  } catch (err) {
    console.error('[cortex] Deep analysis failed:', err.message);
    await recordLLMError('cortex', err, { event_type: event.type });
    return createCortexFallback(event, err.message);
  }
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 记录 Cortex 决策到日志
 */
async function logCortexDecision(event, decision) {
  try {
    await pool.query(`
      INSERT INTO decision_log (trigger, input_summary, llm_output_json, action_result_json, status)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      'cortex',
      `Deep analysis for ${event.type}`,
      decision,
      { analysis: decision.analysis },
      'pending'
    ]);
  } catch (err) {
    console.error('[cortex] Failed to log decision:', err.message);
  }
}

/**
 * 记录学习经验
 */
async function recordLearnings(learnings, event) {
  try {
    for (const learning of learnings) {
      await pool.query(`
        INSERT INTO cecelia_events (event_type, source, payload)
        VALUES ('learning', 'cortex', $1)
      `, [JSON.stringify({
        learning,
        event_type: event.type,
        recorded_at: new Date().toISOString()
      })]);
    }
    console.log(`[cortex] Recorded ${learnings.length} learnings`);
  } catch (err) {
    console.error('[cortex] Failed to record learnings:', err.message);
  }
}

// ============================================================
// RCA (Root Cause Analysis) 专用
// ============================================================

/**
 * 执行根因分析
 * @param {Object} failedTask - 失败的任务
 * @param {Object[]} history - 历史失败记录
 * @returns {Promise<Object>} - RCA 报告
 */
// ============================================================
// Cortex Memory - Persistent Storage
// ============================================================

/**
 * Save Cortex analysis to persistent storage
 * @param {Object} analysis - RCA analysis result from performRCA
 * @param {Object} context - Analysis context (task, event, etc.)
 * @returns {Promise<UUID>} - Analysis record ID
 */
async function saveCortexAnalysis(analysis, context = {}) {
  const { task, event, failureInfo } = context;

  const result = await pool.query(`
    INSERT INTO cortex_analyses (
      task_id,
      event_id,
      trigger_event_type,
      root_cause,
      contributing_factors,
      mitigations,
      failure_pattern,
      affected_systems,
      learnings,
      strategy_adjustments,
      analysis_depth,
      confidence_score,
      analyst,
      metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING id
  `, [
    task?.id || null,
    event?.id || null,
    event?.type || 'rca_request',
    analysis.analysis || 'No root cause identified',
    JSON.stringify(analysis.contributing_factors || []),
    JSON.stringify(analysis.recommended_actions || []),
    JSON.stringify(failureInfo || {}),
    JSON.stringify([]),
    JSON.stringify(analysis.learnings || []),
    JSON.stringify(analysis.strategy_adjustments || []),
    'deep',
    analysis.confidence || 0.8,
    'cortex',
    JSON.stringify({ created_by: 'performRCA', ...context.metadata })
  ]);

  return result.rows[0].id;
}

/**
 * Search relevant historical Cortex analyses
 * @param {Object} context - Search context
 * @param {string} context.task_type - Task type
 * @param {string} context.failure_class - Failure class (NETWORK, BILLING_CAP, etc.)
 * @param {string} context.trigger_event - Trigger event type
 * @param {number} limit - Max results
 * @returns {Promise<Array>} - Sorted by relevance score
 */
async function searchRelevantAnalyses(context = {}, limit = 5) {
  // Fetch recent analyses (last 100)
  const result = await pool.query(`
    SELECT
      id, task_id, event_id, trigger_event_type,
      root_cause, contributing_factors, mitigations,
      failure_pattern, learnings, strategy_adjustments,
      analysis_depth, confidence_score, created_at, metadata
    FROM cortex_analyses
    ORDER BY created_at DESC
    LIMIT 100
  `);

  // Score each analysis
  const scoredAnalyses = result.rows.map(analysis => {
    let score = 0;
    const failurePattern = analysis.failure_pattern || {};
    const rootCauseLower = (analysis.root_cause || '').toLowerCase();

    // 1. Failure class match (weight: 10)
    if (context.failure_class && failurePattern.class === context.failure_class) {
      score += 10;
    }

    // 2. Task type match (weight: 8)
    if (context.task_type && failurePattern.task_type === context.task_type) {
      score += 8;
    }

    // 3. Trigger event match (weight: 6)
    if (context.trigger_event && analysis.trigger_event_type === context.trigger_event) {
      score += 6;
    }

    // 4. Freshness (weight: 1-3)
    const ageInDays = (Date.now() - new Date(analysis.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (ageInDays <= 7) score += 3;
    else if (ageInDays <= 30) score += 2;
    else score += 1;

    return { ...analysis, relevance_score: score };
  });

  // Sort by score descending
  scoredAnalyses.sort((a, b) => b.relevance_score - a.relevance_score);

  return scoredAnalyses.slice(0, limit);
}

// ============================================================
// Root Cause Analysis (RCA)
// ============================================================

async function performRCA(failedTask, history = []) {
  const event = {
    type: 'rca_request',
    failed_task: failedTask,
    failure_history: history,
    timestamp: new Date().toISOString()
  };

  // Inject adjustable parameters into context for RCA
  const rcaContext = {
    reason: 'repeated_failure',
    failure_count: history.length + 1,
    adjustable_params: {
      'alertness.emergency_threshold': { range: '0.5-1.0', description: 'Emergency alertness threshold' },
      'alertness.alert_threshold': { range: '0.3-0.8', description: 'Alert threshold' },
      'retry.max_attempts': { range: '1-5', description: 'Maximum retry attempts' },
      'retry.base_delay_minutes': { range: '1-30', description: 'Base delay between retries (minutes)' },
      'resource.max_concurrent': { range: '1-20', description: 'Maximum concurrent tasks' },
      'resource.memory_threshold_mb': { range: '500-4000', description: 'Memory threshold (MB)' },
    }
  };

  const decision = await analyzeDeep(event, rcaContext);

  // Extract strategy_adjustments from decision
  const strategyAdjustments = decision.strategy_updates?.map(update => ({
    params: {
      param: update.key,
      new_value: update.new_value,
      current_value: update.old_value,
      reason: update.reason
    }
  })) || [];

  const analysisResult = {
    task_id: failedTask.id,
    analysis: decision.analysis,
    recommended_actions: decision.actions,
    learnings: decision.learnings,
    strategy_adjustments: strategyAdjustments,
    confidence: decision.confidence
  };

  // Persist analysis to cortex_analyses table
  try {
    const analysisId = await saveCortexAnalysis(analysisResult, {
      task: failedTask,
      event,
      failureInfo: {
        class: history[0]?.failure_classification?.class || 'UNKNOWN',
        task_type: failedTask.task_type,
        frequency: history.length + 1,
        severity: 'high'
      },
      metadata: { rca_trigger: 'repeated_failure', failure_count: history.length + 1 }
    });
    console.log(`[Cortex] Analysis saved: ${analysisId}`);
  } catch (err) {
    console.error('[Cortex] Failed to save analysis:', err.message);
    // Non-fatal, continue
  }

  return analysisResult;
}

// ============================================================
// Exports
// ============================================================

export {
  // 主入口
  analyzeDeep,
  performRCA,

  // Memory
  saveCortexAnalysis,
  searchRelevantAnalyses,

  // API
  callOpus,

  // 验证
  validateCortexDecision,
  createCortexFallback,

  // 常量
  CORTEX_ACTION_WHITELIST,
};
