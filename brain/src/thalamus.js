/**
 * Thalamus - 丘脑（事件路由器）
 *
 * 仿人脑设计：
 * - 接收所有事件
 * - 用 Sonnet 判断复杂度
 * - Level 0/1: 自己处理
 * - Level 2: 唤醒皮层 (Cortex/Opus)
 * - 输出结构化 Decision
 * - 代码验证后执行
 *
 * 三层架构：
 * - 脑干 (Level 0): 纯代码，自动反应
 * - 丘脑 (Level 1): Sonnet，快速判断
 * - 皮层 (Level 2): Opus，深度思考
 *
 * 核心原则：LLM 只能下"指令"，不能直接改世界
 */

/* global console */

import pool from './db.js';
import { searchRelevantLearnings, getRecentLearnings } from './learning.js';

// ============================================================
// LLM Error Type Classification
// ============================================================

const LLM_ERROR_TYPE = {
  API_ERROR: 'llm_api_error',      // API 层错误（网络/配额/服务）
  BAD_OUTPUT: 'llm_bad_output',    // 输出解析失败（格式/验证）
  TIMEOUT: 'llm_timeout',          // 超时
};

/**
 * 分类 LLM 错误类型
 * @param {Error} error
 * @returns {string} - LLM_ERROR_TYPE value
 */
function classifyLLMError(error) {
  const msg = String(error?.message || error || '');

  // API 错误
  if (/API error|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|5\d{2}/i.test(msg)) {
    return LLM_ERROR_TYPE.API_ERROR;
  }
  if (/rate.limit|429|quota|too many requests/i.test(msg)) {
    return LLM_ERROR_TYPE.API_ERROR;
  }
  if (/ANTHROPIC_API_KEY|not set|unauthorized|authentication/i.test(msg)) {
    return LLM_ERROR_TYPE.API_ERROR;
  }

  // 超时
  if (/timeout|timed out|aborted/i.test(msg)) {
    return LLM_ERROR_TYPE.TIMEOUT;
  }

  // 默认：输出解析错误
  return LLM_ERROR_TYPE.BAD_OUTPUT;
}

/**
 * 记录 LLM 错误（分类型）
 * @param {string} source - 'thalamus' or 'cortex'
 * @param {Error} error
 * @param {Object} context - 额外上下文
 */
