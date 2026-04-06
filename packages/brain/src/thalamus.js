/**
 * Thalamus - 丘脑（事件路由器）
 *
 * 仿人脑设计：
 * - 接收所有事件
 * - 用 MiniMax M2.1 判断复杂度
 * - Level 0/1: 自己处理
 * - Level 2: 唤醒皮层 (Cortex/Opus)
 * - 输出结构化 Decision
 * - 代码验证后执行
 *
 * 三层架构：
 * - 脑干 (Level 0): 纯代码，自动反应
 * - 丘脑 (Level 1): MiniMax M2.1，快速判断
 * - 皮层 (Level 2): Opus，深度思考
 *
 * 核心原则：LLM 只能下"指令"，不能直接改世界
 */

import pool from './db.js';
import { getRecentLearnings, upsertLearning } from './learning.js';
import { buildMemoryContext } from './memory-retriever.js';
import { callLLM } from './llm-caller.js';
import { generateTaskEmbeddingAsync } from './embedding-service.js';
import { buildDomainRouteTable } from './role-registry.js';

// ============================================================
// Self-Awareness Context（自我感知层）
// ============================================================

const SELF_AWARENESS_TTL_MS = 5 * 60 * 1000; // 5 分钟缓存
let _selfAwarenessCache = { context: '', refreshedAt: 0 };

// Skills 能力摘要（静态，来自 AGENTS.md + skills-index）
const SKILLS_SUMMARY = `## Cecelia 能力地图
**任务路由（task_type → 执行位置）**
- dev / review / qa / audit / code_review → 美国 Mac mini（Claude Code）
- codex_dev / codex_qa / crystallize → 西安 M4（Codex）
- explore / talk / research / data → 香港（MiniMax + N8N）

**核心 Skills（63个）**
- 开发类: /dev（统一开发流程）| /review | /audit | /code-review | /architect
- 规划类: /plan | /decomp | /strategy-session | /explore | /research
- 发布类: /douyin-publisher | /kuaishou-publisher | /wechat-publisher | /xiaohongshu-publisher | /weibo-publisher | /zhihu-publisher | /toutiao-publisher
- 工具类: /knowledge | /brain-register | /janitor | /nas | /chrome`;

/**
 * 构建自我感知上下文（带 5 分钟缓存）
 * 包含：当前任务队列状态 + Skills 能力地图
 * @param {Object} dbPool - PostgreSQL pool
 * @returns {Promise<string>} 格式化的感知上下文块
 */
export async function buildSelfAwarenessContext(dbPool) {
  const now = Date.now();
  if (now - _selfAwarenessCache.refreshedAt < SELF_AWARENESS_TTL_MS) {
    return _selfAwarenessCache.context;
  }

  try {
    // 查询任务队列统计
    const queueResult = await dbPool.query(`
      SELECT status, COUNT(*)::int AS count
      FROM tasks
      WHERE status IN ('queued', 'in_progress', 'failed')
      GROUP BY status
    `);

    // 查询最近3个失败任务
    const failedResult = await dbPool.query(`
      SELECT title, updated_at
      FROM tasks
      WHERE status = 'failed'
      ORDER BY updated_at DESC
      LIMIT 3
    `);

    const queueMap = {};
    for (const row of queueResult.rows) {
      queueMap[row.status] = row.count;
    }

    const queueLine = [
      queueMap.queued    ? `排队中: ${queueMap.queued}` : null,
      queueMap.in_progress ? `执行中: ${queueMap.in_progress}` : null,
      queueMap.failed    ? `失败: ${queueMap.failed}` : null,
    ].filter(Boolean).join(' | ') || '队列为空';

    const failedLines = failedResult.rows.length > 0
      ? '\n最近失败任务:\n' + failedResult.rows.map(r => `  - ${r.title}`).join('\n')
      : '';

    const ts = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const context = `\n## 系统自我感知（${ts} 刷新）\n**任务队列**: ${queueLine}${failedLines}\n\n${SKILLS_SUMMARY}\n`;

    _selfAwarenessCache = { context, refreshedAt: now };
    return context;
  } catch (err) {
    console.warn('[thalamus] buildSelfAwarenessContext 失败，使用静态能力地图:', err.message);
    const context = `\n## 系统自我感知（静态）\n${SKILLS_SUMMARY}\n`;
    _selfAwarenessCache = { context, refreshedAt: now };
    return context;
  }
}

/** 仅用于测试：重置缓存 */
export function _resetSelfAwarenessCache() {
  _selfAwarenessCache = { context: '', refreshedAt: 0 };
}

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
 * @param {Object} [opts] - 结构化字段
 * @param {number|null} [opts.http_status] - HTTP 状态码（429/500 等）
 * @param {number|null} [opts.elapsed_ms] - 调用耗时 ms
 * @param {string|null} [opts.model] - 使用的模型 ID
 * @param {string|null} [opts.provider] - 使用的 provider
 * @param {number|null} [opts.fallback_attempt] - fallback 次数（0=无 fallback）
 */
