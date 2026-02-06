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
import { ACTION_WHITELIST, validateDecision, recordLLMError } from './thalamus.js';

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

## 规则

1. 必须提供 analysis 分析过程
2. 只能使用白名单内的 action
3. 危险操作必须 safety: true
4. 记录 learnings 供未来参考

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
async function performRCA(failedTask, history = []) {
  const event = {
    type: 'rca_request',
    failed_task: failedTask,
    failure_history: history,
    timestamp: new Date().toISOString()
  };

  const decision = await analyzeDeep(event, {
    reason: 'repeated_failure',
    failure_count: history.length + 1
  });

  return {
    task_id: failedTask.id,
    analysis: decision.analysis,
    recommended_actions: decision.actions,
    learnings: decision.learnings,
    confidence: decision.confidence
  };
}

// ============================================================
// Exports
// ============================================================

export {
  // 主入口
  analyzeDeep,
  performRCA,

  // API
  callOpus,

  // 验证
  validateCortexDecision,
  createCortexFallback,

  // 常量
  CORTEX_ACTION_WHITELIST,
};