async function recordLLMError(source, error, context = {}) {
  const errorType = classifyLLMError(error);

  try {
    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ($1, $2, $3)
    `, [errorType, source, JSON.stringify({
      error_message: error?.message || String(error),
      error_type: errorType,
      ...context,
      timestamp: new Date().toISOString()
    })]);
  } catch (err) {
    console.error(`[${source}] Failed to record LLM error:`, err.message);
  }
}

// ============================================================
// Decision Schema
// ============================================================

/**
 * Decision 结构
 * @typedef {Object} Decision
 * @property {0|1|2} level - 唤醒级别 (0=脑干/反射, 1=快速判断, 2=深度思考)
 * @property {Action[]} actions - 要执行的动作列表
 * @property {string} rationale - 决策原因（给人看）
 * @property {number} confidence - 置信度 0-1
 * @property {boolean} safety - 是否需要人确认
 */

/**
 * Action 结构
 * @typedef {Object} Action
 * @property {string} type - 动作类型（必须在白名单内）
 * @property {Object} params - 动作参数
 */

// ============================================================
// 事件类型定义
// ============================================================

const EVENT_TYPES = {
  // 任务相关
  TASK_COMPLETED: 'task_completed',
  TASK_FAILED: 'task_failed',
  TASK_TIMEOUT: 'task_timeout',
  TASK_CREATED: 'task_created',

  // 用户相关
  USER_MESSAGE: 'user_message',
  USER_COMMAND: 'user_command',

  // 系统相关
  TICK: 'tick',
  HEARTBEAT: 'heartbeat',
  RESOURCE_LOW: 'resource_low',

  // OKR 相关
  OKR_CREATED: 'okr_created',
  OKR_PROGRESS_UPDATE: 'okr_progress_update',
  OKR_BLOCKED: 'okr_blocked',

  // 汇报相关
  DEPARTMENT_REPORT: 'department_report',
  EXCEPTION_REPORT: 'exception_report',
};

// ============================================================
// Action 白名单
// ============================================================

const ACTION_WHITELIST = {
  // 任务操作
  'dispatch_task': { dangerous: false, description: '派发任务' },
  'create_task': { dangerous: false, description: '创建任务' },
  'cancel_task': { dangerous: false, description: '取消任务' },
  'retry_task': { dangerous: false, description: '重试任务' },
  'reprioritize_task': { dangerous: false, description: '调整优先级' },
  'pause_task': { dangerous: false, description: '暂停任务' },
  'resume_task': { dangerous: false, description: '恢复任务' },
  'mark_task_blocked': { dangerous: false, description: '标记任务为阻塞' },
  'quarantine_task': { dangerous: true, description: '隔离任务（移入隔离区）' },

  // OKR 操作
  'create_okr': { dangerous: false, description: '创建 OKR' },
  'update_okr_progress': { dangerous: false, description: '更新 OKR 进度' },
  'assign_to_autumnrice': { dangerous: false, description: '交给秋米拆解' },

  // 通知操作
  'notify_user': { dangerous: false, description: '通知用户' },
  'log_event': { dangerous: false, description: '记录事件' },

  // 升级操作
  'escalate_to_brain': { dangerous: false, description: '升级到 Brain LLM (Opus)' },
  'request_human_review': { dangerous: true, description: '请求人工确认' },

  // 分析操作
  'analyze_failure': { dangerous: false, description: '分析失败原因' },
  'predict_progress': { dangerous: false, description: '预测进度' },

  // 规划操作
  'create_proposal': { dangerous: false, description: '创建计划提案' },

  // 知识/学习操作
  'create_learning': { dangerous: false, description: '保存经验教训到 learnings 表' },
  'update_learning': { dangerous: false, description: '更新已有 learning 记录' },
  'trigger_rca': { dangerous: false, description: '触发根因分析 (RCA) 流程' },

  // 任务生命周期操作
  'update_task_prd': { dangerous: false, description: '更新任务 PRD 内容' },
  'archive_task': { dangerous: false, description: '归档完成/超期任务' },
  'defer_task': { dangerous: false, description: '延迟任务到指定时间' },

  // 系统操作
  'no_action': { dangerous: false, description: '不需要操作' },
  'fallback_to_tick': { dangerous: false, description: '降级到纯代码 Tick' },
};

// ============================================================
// Validator
// ============================================================

/**
 * 验证 Decision 是否合法
 * @param {Decision} decision
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateDecision(decision) {
  const errors = [];

  // 1. 检查必要字段
  if (decision.level === undefined || ![0, 1, 2].includes(decision.level)) {
    errors.push('level 必须是 0, 1, 或 2');
  }

  if (!Array.isArray(decision.actions)) {
    errors.push('actions 必须是数组');
  }

  if (typeof decision.rationale !== 'string' || decision.rationale.length === 0) {
    errors.push('rationale 必须是非空字符串');
  }

  if (typeof decision.confidence !== 'number' || decision.confidence < 0 || decision.confidence > 1) {
    errors.push('confidence 必须是 0-1 之间的数字');
  }

  if (typeof decision.safety !== 'boolean') {
    errors.push('safety 必须是布尔值');
  }

  // 2. 检查 actions 白名单
  if (Array.isArray(decision.actions)) {
    for (const action of decision.actions) {
      if (!action.type) {
        errors.push('action 必须有 type 字段');
        continue;
      }

      if (!ACTION_WHITELIST[action.type]) {
        errors.push(`action type "${action.type}" 不在白名单内`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 检查是否有危险操作
 * @param {Decision} decision
 * @returns {boolean}
 */
function hasDangerousActions(decision) {
  if (!Array.isArray(decision.actions)) return false;

  return decision.actions.some(action => {
    const config = ACTION_WHITELIST[action.type];
    return config?.dangerous === true;
  });
}

// ============================================================
// Token Cost Tracking
// ============================================================

const MODEL_PRICING = {
  'claude-sonnet-4-20250514': { in: 3.0 / 1_000_000, out: 15.0 / 1_000_000 },
  'claude-opus-4-20250514': { in: 15.0 / 1_000_000, out: 75.0 / 1_000_000 },
  'claude-haiku-4-20250514': { in: 0.8 / 1_000_000, out: 4.0 / 1_000_000 },
};

function calculateCost(usage, model) {
  if (!usage) return 0;
  const p = MODEL_PRICING[model];
  if (!p) return 0;
  return (usage.input_tokens || 0) * p.in + (usage.output_tokens || 0) * p.out;
}

async function recordTokenUsage(source, model, usage, context = {}) {
  if (!usage) return;
  const cost = calculateCost(usage, model);
  try {
    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ('token_usage', $1, $2)
    `, [source, JSON.stringify({
      model,
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      cost_usd: cost,
      ...context,
      timestamp: new Date().toISOString()
    })]);
  } catch (err) {
    console.error(`[${source}] Failed to record token usage:`, err.message);
  }
}