async function recordLLMError(source, error, context = {}, opts = {}) {
  const errorType = classifyLLMError(error);

  try {
    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ($1, $2, $3)
    `, [errorType, source, JSON.stringify({
      error_message: error?.message || String(error),
      error_type: errorType,
      http_status: opts.http_status ?? null,
      elapsed_ms: opts.elapsed_ms ?? null,
      model: opts.model ?? null,
      provider: opts.provider ?? null,
      fallback_attempt: opts.fallback_attempt ?? null,
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
  TASK_RESCHEDULED: 'task_rescheduled',
  TASK_AGGREGATED: 'task_aggregated',
  TASK_MERGED: 'task_merged',
  TASK_SPLIT: 'task_split',

  // 用户相关
  USER_MESSAGE: 'user_message',
  USER_COMMAND: 'user_command',

  // 认知闭环事件
  GOAL_STALLED: 'goal_stalled',
  RUMINATION_RESULT: 'rumination_result',
  DESIRE_ACTION: 'desire_action',
  OWNER_INTENT: 'owner_intent',

  // 系统相关
  TICK: 'tick',
  HEARTBEAT: 'heartbeat',
  RESOURCE_LOW: 'resource_low',
  RESOURCE_CRITICAL: 'resource_critical',
  BACKUP_TRIGGERED: 'backup_triggered',
  CREDENTIALS_ROTATED: 'credentials_rotated',

  // OKR 相关
  OKR_CREATED: 'okr_created',
  OKR_PROGRESS_UPDATE: 'okr_progress_update',
  OKR_BLOCKED: 'okr_blocked',

  // 汇报相关
  DEPARTMENT_REPORT: 'department_report',
  EXCEPTION_REPORT: 'exception_report',

  // 调度相关
  SCHEDULED_TASK: 'scheduled_task',
  BATCH_COMPLETED: 'batch_completed',
  DEPENDENCY_COMPLETED: 'dependency_completed',

  // 学习相关
  LEARNINGS_RECEIVED: 'learnings_received',

  // 建议相关（suggestion-dispatcher → 丘脑统一创建任务）
  SUGGESTION_READY: 'suggestion_ready',
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
  'escalate_to_brain': { dangerous: false, description: '升级到 Brain LLM (Sonnet)' },
  'request_human_review': { dangerous: true, description: '请求人工确认' },

  // 分析操作
  'analyze_failure': { dangerous: false, description: '分析失败原因' },
  'predict_progress': { dangerous: false, description: '预测进度' },

  // 规划操作
  'create_proposal': { dangerous: false, description: '创建计划提案' },

  // OKR 新表飞轮操作（okr_initiatives / okr_scopes / okr_projects）
  'okr_initiative_plan': { dangerous: false, description: '规划 OKR Scope 下的下一个 Initiative' },
  'okr_scope_plan': { dangerous: false, description: '规划 OKR Project 下的下一个 Scope' },
  'okr_project_plan': { dangerous: false, description: '规划 OKR Project 层完成后的下一步' },

  // 知识/学习操作
  'create_learning': { dangerous: false, description: '保存经验教训到 learnings 表' },
  'update_learning': { dangerous: false, description: '更新已有 learning 记录' },
  'trigger_rca': { dangerous: false, description: '触发根因分析 (RCA) 流程' },
  'suggest_task_type': { dangerous: false, description: '建议 task_type 修正（只警告记录，不自动修改）' },

  // 对话操作
  'handle_chat': { dangerous: false, description: '转交 orchestrator-chat 处理普通对话（兜底默认）' },

  // 任务生命周期操作
  'update_task_prd': { dangerous: false, description: '更新任务 PRD 内容' },
  'archive_task': { dangerous: false, description: '归档完成/超期任务' },
  'defer_task': { dangerous: false, description: '延迟任务到指定时间' },

  // 系统操作
  'no_action': { dangerous: false, description: '不需要操作' },
  'fallback_to_tick': { dangerous: false, description: '降级到纯代码 Tick' },

  // 认知闭环操作（v1.142.0）
  'kr_replan': { dangerous: false, description: '触发 KR 重新规划（KR停滞/失败率高时）' },
  'write_self_model': { dangerous: false, description: '将洞察写入 memory_stream（type=self_model）' },
  'escalate_to_cortex': { dangerous: false, description: '升级到 L2 Opus 皮层做深度战略分析' },

  // 提案操作（Inbox 系统，全部 dangerous → 进 pending_actions）
  'propose_decomposition': { dangerous: true, description: 'OKR/Initiative 拆解结果确认' },
  'propose_weekly_plan': { dangerous: true, description: '本周计划确认' },
  'propose_priority_change': { dangerous: true, description: '优先级调整建议' },
  'propose_anomaly_action': { dangerous: true, description: '异常处理方案选择' },
  'propose_milestone_review': { dangerous: true, description: 'Initiative 完成验收' },
  'heartbeat_finding': { dangerous: true, description: '巡检发现异常' },

  // 扩展操作 v1.121.0
  'reschedule_task': { dangerous: false, description: '重新安排任务时间' },
  'aggregate_tasks': { dangerous: false, description: '聚合相似任务' },
  'merge_tasks': { dangerous: false, description: '合并可合并的任务' },
  'split_task': { dangerous: false, description: '拆分大型任务' },
  'notify_oncall': { dangerous: false, description: '通知值班人员' },
  'adjust_resource_allocation': { dangerous: true, description: '调整资源分配' },
  'trigger_backup': { dangerous: false, description: '触发备份' },
  'rotate_credentials': { dangerous: true, description: '凭据轮换' },

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
  'claude-haiku-4-5-20251001': { in: 1.0 / 1_000_000, out: 5.0 / 1_000_000 },
  'MiniMax-M2.5-highspeed': { in: 0.30 / 1_000_000, out: 2.40 / 1_000_000 },
  'MiniMax-M2.1': { in: 0.15 / 1_000_000, out: 1.20 / 1_000_000 },
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
 * 记录 memory_retrieval 可观测性事件（fire and forget）
 * @param {Object} dbPool - pg pool
 * @param {string} query - 搜索查询文本
 * @param {string} mode - 决策模式
 * @param {Object} meta - buildMemoryContext 返回的 meta
 * @param {string} eventType - 触发事件类型
 */
async function recordMemoryRetrieval(dbPool, query, mode, meta, eventType) {
  try {
    await dbPool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ('memory_retrieval', 'thalamus', $1)
    `, [JSON.stringify({
      query: (query || '').substring(0, 200),
      mode,
      candidates_count: meta?.candidates || 0,
      injected_count: meta?.injected || 0,
      injected_sources: meta?.sources || [],
      token_used: meta?.tokenUsed || 0,
      token_budget: meta?.tokenBudget || 800,
      trigger_event_type: eventType,
      timestamp: new Date().toISOString(),
    })]);
  } catch (err) {
    console.warn('[thalamus] Failed to record memory_retrieval event:', err.message);
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
// Thalamus (MiniMax M2.1 调用)
// ============================================================

const THALAMUS_PROMPT = `你是 Cecelia 的丘脑（Thalamus），负责统一事件路由和认知决策。

## 你的职责
1. 接收所有信号（任务事件、用户消息、内部状态变化）
2. 结合记忆上下文（brain_context）做出有记忆的判断
3. 决定唤醒级别，路由到正确的行动

## 唤醒级别
- level 0: 脑干反射（简单、常规、可用代码规则处理）
- level 1: 快速判断（需要一点思考，但不复杂）
- level 2: 深度战略思考（KR停滞、失败率高、方向冲突 → escalate_to_cortex）

## 用户/主人意图路由（USER_MESSAGE、OWNER_INTENT 事件适用）
当 event.type = "user_message" 或 "owner_intent" 时，你只需要判断 **domain（业务领域）**，不要自己决定 task_type。

### 5 个领域（domain）
${buildDomainRouteTable()}

### 路由规则
1. 判断用户意图属于哪个 domain
2. 在 create_task 的 params 中设置 domain 字段
3. task_type 使用该 domain 角色的默认值（coding→dev, planning→initiative_plan, content→content-pipeline, finance→dev, operations→data）
4. 不确定 domain 时默认 coding

### domain 判断关键词
| 关键词信号 | domain |
|-----------|--------|
| 代码/开发/bug/fix/架构/API/重构/测试/CI/安全/Brain/Engine | coding |
| 规划/拆解/OKR/KR/项目/scope/战略/知识/记录 | planning |
| 内容/发布/创作/平台/小红书/抖音/调研/增长 | content |
| 投资/交易/股票/策略/财务 | finance |
| 运维/部署/机器/磁盘/监控/设备 | operations |

## L2 触发条件（需要 escalate_to_cortex）
以下情况应升级到 Opus 皮层深度分析：
- KR 连续停滞 > 14 天（event.type = "goal_stalled" 且 days_stalled > 14）
- 任务失败率 > 60%（近7天）
- 检测到方向冲突（同一 KR 下多个矛盾任务）
- 用户明确要求战略复盘

## 可用 Actions（白名单）
${Object.entries(ACTION_WHITELIST).map(([type, config]) => `- ${type}: ${config.description}`).join('\n')}

## 输出格式（严格 JSON）
{
  "level": 0|1|2,
  "actions": [
    {"type": "action_type", "params": {...}}
  ],
  "rationale": "决策原因（结合 brain_context 说明为何这样路由）",
  "confidence": 0.0-1.0,
  "safety": false,
  "mouth_reply": "立即回复用户的简短文字（1-2句，非正式语气，仅 USER_MESSAGE 时填写，其他事件类型留空字符串）",
  "need_card": false
}
说明：
- mouth_reply：嘴巴立即回应文字。USER_MESSAGE 时必须填写自然的中文回复，其他事件留空。
- need_card：true = 回复内容较长或需要等待异步任务；false = 直接发文字即可。

## 规则
1. 只能使用白名单内的 action
2. 不确定时，升级到 brain (escalate_to_brain)
3. 危险操作必须 safety: true
4. 简单事件尽量 level: 0，不要过度思考
5. USER_MESSAGE/OWNER_INTENT 意图不明确（普通对话、问候、闲聊、问答）时，默认 handle_chat（转交口处理对话）
6. 仅当用户明确表达任务意图（要开发某功能、要调研某话题、要发布内容等）时才 create_task
7. 当用户询问我们系统/项目/产品的当前状态、内容、进展、功能等信息性问题时（如"zenithjoy dashboard 现在有什么"、"最新进展是什么"、"现在有哪些功能"、"某项目状态怎样"等），使用 create_task（task_type: 'explore', priority: 'P2'），mouth_reply 填"正在查，马上给你～"，need_card: false

请结合上方 brain_context 分析以下事件并输出 Decision：`;

/**
 * 从 event payload 提取 Memory 搜索 query
 * @param {Object} event - 事件包
 * @returns {string} 搜索 query
 */
function extractMemoryQuery(event) {
  return (
    event.task?.title ||
    event.payload?.title ||
    event.payload?.description ||
    event.type ||
    ''
  );
}

/**
 * 调用 Memory API 语义搜索，构建注入 prompt 的 block
 * 失败时返回空字符串（graceful fallback）
 * @param {Object} event - 事件包
 * @returns {Promise<string>} 格式化的 Memory block
 */
async function buildMemoryBlock(event) {
  const query = extractMemoryQuery(event);
  if (!query) return '';

  try {
    const response = await fetch('http://localhost:5221/api/brain/memory/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, topK: 3, mode: 'summary' }),
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) return '';

    const data = await response.json();
    const matches = Array.isArray(data.matches) ? data.matches : [];

    if (matches.length === 0) return '';

    const lines = matches.map((m, i) => {
      const preview = (m.preview || m.title || '').slice(0, 150);
      return `- [${i + 1}] **${m.title || '(无标题)'}** (相似度: ${(m.similarity || 0).toFixed(2)}): ${preview}`;
    });

    return `\n\n## 相关历史任务（Memory 语义搜索，供参考）\n${lines.join('\n')}\n`;
  } catch (err) {
    // graceful fallback：Memory 搜索失败不影响主流程
    console.warn('[thalamus] Memory search failed (graceful fallback):', err.message);
    return '';
  }
}

// ============================================================
// 决策上下文感知 - 历史成功率调整
// ============================================================

/**
 * 基于任务历史成功率调整置信度
 * @param {Object} event - 事件
 * @param {Decision} decision - 原始决策
 * @returns {Promise<Decision>} - 调整后的决策
 */
async function adjustConfidenceByHistory(event, decision) {
  // 只有任务相关事件才需要调整
  const taskRelatedEvents = [
    EVENT_TYPES.TASK_COMPLETED,
    EVENT_TYPES.TASK_FAILED,
    EVENT_TYPES.TASK_TIMEOUT,
    EVENT_TYPES.TASK_CREATED,
  ];

  if (!taskRelatedEvents.includes(event.type)) {
    return decision;
  }

  const taskId = event.task_id || event.task?.id;
  if (!taskId) {
    return decision;
  }

  try {
    // 查询任务历史成功率（最近 30 天）
    const result = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
      FROM tasks
      WHERE task_type = $1
        AND created_at > NOW() - INTERVAL '30 days'
    `, [event.task?.task_type || 'dev']);

    const total = parseInt(result.rows[0]?.total || '0', 10);
    if (total < 5) {
      // 样本太少，不调整
      return decision;
    }

    const completed = parseInt(result.rows[0]?.completed || '0', 10);
    const successRate = completed / total;

    // 成功率低于 0.6 时，降低置信度并考虑升级到 L2
    if (successRate < 0.6) {
      const adjustedConfidence = Math.max(0.3, decision.confidence * successRate);
      console.log(`[thalamus] Low success rate (${successRate.toFixed(2)}) for task_type=${event.task?.task_type}, adjusting confidence: ${decision.confidence} -> ${adjustedConfidence}`);

      return {
        ...decision,
        confidence: adjustedConfidence,
        // 如果成功率极低（<0.3），建议升级到 L2
        level: successRate < 0.3 ? 2 : decision.level,
        rationale: `${decision.rationale} [历史成功率: ${(successRate * 100).toFixed(1)}%]`,
        _historyAdjusted: true,
        _successRate: successRate,
      };
    }

    return decision;
  } catch (err) {
    // 查询失败时不影响主流程
    console.warn('[thalamus] Failed to query task history:', err.message);
    return decision;
  }
}

/**
 * 调用 MiniMax M2.1 分析事件
 * @param {Object} event - 事件包
 * @returns {Promise<Decision>}
 */
async function analyzeEvent(event) {
  const eventJson = JSON.stringify(event, null, 2);

  // 统一记忆注入（替代原来的 learningBlock + memoryBlock 双注入）
  const memoryQuery = extractMemoryQuery(event);
  const mode = event.type === EVENT_TYPES.TASK_FAILED ? 'debug' : 'execute';
  const { block: memoryContextBlock, meta: memoryMeta } = await buildMemoryContext({
    query: memoryQuery,
    mode,
    tokenBudget: 800,
    pool,
  });

  const selfAwarenessCtx = await buildSelfAwarenessContext(pool);
  const prompt = `${THALAMUS_PROMPT}${selfAwarenessCtx}${memoryContextBlock}\n\n\`\`\`json\n${eventJson}\n\`\`\``;

  try {
    // 调用统一 LLM 层（丘脑）
    const { text: response, model: thalamusModel } = await callLLM('thalamus', prompt);

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

    // 可观测性：fire-and-forget 记录 memory_retrieval 事件
    recordMemoryRetrieval(pool, memoryQuery, mode, memoryMeta, event.type).catch(() => {});

    // 决策上下文感知：基于历史成功率调整置信度
    const adjustedDecision = await adjustConfidenceByHistory(event, decision);

    return adjustedDecision;

  } catch (err) {
    console.error('[thalamus] Error analyzing event:', err.message);
    // 分类错误类型并记录（携带结构化字段）
    await recordLLMError('thalamus', err, { event_type: event.type }, {
      http_status: err.status ?? null,
      elapsed_ms: err.elapsed_ms ?? null,
      model: err.llm_model ?? null,
      provider: err.llm_provider ?? null,
      fallback_attempt: err.fallback_attempt ?? null,
    });
    return createFallbackDecision(event, err.message);
  }
}

// ============================================================
// Legacy LLM shims（向后兼容，内部转发到统一 callLLM）
// ============================================================

/**
 * @deprecated 使用 callLLM('thalamus', prompt) 代替
 */
async function callThalamLLM(prompt, { timeoutMs = 90000 } = {}) {
  const { text } = await callLLM('thalamus', prompt, { timeout: timeoutMs });
  return { text, usage: null };
}

/**
 * @deprecated 使用 callLLM('thalamus', prompt) 代替
 */
async function callThalamusLLM(prompt) {
  return callLLM('thalamus', prompt);
}

function _resetThalamusMinimaxKey() { /* no-op, kept for test compat */ }

/**
 * 从 MiniMax M2.1 响应中解析 Decision
 * @param {string} response
 * @returns {Decision}
 */
function parseDecisionFromResponse(response) {
  // 优先匹配 markdown code block 中的 JSON（```json ... ``` 或 ``` ... ```）
  const codeBlockMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  let parsed = null;
  if (codeBlockMatch) {
    try {
      parsed = JSON.parse(codeBlockMatch[1].trim());
    } catch (_e) {
      // code block 内容不是合法 JSON，继续 fallback
    }
  }

  if (!parsed) {
    // fallback: 从末尾往前扫描每个 { 位置，贪婪到最后的 }
    // 这样可以正确处理含嵌套 JSON 的响应，同时避免跨越多个独立 JSON 对象
    const lastBrace = response.lastIndexOf('}');
    if (lastBrace === -1) throw new Error('No JSON found in response');
    for (let i = response.length - 1; i >= 0; i--) {
      if (response[i] !== '{') continue;
      const candidate = response.slice(i, lastBrace + 1);
      try {
        const obj = JSON.parse(candidate);
        if (typeof obj === 'object' && obj !== null) { parsed = obj; break; }
      } catch { /* try next position */ }
    }
    if (!parsed) throw new Error('No JSON found in response');
  }

  // 补充新字段默认值（兼容旧模型输出）
  if (!('mouth_reply' in parsed)) parsed.mouth_reply = '';
  if (!('need_card' in parsed)) parsed.need_card = false;

  return parsed;
}

/**
 * 创建降级 Decision（MiniMax M2.1 失败时使用）
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
 * 返回 null 表示需要调用 MiniMax M2.1
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

  // 异常 Tick：分级处理（轻量异常快速路由，复杂异常交 MiniMax M2.1）
  if (event.type === EVENT_TYPES.TICK && event.has_anomaly === true) {
    const anomalyType = event.anomaly_type;

    // 资源压力：记录 + 降级到代码处理（降低派发频率）
    if (anomalyType === 'resource_pressure') {
      return {
        level: 0,
        actions: [
          { type: 'log_event', params: { reason: 'resource_pressure', tick_id: event.tick_id } },
          { type: 'fallback_to_tick', params: {} }
        ],
        rationale: 'Tick 异常分级处理：轻量异常快速路由，复杂异常交 L1 LLM',
        confidence: 0.85,
        safety: false
      };
    }

    // 积压任务：记录 + 重新排优先级
    if (anomalyType === 'stale_tasks') {
      return {
        level: 0,
        actions: [
          { type: 'log_event', params: { reason: 'stale_tasks', tick_id: event.tick_id } },
          { type: 'reprioritize_task', params: {} }
        ],
        rationale: 'Tick 异常分级处理：轻量异常快速路由，复杂异常交 L1 LLM',
        confidence: 0.8,
        safety: false
      };
    }

    // 其他异常类型：交 L1 LLM 深度分析
    return null;
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
    // 复杂原因（无论是否重试超限）→ 交给 L1 LLM
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
    // 关键阻塞或持续阻塞 → 交给 L1 LLM
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

  // LEARNINGS_RECEIVED：路由在 routes.js 中同步执行，丘脑仅记录事件
  if (event.type === EVENT_TYPES.LEARNINGS_RECEIVED) {
    const issueCount = Array.isArray(event.issues_found) ? event.issues_found.length : 0;
    const stepCount = Array.isArray(event.next_steps_suggested) ? event.next_steps_suggested.length : 0;
    return {
      level: 0,
      actions: [{ type: 'log_event', params: {
        event_type: 'learnings_received',
        issues_count: issueCount,
        steps_count: stepCount,
        branch: event.branch_name || null,
      } }],
      rationale: `LEARNINGS 已接收：${issueCount} 个问题 → fix tasks，${stepCount} 条经验 → learnings 表`,
      confidence: 0.95,
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
    // 高/严重级别 → 交给 L1/L2 LLM 深度分析
    return null;
  }

  // RESOURCE_LOW：分级处理
  if (event.type === EVENT_TYPES.RESOURCE_LOW) {
    const severity = event.severity || 'low';
    if (severity === 'critical') {
      return null; // 交给 L1 LLM 深度处理
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

  // USER_COMMAND：简单指令快速路由，复杂指令交 L1 LLM
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
    // 复杂指令 → 交给 L1 LLM
    return null;
  }


  // USER_MESSAGE：按意图分级处理
  if (event.type === EVENT_TYPES.USER_MESSAGE) {
    // 状态查询：直接记录，无需 LLM 决策
    if (event.intent === 'status_query') {
      return {
        level: 0,
        actions: [{ type: 'log_event', params: { event_type: 'user_message', intent: 'status_query' } }],
        rationale: '用户状态查询，记录即可',
        confidence: 0.85,
        safety: false
      };
    }
    // 确认消息：直接记录，无需 LLM 决策
    if (event.intent === 'acknowledge') {
      return {
        level: 0,
        actions: [{ type: 'log_event', params: { event_type: 'user_message', intent: 'acknowledge' } }],
        rationale: '用户确认消息，记录即可',
        confidence: 0.9,
        safety: false
      };
    }
    // 其他意图（命令式、请求式等）→ 交给 L1 LLM 决策（带 brain_context）
    return null;
  }

  // GOAL_STALLED：KR 停滞事件，判断是否需要升级 L2
  if (event.type === EVENT_TYPES.GOAL_STALLED) {
    const daysStalledNum = parseInt(event.days_stalled || '0', 10);
    if (daysStalledNum >= 14) {
      // 长期停滞 → 升级到 L2 Opus 皮层战略分析
      return {
        level: 2,
        actions: [
          { type: 'escalate_to_cortex', params: { goal_id: event.goal_id, reason: 'kr_stalled_14d', days_stalled: daysStalledNum } },
          { type: 'log_event', params: { event_type: 'goal_stalled', goal_id: event.goal_id, days_stalled: daysStalledNum } },
        ],
        rationale: `KR 停滞 ${daysStalledNum} 天，需要 Opus 皮层深度战略分析`,
        confidence: 0.9,
        safety: false
      };
    }
    // 短期停滞（< 14天）→ L1 重新规划
    return {
      level: 1,
      actions: [
        { type: 'kr_replan', params: { goal_id: event.goal_id, days_stalled: daysStalledNum } },
        { type: 'log_event', params: { event_type: 'goal_stalled', goal_id: event.goal_id } },
      ],
      rationale: `KR 停滞 ${daysStalledNum} 天，触发重新规划`,
      confidence: 0.85,
      safety: false
    };
  }

  // DESIRE_ACTION：欲望系统信号，直接创建任务
  if (event.type === EVENT_TYPES.DESIRE_ACTION) {
    const desireTaskType = event.desire_type === 'explore' ? 'research' : 'initiative_plan';
    const priority = event.urgency >= 8 ? 'P0' : event.urgency >= 5 ? 'P1' : 'P2';
    return {
      level: 0,
      actions: [
        {
          type: 'create_task',
          params: {
            title: event.title || `[欲望] ${(event.content || '').slice(0, 80)}`,
            description: event.description || event.content || '',
            task_type: desireTaskType,
            priority,
          }
        },
        { type: 'log_event', params: { event_type: 'desire_action', desire_type: event.desire_type } },
      ],
      rationale: `欲望系统 ${event.desire_type} 信号，创建 ${desireTaskType} 任务`,
      confidence: 0.85,
      safety: false
    };
  }

  // OWNER_INTENT：主人意图信号，交 L1 LLM 根据意图路由（/plan 规则已融合在 THALAMUS_PROMPT）
  // L0 不再硬编码 task_type，由 LLM 按路由表决定

  // RUMINATION_RESULT：反刍结果，丘脑决定写入哪些内容
  if (event.type === EVENT_TYPES.RUMINATION_RESULT) {
    // 有 self_updates → 需要 L1 判断写入哪些 self_model
    if (Array.isArray(event.self_updates) && event.self_updates.length > 0) {
      return null; // 交 L1 LLM 处理
    }
    // 有可执行行动 → L0 直接创建 research 任务
    if (Array.isArray(event.actions) && event.actions.length > 0) {
      return {
        level: 0,
        actions: [
          ...event.actions.map(actionTitle => ({
            type: 'create_task',
            params: {
              title: actionTitle,
              description: `反刍洞察自动创建：${(event.learnings || []).map(l => l.title).join(', ').slice(0, 400)}`,
              task_type: 'research',
              priority: 'P2',
              trigger_source: 'rumination',
            }
          })),
          { type: 'log_event', params: { event_type: 'rumination_result', has_actions: true } },
        ],
        rationale: `反刍有 ${event.actions.length} 个可执行行动，创建 research 任务`,
        confidence: 0.85,
        safety: false
      };
    }
    // 仅有 learnings 无 actions → L0 记录即可
    return {
      level: 0,
      actions: [{ type: 'log_event', params: { event_type: 'rumination_result', has_actions: false } }],
      rationale: '反刍结果无可执行行动，记录即可',
      confidence: 0.8,
      safety: false
    };
  }

  // 扩展快速路由场景 v1.121.0

  // 任务重新安排：简单调度
  if (event.type === EVENT_TYPES.TASK_RESCHEDULED) {
    return {
      level: 0,
      actions: [
        { type: 'log_event', params: { event_type: 'task_rescheduled', task_id: event.task_id } },
        { type: 'dispatch_task', params: { trigger: 'task_rescheduled' } }
      ],
      rationale: '任务已重新安排，触发派发',
      confidence: 0.9,
      safety: false
    };
  }

  // 任务聚合：批量派发
  if (event.type === EVENT_TYPES.TASK_AGGREGATED) {
    return {
      level: 0,
      actions: [
        { type: 'log_event', params: { event_type: 'task_aggregated', count: event.task_count } },
        { type: 'dispatch_task', params: { trigger: 'task_aggregated', batch: true } }
      ],
      rationale: '任务已聚合，批量派发',
      confidence: 0.85,
      safety: false
    };
  }

  // 任务合并：派发合并后任务
  if (event.type === EVENT_TYPES.TASK_MERGED) {
    return {
      level: 0,
      actions: [
        { type: 'log_event', params: { event_type: 'task_merged', original_ids: event.original_task_ids } },
        { type: 'dispatch_task', params: { trigger: 'task_merged' } }
      ],
      rationale: '任务已合并，派发新任务',
      confidence: 0.9,
      safety: false
    };
  }

  // 任务拆分：派发子任务
  if (event.type === EVENT_TYPES.TASK_SPLIT) {
    return {
      level: 0,
      actions: [
        { type: 'log_event', params: { event_type: 'task_split', parent_id: event.task_id } },
        { type: 'dispatch_task', params: { trigger: 'task_split', sub_tasks: true } }
      ],
      rationale: '任务已拆分，派发子任务',
      confidence: 0.85,
      safety: false
    };
  }

  // 资源告警严重：快速降级派发
  if (event.type === EVENT_TYPES.RESOURCE_CRITICAL) {
    return {
      level: 0,
      actions: [
        { type: 'log_event', params: { event_type: 'resource_critical', resource: event.resource } },
        { type: 'notify_oncall', params: { severity: 'critical', resource: event.resource } },
        { type: 'fallback_to_tick', params: { mode: 'low_resource' } }
      ],
      rationale: '资源严重告警，通知值班并降级',
      confidence: 0.8,
      safety: false
    };
  }

  // 备份触发：记录并确认
  if (event.type === EVENT_TYPES.BACKUP_TRIGGERED) {
    return {
      level: 0,
      actions: [
        { type: 'log_event', params: { event_type: 'backup_triggered', backup_type: event.backup_type } }
      ],
      rationale: '备份已触发，记录即可',
      confidence: 0.95,
      safety: false
    };
  }

  // 凭据轮换：记录
  if (event.type === EVENT_TYPES.CREDENTIALS_ROTATED) {
    return {
      level: 0,
      actions: [
        { type: 'log_event', params: { event_type: 'credentials_rotated', provider: event.provider } }
      ],
      rationale: '凭据已轮换，记录即可',
      confidence: 0.95,
      safety: false
    };
  }

  // 周期性任务：直接派发
  if (event.type === EVENT_TYPES.SCHEDULED_TASK) {
    return {
      level: 0,
      actions: [
        { type: 'dispatch_task', params: { trigger: 'scheduled', task_id: event.task_id } }
      ],
      rationale: '周期性任务触发，直接派发',
      confidence: 0.9,
      safety: false
    };
  }

  // 批量任务完成：批量派发下一个
  if (event.type === EVENT_TYPES.BATCH_COMPLETED) {
    return {
      level: 0,
      actions: [
        { type: 'log_event', params: { event_type: 'batch_completed', count: event.completed_count } },
        { type: 'dispatch_task', params: { trigger: 'batch_completed', count: event.completed_count } }
      ],
      rationale: '批量任务完成，批量派发下一个',
      confidence: 0.85,
      safety: false
    };
  }

  // 依赖任务完成：检查并派发下游
  if (event.type === EVENT_TYPES.DEPENDENCY_COMPLETED) {
    return {
      level: 0,
      actions: [
        { type: 'log_event', params: { event_type: 'dependency_completed', dependency_id: event.dependency_id } },
        { type: 'dispatch_task', params: { trigger: 'dependency_met', dependent_id: event.dependent_id } }
      ],
      rationale: '依赖满足，触发下游任务',
      confidence: 0.9,
      safety: false
    };
  }

  // Suggestion 就绪：由丘脑统一创建 suggestion_plan 任务，断开直接 INSERT 路径
  if (event.type === EVENT_TYPES.SUGGESTION_READY) {
    const contentPreview = typeof event.content === 'string'
      ? event.content.substring(0, 200)
      : JSON.stringify(event.content).substring(0, 200);
    const fullContent = typeof event.content === 'string'
      ? event.content
      : JSON.stringify(event.content, null, 2);
    return {
      level: 0,
      actions: [
        {
          type: 'create_task',
          params: {
            title: `[SUGGESTION_PLAN] 层级识别：${contentPreview}`,
            description: `[SUGGESTION_MODE]\n\nSuggestion ID: ${event.suggestion_id}\nScore: ${event.priority_score}\nSource: ${event.source || 'unknown'}\n\n内容：\n${fullContent}\n\n请识别此 Suggestion 的层级（Layer 3 KR / Layer 4 Project / Layer 5 Scope / Layer 6 Initiative / Layer 7 Task/Pipeline），\n找到最合适的挂载点，并调用对应的 Brain API 创建结构。`,
            task_type: 'suggestion_plan',
            priority: 'P2',
            trigger_source: 'suggestion_dispatcher',
            payload: {
              suggestion_id: String(event.suggestion_id),
              suggestion_score: event.priority_score,
              source: event.source || null,
              agent_id: event.agent_id || null,
            },
            domain: event.domain || null,
            owner_role: event.owner_role || null,
          }
        },
        { type: 'log_event', params: { event_type: 'suggestion_ready', suggestion_id: event.suggestion_id } },
      ],
      rationale: `Suggestion ${event.suggestion_id} 分数=${event.priority_score}，创建 suggestion_plan 任务`,
      confidence: 0.9,
      safety: false
    };
  }

  // 其他情况需要 L1 LLM 判断
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
 * 2. 调用 MiniMax M2.1 分析 (Level 1)
 * 3. 如果 Level 2，唤醒皮层 (Sonnet)
 *
 * @param {Object} event
 * @returns {Promise<Decision>}
 */
async function processEvent(event) {
  // BUG P1 guard: null/undefined event 直接返回 fallback decision
  if (event == null) {
    console.warn('[thalamus] processEvent called with null/undefined event, returning fallback');
    return createFallbackDecision({ type: 'unknown' }, 'null event received');
  }

  console.log(`[thalamus] Processing event: ${event.type}`);
  const startMs = Date.now();

  // 1. 尝试快速路由 (Level 0)
  const quickDecision = quickRoute(event);
  if (quickDecision) {
    console.log(`[thalamus] Quick route (L0): ${quickDecision.rationale}`);
    recordRoutingDecision('quick_route', event, quickDecision, Date.now() - startMs);
    return quickDecision;
  }

  // 2. 调用 MiniMax M2.1 分析 (Level 1)
  console.log('[thalamus] Calling MiniMax M2.1 for analysis (L1)...');
  const decision = await analyzeEvent(event);

  console.log(`[thalamus] L1 decision: level=${decision.level}, actions=${decision.actions.map(a => a.type).join(',')}`);

  // 降级路径（analyzeEvent 内部失败时返回 _fallback=true）
  if (decision._fallback) {
    recordRoutingDecision('fallback_route', event, decision, Date.now() - startMs);
    return decision;
  }

  // 3. 如果 Level 2，唤醒皮层 (Sonnet)
  if (decision.level === 2) {
    console.log('[thalamus] Escalating to Cortex (L2)...');
    try {
      // 动态导入皮层模块（避免循环依赖）
      const { analyzeDeep } = await import('./cortex.js');
      const cortexDecision = await analyzeDeep(event, decision);
      console.log(`[thalamus] Cortex decision: actions=${(cortexDecision.actions || []).map(a => a.type).join(',')}, confidence=${cortexDecision.confidence}`);

      // L2 结论 → self_model 沉淀（闭环线 4）
      if (cortexDecision.analysis || cortexDecision.rationale) {
        const selfModelContent = typeof cortexDecision.analysis === 'object'
          ? `[L2 战略洞察] ${cortexDecision.analysis.root_cause || ''} | ${(cortexDecision.analysis.contributing_factors || []).join(', ')}`
          : `[L2 战略洞察] ${String(cortexDecision.rationale || '').slice(0, 500)}`;
        pool.query(
          `INSERT INTO memory_stream (content, importance, memory_type, source_type, expires_at)
           VALUES ($1, 9, 'long', 'self_model', NOW() + INTERVAL '90 days')`,
          [selfModelContent.slice(0, 2000)]
        ).catch(err => console.warn('[thalamus] L2 self_model write failed (non-blocking):', err.message));
      }

      recordRoutingDecision('cortex_route', event, cortexDecision, Date.now() - startMs);
      return cortexDecision;
    } catch (err) {
      console.error('[thalamus] Cortex failed, using L1 decision:', err.message);
      // 皮层失败时，回退到丘脑决策
      return decision;
    }
  }

  recordRoutingDecision('llm_route', event, decision, Date.now() - startMs);
  return decision;
}

// ============================================================
// observeChat — 嘴巴发来的行动信号处理入口
// ============================================================

/**
 * 处理嘴巴在对话中检测到的行动信号
 * 嘴巴是唯一调用者，丘脑是唯一写入者
 *
 * @param {Object} signal - { type, title?, description?, priority?, content?, category?, task_id?, task_title?, key?, value? }
 * @param {Object} context - { user_message?, reply? } 对话上下文（用于日志）
 */
async function observeChat(signal, context = {}) {
  if (!signal || !signal.type) return;

  const type = signal.type;
  console.log(`[thalamus] observeChat: ${type}`, JSON.stringify(signal).slice(0, 120));

  try {
    switch (type) {
      case 'create_task': {
        const title = signal.title || '对话中提到的任务';
        const description = signal.description || context.user_message || '';
        const res = await pool.query(`
          INSERT INTO tasks (title, description, priority, task_type, status, trigger_source)
          VALUES ($1, $2, $3, $4, 'queued', 'chat_mouth')
          RETURNING id
        `, [
          title,
          description,
          signal.priority || 'P2',
          signal.task_type || 'research',
        ]);
        const taskId = res.rows[0]?.id;
        console.log(`[thalamus] observeChat: task created — "${title}" (${taskId})`);
        if (taskId) generateTaskEmbeddingAsync(taskId, title, description);
        break;
      }

      case 'cancel_task': {
        // 支持 task_id 或 task_title 取消
        if (signal.task_id) {
          const r = await pool.query(
            `UPDATE tasks SET status = 'cancelled' WHERE id = $1 AND status = 'queued' RETURNING id`,
            [signal.task_id]
          );
          if (r.rowCount === 0) {
            console.warn(`[thalamus] observeChat: cancel_task — task ${signal.task_id} not found or not queued`);
          }
        } else if (signal.task_title) {
          await pool.query(
            `UPDATE tasks SET status = 'cancelled' WHERE title ILIKE $1 AND status = 'queued'`,
            [`%${signal.task_title}%`]
          );
        }
        break;
      }

      case 'save_note': {
        try {
          await upsertLearning({
            title: signal.title || '对话笔记',
            category: signal.category || 'chat',
            content: signal.content || '',
            triggerEvent: 'chat_mouth',
          });
        } catch (e) {
          console.warn('[thalamus] upsertLearning failed (non-fatal):', e.message);
        }
        console.log(`[thalamus] observeChat: note saved — "${signal.title}"`);
        break;
      }

      case 'update_user_profile': {
        if (signal.key && signal.value) {
          await pool.query(`
            UPDATE user_profiles
            SET raw_facts = raw_facts || $1::jsonb, updated_at = NOW()
            WHERE user_id = 'owner'
          `, [JSON.stringify({ [signal.key]: signal.value })]);
        }
        break;
      }

      case 'save_memory': {
        const content = signal.content || '';
        const importance = Math.min(10, Math.max(1, Number(signal.importance) || 5));
        const reason = signal.reason || '';
        const fullContent = reason ? `${content}\n（原因：${reason}）` : content;
        let expiresExpr;
        if (importance >= 8) {
          expiresExpr = 'NULL';
        } else if (importance >= 5) {
          expiresExpr = "NOW() + INTERVAL '90 days'";
        } else {
          expiresExpr = "NOW() + INTERVAL '30 days'";
        }
        await pool.query(
          `INSERT INTO memory_stream (content, importance, memory_type, source_type, expires_at)
           VALUES ($1, $2, 'long', 'self_initiated', ${expiresExpr})`,
          [fullContent, importance]
        );
        console.log(`[thalamus] observeChat: save_memory — importance=${importance} "${content.slice(0, 60)}"`);
        break;
      }

      default:
        console.warn(`[thalamus] observeChat: unknown signal type: ${type}`);
    }
  } catch (err) {
    console.warn(`[thalamus] observeChat: failed (${type}):`, err.message);
  }
}

// ============================================================
// Exports
// ============================================================

// routeEvent 别名（goal-evaluator 等外部模块使用）
const routeEvent = processEvent;

export {
  // 主入口
  processEvent,
  routeEvent,

  // 嘴巴→丘脑信号入口
  observeChat,

  // 验证
  validateDecision,
  hasDangerousActions,

  // 工具
  quickRoute,
  analyzeEvent,
  createFallbackDecision,
  recordRoutingDecision,
  parseDecisionFromResponse,

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

  // Memory 注入（统一检索器）
  extractMemoryQuery,
  buildMemoryBlock,  // 保留向后兼容（Memory API 可能引用）
  recordMemoryRetrieval,

  // 丘脑 LLM（legacy shims → callLLM）
  callThalamusLLM,
  callThalamLLM,
  _resetThalamusMinimaxKey,

  // 常量
  EVENT_TYPES,
  ACTION_WHITELIST,
};