/**
 * 记录路由决策事件（fire and forget，不阻塞主路径）
 * @param {string} routeType - 'quick_route' | 'llm_route' | 'cortex_route' | 'fallback_route'
 * @param {Object} event - 原始事件
 * @param {Object} decision - 路由决策结果
 * @param {number} latencyMs - 路由耗时（毫秒）
 */
function recordRoutingDecision(routeType, event, decision, latencyMs) {
  pool.query(`
    INSERT INTO cecelia_events (event_type, source, payload)
    VALUES ('routing_decision', 'thalamus', $1)
  `, [JSON.stringify({
    route_type: routeType,
    event_type: event.type,
    confidence: decision.confidence,
    level: decision.level,
    actions_count: (decision.actions || []).length,
    latency_ms: latencyMs,
    timestamp: new Date().toISOString()
  })]).catch(err => console.error('[thalamus] Failed to record routing decision:', err.message));
}

// ============================================================
// Thalamus (Sonnet 调用)
// ============================================================

const THALAMUS_PROMPT = `你是 Cecelia 的丘脑（Thalamus），负责事件路由和决策。

## 你的职责
1. 接收事件，分析复杂度
2. 决定唤醒级别
3. 输出结构化 Decision

## 唤醒级别
- level 0: 脑干反射（简单、常规、可用代码规则处理）
- level 1: 快速判断（需要一点思考，但不复杂）
- level 2: 深度思考（复杂决策、异常分析、战略规划）

## 可用 Actions（白名单）
${Object.entries(ACTION_WHITELIST).map(([type, config]) => `- ${type}: ${config.description}`).join('\n')}

## 输出格式（严格 JSON）
{
  "level": 0|1|2,
  "actions": [
    {"type": "action_type", "params": {...}}
  ],
  "rationale": "决策原因",
  "confidence": 0.0-1.0,
  "safety": false
}

## 规则
1. 只能使用白名单内的 action
2. 不确定时，升级到 brain (escalate_to_brain)
3. 危险操作必须 safety: true
4. 简单事件尽量 level: 0，不要过度思考

请分析以下事件并输出 Decision：`;

/**
 * 调用 Sonnet 分析事件
 * @param {Object} event - 事件包
 * @returns {Promise<Decision>}
 */
async function analyzeEvent(event) {
  const eventJson = JSON.stringify(event, null, 2);

  // Build #1: 注入历史经验（使用语义检索）
  const learnings = await searchRelevantLearnings({
    task_type: event.task?.task_type,
    failure_class: event.failure_info?.class,
    event_type: event.type
  }, 20);

  let learningBlock = '';
  if (learnings.length > 0) {
    learningBlock = `\n\n## 系统历史经验（参考，按相关性排序）\n${learnings.map((l, i) => `- [${i+1}] **${l.title}** (相关度: ${l.relevance_score || 0}): ${(l.content || '').slice(0, 200)}`).join('\n')}\n`;
  }

  const prompt = `${THALAMUS_PROMPT}${learningBlock}\n\n\`\`\`json\n${eventJson}\n\`\`\``;

  try {
    // 调用 Sonnet (通过 cecelia-bridge 或直接 API)
    const { text: response, usage } = await callSonnet(prompt);

    // Build #4: 记录 token 消耗
    await recordTokenUsage('thalamus', 'claude-sonnet-4-20250514', usage, {
      event_type: event.type,
      learnings_injected: learnings.length,
    });

    // 解析 JSON
    const decision = parseDecisionFromResponse(response);

    // 验证
    const validation = validateDecision(decision);
    if (!validation.valid) {
      console.error('[thalamus] Invalid decision:', validation.errors);
      // 记录 LLM 输出解析失败（BAD_OUTPUT 类型）
      await recordLLMError('thalamus', new Error(validation.errors.join('; ')), {
        event_type: event.type,
        error_subtype: 'validation_failed'
      });
      return createFallbackDecision(event, validation.errors.join('; '));
    }

    return decision;

  } catch (err) {
    console.error('[thalamus] Error analyzing event:', err.message);
    // 分类错误类型并记录
    await recordLLMError('thalamus', err, { event_type: event.type });
    return createFallbackDecision(event, err.message);
  }
}

/**
 * 调用 Sonnet API
 * @param {string} prompt
 * @returns {Promise<{text: string, usage: Object}>}
 */
async function callSonnet(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Sonnet API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return { text: data.content[0].text, usage: data.usage || null };
}

/**
 * 从 Sonnet 响应中解析 Decision
 * @param {string} response
 * @returns {Decision}
 */
function parseDecisionFromResponse(response) {
  // 尝试提取 JSON
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in response');
  }

  return JSON.parse(jsonMatch[0]);
}

/**
 * 创建降级 Decision（Sonnet 失败时使用）
 * @param {Object} event
 * @param {string} reason
 * @returns {Decision}
 */
function createFallbackDecision(event, reason) {
  return {
    level: 0,
    actions: [{ type: 'fallback_to_tick', params: { event_type: event.type } }],
    rationale: `丘脑降级：${reason}`,
    confidence: 0.5,
    safety: false,
    _fallback: true
  };
}

// ============================================================
// 快速路由（不调用 LLM 的简单规则）
// ============================================================

/**
 * 快速路由：对于非常简单的事件，直接用代码规则判断
 * 返回 null 表示需要调用 Sonnet
 * @param {Object} event
 * @returns {Decision|null}
 */
function quickRoute(event) {
  // 心跳：直接忽略
  if (event.type === EVENT_TYPES.HEARTBEAT) {
    return {
      level: 0,
      actions: [{ type: 'no_action', params: {} }],
      rationale: '心跳事件，无需处理',
      confidence: 1.0,
      safety: false
    };
  }

  // 普通 Tick：让代码处理
  if (event.type === EVENT_TYPES.TICK && !event.has_anomaly) {
    return {
      level: 0,
      actions: [{ type: 'fallback_to_tick', params: {} }],
      rationale: '常规 Tick，代码处理',
      confidence: 1.0,
      safety: false
    };
  }

  // 任务完成（无异常）：简单派发下一个
  if (event.type === EVENT_TYPES.TASK_COMPLETED && !event.has_issues) {
    return {
      level: 0,
      actions: [{ type: 'dispatch_task', params: { trigger: 'task_completed' } }],
      rationale: '任务完成，派发下一个',
      confidence: 1.0,
      safety: false
    };
  }

  // 任务失败（简单失败/重试次数未超限）：直接重试
  if (event.type === EVENT_TYPES.TASK_FAILED) {
    const hasComplexReason = event.complex_reason === true;
    const retryExceeded = (event.retry_count || 0) >= 3;
    if (!hasComplexReason && !retryExceeded) {
      return {
        level: 0,
        actions: [{ type: 'retry_task', params: { task_id: event.task_id } }],
        rationale: `任务失败，简单重试 (retry=${event.retry_count || 0})`,
        confidence: 0.9,
        safety: false
      };
    }
    // 无复杂原因 + 重试超限 → 自动隔离（取消任务）
    if (!hasComplexReason && retryExceeded) {
      return {
        level: 0,
        actions: [{ type: 'cancel_task', params: { task_id: event.task_id, reason: 'retry_exceeded' } }],
        rationale: `任务失败次数超限 (retry=${event.retry_count || 0})，自动隔离`,
        confidence: 0.9,
        safety: false
      };
    }
    // 复杂原因（无论是否重试超限）→ 交给 Sonnet
    return null;
  }

  // 任务超时：记录事件 + 降级重试
  if (event.type === EVENT_TYPES.TASK_TIMEOUT) {
    return {
      level: 0,
      actions: [
        { type: 'log_event', params: { reason: 'task_timeout', task_id: event.task_id } },
        { type: 'retry_task', params: { task_id: event.task_id, backoff: true } }
      ],
      rationale: '任务超时，记录后降级重试',
      confidence: 0.85,
      safety: false
    };
  }

  // 任务创建：无需处理（事件驱动下游消费）
  if (event.type === EVENT_TYPES.TASK_CREATED) {
    return {
      level: 0,
      actions: [{ type: 'no_action', params: {} }],
      rationale: '任务创建事件，下游自行消费',
      confidence: 1.0,
      safety: false
    };
  }

  // OKR 创建：只需记录，不需要 LLM 决策
  if (event.type === EVENT_TYPES.OKR_CREATED) {
    return {
      level: 0,
      actions: [{ type: 'log_event', params: { event_type: 'okr_created' } }],
      rationale: 'OKR 创建事件，记录即可',
      confidence: 0.95,
      safety: false
    };
  }

  // OKR 进度更新（非阻塞）：只需记录
  if (event.type === EVENT_TYPES.OKR_PROGRESS_UPDATE && !event.is_blocked) {
    return {
      level: 0,
      actions: [{ type: 'log_event', params: { event_type: 'okr_progress_update' } }],
      rationale: 'OKR 非阻塞进度更新，记录即可',
      confidence: 0.9,
      safety: false
    };
  }

  // OKR 普通阻塞（非关键、非持续）：快速路由，通知用户并标记任务
  if (event.type === EVENT_TYPES.OKR_BLOCKED) {
    const isCritical = event.is_critical === true;
    const isLongBlocked = event.long_blocked === true;
    if (!isCritical && !isLongBlocked) {
      return {
        level: 0,
        actions: [
          { type: 'notify_user', params: { message: 'OKR 阻塞', okr_id: event.okr_id } },
          { type: 'mark_task_blocked', params: { task_id: event.task_id } }
        ],
        rationale: 'OKR 普通阻塞，通知用户并标记任务',
        confidence: 0.85,
        safety: false
      };
    }
    // 关键阻塞或持续阻塞 → 交给 Sonnet
    return null;
  }

  // 部门报告：直接记录并归档，无需 LLM 判断
  if (event.type === EVENT_TYPES.DEPARTMENT_REPORT) {
    return {
      level: 0,
      actions: [{ type: 'log_event', params: { event_type: 'department_report' } }],
      rationale: '部门报告，记录并归档即可',
      confidence: 0.9,
      safety: false
    };
  }

  // 异常报告：根据严重度分支
  if (event.type === EVENT_TYPES.EXCEPTION_REPORT) {
    const severity = event.severity;
    if (severity === 'low' || severity === 'medium') {
      // 低/中等严重度：记录 + 分析失败原因
      return {
        level: 0,
        actions: [
          { type: 'log_event', params: { event_type: 'exception_report', severity } },
          { type: 'analyze_failure', params: { reason: event.reason || 'unknown', severity } }
        ],
        rationale: `异常报告（${severity} 严重度），记录并分析失败原因`,
        confidence: 0.85,
        safety: false
      };
    }
    // 高/严重级别 → 交给 Sonnet/Opus 深度分析
    return null;
  }

  // RESOURCE_LOW：分级处理
  if (event.type === EVENT_TYPES.RESOURCE_LOW) {
    const severity = event.severity || 'low';
    if (severity === 'critical') {
      return null; // 交给 Sonnet 深度处理
    }
    return {
      level: 0,
      actions: [
        { type: 'log_event', params: { event_type: 'resource_low', severity } },
        { type: 'notify_user', params: { message: `资源告警: ${severity}`, channel: 'system' } }
      ],
      rationale: `资源${severity}告警，记录并通知`,
      confidence: 0.85,
      safety: false
    };
  }

  // USER_COMMAND：简单指令快速路由，复杂指令交 Sonnet
  if (event.type === EVENT_TYPES.USER_COMMAND) {
    const cmd = (event.command || '').toLowerCase();
    // 查询类指令：直接 no_action（由 API 层处理）
    if (['status', 'health', 'version'].includes(cmd)) {
      return {
        level: 0,
        actions: [{ type: 'no_action', params: {} }],
        rationale: `用户查询指令 ${cmd}，API 层处理`,
        confidence: 1.0,
        safety: false
      };
    }
    // tick 触发：fallback_to_tick
    if (cmd === 'tick') {
      return {
        level: 0,
        actions: [{ type: 'fallback_to_tick', params: {} }],
        rationale: '用户手动触发 tick',
        confidence: 1.0,
        safety: false
      };
    }
    // 复杂指令 → 交给 Sonnet
    return null;
  }

  // 其他情况需要 Sonnet 判断
  return null;
}

// ============================================================
// 主入口
// ============================================================

/**
 * 丘脑主入口：处理事件，返回 Decision
 *
 * 处理流程：
 * 1. 尝试快速路由 (Level 0，纯代码)
 * 2. 调用 Sonnet 分析 (Level 1)
 * 3. 如果 Level 2，唤醒皮层 (Opus)
 *
 * @param {Object} event
 * @returns {Promise<Decision>}
 */
async function processEvent(event) {
  console.log(`[thalamus] Processing event: ${event.type}`);
  const startMs = Date.now();

  // 1. 尝试快速路由 (Level 0)
  const quickDecision = quickRoute(event);
  if (quickDecision) {
    console.log(`[thalamus] Quick route (L0): ${quickDecision.rationale}`);
    recordRoutingDecision('quick_route', event, quickDecision, Date.now() - startMs);
    return quickDecision;
  }

  // 2. 调用 Sonnet 分析 (Level 1)
  console.log('[thalamus] Calling Sonnet for analysis (L1)...');
  const decision = await analyzeEvent(event);

  console.log(`[thalamus] Sonnet decision: level=${decision.level}, actions=${decision.actions.map(a => a.type).join(',')}`);

  // 降级路径（analyzeEvent 内部失败时返回 _fallback=true）
  if (decision._fallback) {
    recordRoutingDecision('fallback_route', event, decision, Date.now() - startMs);
    return decision;
  }

  // 3. 如果 Level 2，唤醒皮层 (Opus)
  if (decision.level === 2) {
    console.log('[thalamus] Escalating to Cortex (L2)...');
    try {
      // 动态导入皮层模块（避免循环依赖）
      const { analyzeDeep } = await import('./cortex.js');
      const cortexDecision = await analyzeDeep(event, decision);
      console.log(`[thalamus] Cortex decision: actions=${cortexDecision.actions.map(a => a.type).join(',')}, confidence=${cortexDecision.confidence}`);
      recordRoutingDecision('cortex_route', event, cortexDecision, Date.now() - startMs);
      return cortexDecision;
    } catch (err) {
      console.error('[thalamus] Cortex failed, using Sonnet decision:', err.message);
      // 皮层失败时，回退到丘脑决策
      return decision;
    }
  }

  recordRoutingDecision('llm_route', event, decision, Date.now() - startMs);
  return decision;
}

// ============================================================
// Exports
// ============================================================

export {
  // 主入口
  processEvent,

  // 验证
  validateDecision,
  hasDangerousActions,

  // 工具
  quickRoute,
  analyzeEvent,
  createFallbackDecision,
  recordRoutingDecision,

  // LLM 错误分类
  classifyLLMError,
  recordLLMError,
  LLM_ERROR_TYPE,

  // Token 成本
  calculateCost,
  recordTokenUsage,
  MODEL_PRICING,

  // Learnings
  getRecentLearnings,

  // 常量
  EVENT_TYPES,
  ACTION_WHITELIST,
};
