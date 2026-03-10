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

import crypto from 'crypto';
import pool from './db.js';
import { ACTION_WHITELIST, validateDecision, recordLLMError, recordTokenUsage } from './thalamus.js';
import { callLLM } from './llm-caller.js';
import { searchRelevantLearnings } from './learning.js';
import { getSelfModel } from './self-model.js';
import { generateL0Summary } from './memory-utils.js';
import {
  evaluateQualityInitial,
  generateSimilarityHash,
  checkShouldCreateRCA,
} from './cortex-quality.js';
import { validatePolicyJson } from './policy-validator.js';
import { recordFailure } from './circuit-breaker.js';

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

## Absorption Policy Generation (免疫系统吸收策略)

当你识别到可自动处理的重复失败模式时，可以生成 absorption_policy。

**Policy JSON Schema**:
{
  "action": "requeue" | "skip" | "adjust_params" | "kill",
  "params": { ... },
  "expected_outcome": "策略预期效果描述",
  "confidence": 0.0-1.0,
  "reasoning": "为什么这个策略能解决问题（20-500字符）"
}

**Action Params**:
- requeue: { delay_minutes: number (required), priority?: "high"|"normal"|"low" }
- skip: { reason?: string }
- adjust_params: { adjustments: object (required), merge_strategy?: string }
- kill: { reason: string (required), notify?: boolean }

**何时生成 Policy**:
1. 识别到可预测的重复失败模式
2. 有明确的自动化补救措施
3. 置信度 ≥ 0.5

**Policy 不是必需的**：仅在合适时生成。

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
  "absorption_policy": {  // OPTIONAL: 仅在合适时生成
    "action": "requeue|skip|adjust_params|kill",
    "params": {...},
    "expected_outcome": "...",
    "confidence": 0.0-1.0,
    "reasoning": "..."
  },
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
  'create_task': { dangerous: false, description: '创建 Brain 任务（皮层建议）' },
};

// ============================================================
// 反思熔断（Reflection Circuit Breaker）
// ============================================================

const REFLECTION_WINDOW_MS = 30 * 60 * 1000; // 30 分钟窗口
const REFLECTION_BREAK_THRESHOLD = 2;          // 连续 2 次相似即熔断（降低阈值阻断反思死循环）

/** 内存缓存：eventHash → { count, firstSeen, lastSeen } */
const _reflectionState = new Map();
let _reflectionStateLoaded = false;

/**
 * 从 working_memory 加载已持久化的熔断状态（启动时调用一次）
 * 自动清理过期条目（超过 30 分钟窗口）
 */
async function _loadReflectionStateFromDB() {
  if (_reflectionStateLoaded) return;
  _reflectionStateLoaded = true;
  try {
    const result = await pool.query(
      `SELECT key, value_json FROM working_memory WHERE key LIKE 'cortex_reflection:%'`
    );
    const now = Date.now();
    const expiredKeys = [];
    let loaded = 0;
    for (const row of result.rows) {
      const hash = row.key.replace('cortex_reflection:', '');
      const val = row.value_json;
      if (val && typeof val.count === 'number') {
        // 使用 lastSeen 作为滑动窗口起点：超过 30min 未活跃则过期
        // 向下兼容旧 DB 条目（无 lastSeen 字段时 fallback 到 firstSeen）
        const lastActivity = val.lastSeen ?? val.firstSeen;
        if (now - lastActivity > REFLECTION_WINDOW_MS) {
          expiredKeys.push(row.key);
        } else {
          _reflectionState.set(hash, {
            count: val.count,
            firstSeen: val.firstSeen,
            lastSeen: val.lastSeen,
          });
          loaded++;
        }
      }
    }
    if (loaded > 0) {
      console.log(`[cortex] 从 DB 恢复 ${loaded} 条反思去重状态`);
    }
    if (expiredKeys.length > 0) {
      pool.query(
        'DELETE FROM working_memory WHERE key = ANY($1)',
        [expiredKeys]
      ).catch(err => {
        console.error('[cortex] Failed to clean expired reflection entries:', err.message);
      });
    }
  } catch (err) {
    console.error('[cortex] Failed to load reflection state from DB:', err.message);
  }
}

/**
 * 持久化单条熔断状态到 working_memory（async/await，确保写入完成再继续）
 * @param {string} hash
 * @param {Object} state
 */
async function _persistReflectionEntry(hash, state) {
  try {
    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
      [`cortex_reflection:${hash}`, JSON.stringify(state)]
    );
  } catch (err) {
    console.error('[cortex] Failed to persist reflection state:', err.message);
  }
}

/**
 * 计算事件内容哈希（type + failure_class + task_type）
 * @param {Object} event
 * @returns {string} 16字符 hex
 */
function _computeEventHash(event) {
  const key = JSON.stringify({
    type: event.type,
    failure_class: event.failure_history?.[0]?.failure_classification?.class ?? null,
    task_type: event.failed_task?.task_type ?? event.task?.task_type ?? null,
  });
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * 计算观测项去重 key（type + failure_class + task_type）
 * @param {{ type: string, failure_class?: string|null, task_type?: string|null }} params
 * @returns {string} 16字符 hex
 */
function _computeObservationKey({ type, failure_class = null, task_type = null }) {
  const key = JSON.stringify({ type, failure_class, task_type });
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * 对观测列表按 keyFn 去重折叠。相同 key ≥2 条时追加摘要行。
 * @param {Array} items
 * @param {(item: any) => string} keyFn
 * @returns {Array}
 */
function _deduplicateObservations(items, keyFn) {
  const seen = new Map();
  for (const item of items) {
    const k = keyFn(item);
    if (seen.has(k)) {
      seen.get(k).count++;
    } else {
      seen.set(k, { first: item, count: 1 });
    }
  }
  const result = [];
  for (const { first, count } of seen.values()) {
    result.push(first);
    if (count >= 2) {
      result.push({ _folded: true, count, message: `${count} 条相同诊断，已折叠` });
    }
  }
  return result;
}

/**
 * 检查并更新反思熔断器（持久化到 PostgreSQL）
 * @param {string} hash
 * @returns {Promise<{ open: boolean, count: number }>}
 */
async function _checkReflectionBreaker(hash) {
  await _loadReflectionStateFromDB();

  const now = Date.now();
  const state = _reflectionState.get(hash);

  // 使用 lastSeen 作为滑动窗口判断：超过 30min 未活跃则重置熔断器
  // 向下兼容旧内存条目（无 lastSeen 时 fallback 到 firstSeen）
  const lastActivity = state?.lastSeen ?? state?.firstSeen ?? 0;
  if (!state || now - lastActivity > REFLECTION_WINDOW_MS) {
    const newState = { count: 1, firstSeen: now, lastSeen: now };
    _reflectionState.set(hash, newState);
    await _persistReflectionEntry(hash, newState);
    return { open: false, count: 1 };
  }

  state.count += 1;
  state.lastSeen = now;
  await _persistReflectionEntry(hash, state);
  return { open: state.count >= REFLECTION_BREAK_THRESHOLD, count: state.count };
}

// ============================================================
// 输出去重熔断（Output Dedup Circuit Breaker）
// ============================================================

const OUTPUT_DEDUP_THRESHOLD = 2; // 相同输出 ≥2 次即熔断（比输入级更严格）

/** 内存缓存：outputHash → { count, firstSeen, lastSeen } */
const _outputDedupState = new Map();
let _outputDedupStateLoaded = false;

async function _loadOutputDedupStateFromDB() {
  if (_outputDedupStateLoaded) return;
  _outputDedupStateLoaded = true;
  try {
    const result = await pool.query(
      `SELECT key, value_json FROM working_memory WHERE key LIKE 'cortex_output_dedup:%'`
    );
    const now = Date.now();
    const expiredKeys = [];
    let loaded = 0;
    for (const row of result.rows) {
      const hash = row.key.replace('cortex_output_dedup:', '');
      const val = row.value_json;
      if (val && typeof val.count === 'number') {
        if (now - val.firstSeen > REFLECTION_WINDOW_MS) {
          expiredKeys.push(row.key);
        } else {
          _outputDedupState.set(hash, {
            count: val.count,
            firstSeen: val.firstSeen,
            lastSeen: val.lastSeen,
          });
          loaded++;
        }
      }
    }
    if (loaded > 0) {
      console.log(`[cortex] 从 DB 恢复 ${loaded} 条输出去重状态`);
    }
    if (expiredKeys.length > 0) {
      pool.query(
        'DELETE FROM working_memory WHERE key = ANY($1)',
        [expiredKeys]
      ).catch(err => {
        console.error('[cortex] Failed to clean expired output dedup entries:', err.message);
      });
    }
  } catch (err) {
    console.error('[cortex] Failed to load output dedup state from DB:', err.message);
  }
}

function _persistOutputDedupEntry(hash, state) {
  pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [`cortex_output_dedup:${hash}`, JSON.stringify(state)]
  ).catch(err => {
    console.error('[cortex] Failed to persist output dedup state:', err.message);
  });
}

function _computeOutputHash(decision) {
  const rootCause = decision?.analysis?.root_cause || '';
  const normalized = rootCause.toLowerCase().trim();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

async function _checkOutputDedup(hash) {
  await _loadOutputDedupStateFromDB();

  const now = Date.now();
  const state = _outputDedupState.get(hash);

  if (!state || now - state.firstSeen > REFLECTION_WINDOW_MS) {
    const newState = { count: 1, firstSeen: now, lastSeen: now };
    _outputDedupState.set(hash, newState);
    _persistOutputDedupEntry(hash, newState);
    return { duplicate: false, count: 1 };
  }

  state.count += 1;
  state.lastSeen = now;
  _persistOutputDedupEntry(hash, state);
  return { duplicate: state.count >= OUTPUT_DEDUP_THRESHOLD, count: state.count };
}

// ============================================================
// Cortex LLM 调用（通过统一 callLLM 层）
// ============================================================

/**
 * 调用皮层 LLM 进行深度分析（通过统一 callLLM 层）
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function callCortexLLM(prompt) {
  const cortexTimeout = parseInt(process.env.CECELIA_BRIDGE_TIMEOUT_MS || '120000', 10);
  const { text } = await callLLM('cortex', prompt, { timeout: cortexTimeout, maxTokens: 4096 });
  return text;
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
  // 反思熔断：相同事件模式连续触发超过阈值时，跳过 LLM 调用
  const _eventHash = _computeEventHash(event);
  const _breaker = await _checkReflectionBreaker(_eventHash);
  if (_breaker.open) {
    console.log(`[cortex] 反思熔断：事件 ${event.type} 相似输入已触发 ${_breaker.count} 次，跳过本次分析 (hash=${_eventHash})`);
    return createCortexFallback(event, `反思熔断：相同模式已分析 ${_breaker.count} 次，停止重复告警`);
  }

  console.log(`[cortex] Deep analysis triggered for event: ${event.type} (hash=${_eventHash}, count=${_breaker.count})`);

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
      LIMIT 5
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
  }, 5);

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

  // Build #3: 注入 self-model（Cecelia 对自己的认知，让皮层决策有自我意识）
  try {
    context.self_model = await getSelfModel();
  } catch (err) {
    console.error('[cortex] Failed to fetch self-model:', err.message);
  }

  // Inject adjustable parameters for RCA requests
  if (event.type === 'rca_request' && thalamusDecision?.adjustable_params) {
    context.adjustable_params = thalamusDecision.adjustable_params;
  }

  const contextJson = JSON.stringify(context, null, 2);
  const prompt = `${CORTEX_PROMPT}\n\n\`\`\`json\n${contextJson}\n\`\`\``;

  try {
    const response = await callCortexLLM(prompt);
    const decision = parseCortexDecision(response);

    // 验证
    const validation = validateCortexDecision(decision);
    if (!validation.valid) {
      console.error('[cortex] Invalid decision:', validation.errors);
      return createCortexFallback(event, validation.errors.join('; '));
    }

    // 输出去重熔断：检查 LLM 输出的 root_cause 是否与近期诊断重复
    const _outputHash = _computeOutputHash(decision);
    const _outputDedup = await _checkOutputDedup(_outputHash);
    if (_outputDedup.duplicate) {
      console.log(`[cortex] 输出去重熔断：root_cause 相同诊断已出现 ${_outputDedup.count} 次，停止回声 (hash=${_outputHash})`);
      return createCortexFallback(event, `输出去重熔断：相同诊断已输出 ${_outputDedup.count} 次，皮层回声已阻断`);
    }

    // 记录到决策日志
    await logCortexDecision(event, decision);

    // 记录 learnings
    if (decision.learnings && decision.learnings.length > 0) {
      await recordLearnings(decision.learnings, event);
    }

    // P2: Store absorption policy if generated
    if (decision.absorption_policy) {
      const signature = event.signature || event.failed_task?.error_signature || 'cortex-generated';
      const policyId = await storeAbsorptionPolicy(decision.absorption_policy, {
        event_type: event.type,
        task_id: event.failed_task?.id || event.task?.id,
        signature
      });

      if (policyId) {
        decision.absorption_policy_id = policyId;
      }
    }

    return decision;

  } catch (err) {
    console.error('[cortex] Deep analysis failed:', err.message);
    await recordLLMError('cortex', err, { event_type: event.type });
    // 超时事件计入熔断器（防止无效重试）
    if (err.degraded === true || /timed out/i.test(err.message)) {
      await recordFailure('cortex-llm').catch(() => {});
      // 写入任务 error_message（如果事件关联了具体任务）
      if (event.task_id) {
        try {
          await pool.query(
            `UPDATE tasks SET error_message = $1, updated_at = NOW() WHERE id = $2`,
            [`Cortex timeout: ${err.message}`, event.task_id]
          );
        } catch { /* 非关键路径，忽略错误 */ }
      }
    }
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
 * 记录学习经验到 learnings 表（供 rumination 消化）
 */
async function recordLearnings(learnings, event) {
  let recorded = 0;
  for (const learning of learnings) {
    try {
      const title = `Cortex Insight: ${String(learning).slice(0, 100)}`;
      const content = String(learning);
      const triggerEvent = event.type || 'cortex_analysis';
      const hashInput = `${title}\n${content}`;
      const contentHash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

      // 去重：相同 hash 已存在则跳过
      const existing = await pool.query(
        'SELECT id FROM learnings WHERE content_hash = $1 AND is_latest = true LIMIT 1',
        [contentHash]
      );
      if (existing.rows.length > 0) {
        continue;
      }

      const summary = generateL0Summary(`${title} ${content}`);
      await pool.query(`
        INSERT INTO learnings (title, category, trigger_event, content, strategy_adjustments, metadata, content_hash, version, is_latest, summary)
        VALUES ($1, 'cortex_insight', $2, $3, '[]', $4, $5, 1, true, $6)
      `, [
        title,
        triggerEvent,
        content,
        JSON.stringify({ source: 'cortex', event_type: event.type, recorded_at: new Date().toISOString() }),
        contentHash,
        summary,
      ]);
      recorded++;
    } catch (err) {
      console.error('[cortex] Failed to record learning:', err.message);
    }
  }
  console.log(`[cortex] Recorded ${recorded}/${learnings.length} learnings to learnings table`);
}

/**
 * Validate and store absorption policy generated by Cortex (P2)
 * @param {Object} policyJson - Policy JSON from Cortex decision
 * @param {Object} context - Context information (event_type, task_id, signature)
 * @returns {Promise<number|null>} Policy ID if successful, null otherwise
 */
async function storeAbsorptionPolicy(policyJson, context = {}) {
  try {
    const validation = validatePolicyJson(policyJson, { strict: true });

    if (!validation.valid) {
      await pool.query(`
        INSERT INTO cecelia_events (event_type, source, payload)
        VALUES ('policy_validation_failed', 'cortex', $1)
      `, [JSON.stringify({
        policy: policyJson,
        validation_errors: validation.errors,
        context,
        timestamp: new Date().toISOString()
      })]);

      console.error('[cortex] Policy validation failed:', validation.errors);
      return null;
    }

    const signature = context.signature || 'cortex-generated';

    const result = await pool.query(`
      INSERT INTO absorption_policies (
        signature, status, policy_type, policy_json, risk_level, created_by, created_at
      ) VALUES ($1, 'draft', 'auto', $2, 'low', 'cortex', NOW())
      RETURNING policy_id
    `, [signature, validation.normalized]);

    const policyId = result.rows[0].policy_id;
    console.log(`[cortex] Created absorption policy: ${policyId} (status=draft)`);

    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ('policy_created', 'cortex', $1)
    `, [JSON.stringify({
      policy_id: policyId,
      signature,
      action: validation.normalized.action,
      confidence: validation.normalized.confidence,
      context,
      timestamp: new Date().toISOString()
    })]);

    return policyId;
  } catch (err) {
    console.error('[cortex] Failed to store absorption policy:', err.message);
    await pool.query(`
      INSERT INTO cecelia_events (event_type, source, payload)
      VALUES ('policy_storage_error', 'cortex', $1)
    `, [JSON.stringify({
      error: err.message,
      policy: policyJson,
      context,
      timestamp: new Date().toISOString()
    })]).catch(() => {});
    return null;
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

  // Generate similarity hash
  const similarityHash = generateSimilarityHash({
    task_type: task?.task_type || failureInfo?.task_type,
    reason: failureInfo?.class || 'UNKNOWN',
    root_cause: analysis.analysis || '',
  });

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
      metadata,
      similarity_hash
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
    JSON.stringify({ created_by: 'performRCA', ...context.metadata }),
    similarityHash
  ]);

  const analysisId = result.rows[0].id;

  // Fire-and-forget quality evaluation
  evaluateQualityInitial(analysisId).catch(err => {
    console.error('[Cortex] Quality evaluation failed:', err.message);
  });

  return analysisId;
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
    LIMIT 20
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

  // Check for duplicate RCA
  const failureClass = history[0]?.failure_classification?.class || 'UNKNOWN';
  const checkResult = await checkShouldCreateRCA({
    task_type: failedTask.task_type,
    reason: failureClass,
    root_cause: '',
  });

  if (!checkResult.should_create) {
    console.log(`[Cortex] Duplicate RCA detected (similarity: ${checkResult.similarity}%), reusing existing analysis`);

    // Fetch existing analysis
    const existingAnalysis = await pool.query(
      'SELECT * FROM cortex_analyses WHERE id = $1',
      [checkResult.duplicate_of]
    );

    if (existingAnalysis.rows.length > 0) {
      const existing = existingAnalysis.rows[0];

      // Parse JSONB fields
      let contributing_factors = existing.contributing_factors;
      if (typeof contributing_factors === 'string') {
        try {
          contributing_factors = JSON.parse(contributing_factors);
        } catch (e) {
          contributing_factors = [];
        }
      }

      let strategy_adjustments = existing.strategy_adjustments;
      if (typeof strategy_adjustments === 'string') {
        try {
          strategy_adjustments = JSON.parse(strategy_adjustments);
        } catch (e) {
          strategy_adjustments = [];
        }
      }

      return {
        task_id: failedTask.id,
        analysis: existing.root_cause,
        recommended_actions: [],
        learnings: [],
        strategy_adjustments,
        contributing_factors,
        confidence: existing.confidence_score,
        reused_from: checkResult.duplicate_of
      };
    }
  }

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
// System Report Generation (48h 定时简报)
// ============================================================

const SYSTEM_REPORT_PROMPT = `你是 Cecelia 的皮层（Cortex），现在需要生成一份系统简报。

请基于提供的系统数据，生成一份全面的简报，格式如下（严格 JSON）：

{
  "title": "简报标题（包含时间范围）",
  "summary": "2-3 句话的摘要，高亮最重要的发现",
  "kr_progress": {
    "overview": "KR 整体状态描述",
    "highlights": ["亮点1", "亮点2"],
    "concerns": ["关注点1", "关注点2"]
  },
  "task_stats": {
    "analysis": "任务执行质量分析",
    "bottlenecks": ["瓶颈1", "瓶颈2"]
  },
  "system_health": {
    "status": "healthy|degraded|critical",
    "assessment": "系统健康评估"
  },
  "risks": ["风险1", "风险2"],
  "recommendations": ["建议1", "建议2"],
  "confidence": 0.0
}

请深度分析以下系统数据：`;

/**
 * 生成系统简报（48h 定时触发）
 * @param {Object} options - 配置项
 * @param {number} [options.timeRangeHours=48] - 时间范围（小时）
 * @returns {Promise<Object>} - 简报 ID 和内容
 */
async function generateSystemReport({ timeRangeHours = 48 } = {}) {
  console.log(`[cortex] generateSystemReport: 开始生成 ${timeRangeHours}h 系统简报`);

  const context = {
    time_range_hours: timeRangeHours,
    generated_at: new Date().toISOString(),
  };

  // 1. 收集 KR 进度数据
  try {
    const krResult = await pool.query(`
      SELECT
        g.id,
        g.title,
        g.status,
        g.progress,
        g.updated_at,
        COUNT(t.id) FILTER (WHERE t.status = 'completed' AND t.updated_at > NOW() - ($1 || ' hours')::INTERVAL) as completed_tasks,
        COUNT(t.id) FILTER (WHERE t.status = 'failed' AND t.updated_at > NOW() - ($1 || ' hours')::INTERVAL) as failed_tasks,
        COUNT(t.id) FILTER (WHERE t.status = 'queued') as queued_tasks
      FROM goals g
      LEFT JOIN tasks t ON t.goal_id = g.id
      GROUP BY g.id, g.title, g.status, g.progress, g.updated_at
      ORDER BY g.updated_at DESC
      LIMIT 20
    `, [String(timeRangeHours)]);
    context.kr_progress = krResult.rows;
  } catch (err) {
    console.error('[cortex] generateSystemReport: 获取 KR 进度失败:', err.message);
    context.kr_progress = [];
  }

  // 2. 收集任务统计
  try {
    const taskResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed' AND updated_at > NOW() - ($1 || ' hours')::INTERVAL) as completed,
        COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > NOW() - ($1 || ' hours')::INTERVAL) as failed,
        COUNT(*) FILTER (WHERE status = 'queued') as queued,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE status = 'quarantined') as quarantined,
        ROUND(
          COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > NOW() - ($1 || ' hours')::INTERVAL)::numeric /
          NULLIF(COUNT(*) FILTER (WHERE status IN ('completed', 'failed') AND updated_at > NOW() - ($1 || ' hours')::INTERVAL), 0) * 100,
          1
        ) as failure_rate_pct
      FROM tasks
    `, [String(timeRangeHours)]);
    context.task_stats = taskResult.rows[0];
  } catch (err) {
    console.error('[cortex] generateSystemReport: 获取任务统计失败:', err.message);
    context.task_stats = {};
  }

  // 3. 系统健康状态（Tick 循环 + 资源）
  try {
    const tickResult = await pool.query(`
      SELECT key, value_json FROM working_memory
      WHERE key IN ('tick_enabled', 'tick_last', 'startup_errors')
    `);
    const tickMemory = {};
    for (const row of tickResult.rows) {
      tickMemory[row.key] = row.value_json;
    }
    context.system_health = {
      tick_enabled: tickMemory.tick_enabled?.enabled ?? false,
      last_tick: tickMemory.tick_last?.timestamp || null,
      startup_errors: tickMemory.startup_errors?.total_failures || 0,
    };
  } catch (err) {
    console.error('[cortex] generateSystemReport: 获取系统健康状态失败:', err.message);
    context.system_health = {};
  }

  // 4. 最近失败任务分析
  try {
    const failedResult = await pool.query(`
      SELECT title, task_type, error_message, updated_at
      FROM tasks
      WHERE status = 'failed'
        AND updated_at > NOW() - ($1 || ' hours')::INTERVAL
      ORDER BY updated_at DESC
      LIMIT 10
    `, [String(timeRangeHours)]);
    context.recent_failures = _deduplicateObservations(
      failedResult.rows,
      (row) => _computeObservationKey({ type: 'task_failure', failure_class: null, task_type: row.task_type ?? null })
    );
  } catch (err) {
    console.error('[cortex] generateSystemReport: 获取失败任务失败:', err.message);
    context.recent_failures = [];
  }

  // 5. 最近 Cortex 分析（摘要）
  try {
    const analysesResult = await pool.query(`
      SELECT root_cause, confidence_score, created_at, failure_pattern
      FROM cortex_analyses
      WHERE created_at > NOW() - ($1 || ' hours')::INTERVAL
      ORDER BY created_at DESC
      LIMIT 5
    `, [String(timeRangeHours)]);
    context.recent_analyses = _deduplicateObservations(
      analysesResult.rows,
      (row) => _computeObservationKey({
        type: 'rca',
        failure_class: row.failure_pattern?.class ?? null,
        task_type: row.failure_pattern?.task_type ?? null,
      })
    );
  } catch (err) {
    console.warn('[cortex] generateSystemReport: 获取 cortex 分析失败（非致命）:', err.message);
    context.recent_analyses = [];
  }

  // 调用 LLM 生成简报
  const contextJson = JSON.stringify(context, null, 2);
  const prompt = `${SYSTEM_REPORT_PROMPT}\n\n\`\`\`json\n${contextJson}\n\`\`\``;

  let reportData;
  try {
    const response = await callCortexLLM(prompt);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('LLM response missing JSON');
    }
    reportData = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('[cortex] generateSystemReport: LLM 调用失败:', err.message);
    // 降级：生成基础简报
    reportData = {
      title: `系统简报 ${new Date().toLocaleDateString('zh-CN')} (${timeRangeHours}h)`,
      summary: `过去 ${timeRangeHours} 小时系统简报生成失败，请人工检查。`,
      kr_progress: { overview: '数据获取失败', highlights: [], concerns: [] },
      task_stats: {
        analysis: `完成: ${context.task_stats?.completed || 0}, 失败: ${context.task_stats?.failed || 0}`,
        bottlenecks: []
      },
      system_health: { status: 'unknown', assessment: 'LLM 调用失败，无法评估' },
      risks: ['简报生成失败，系统状态未知'],
      recommendations: ['手动检查系统状态'],
      confidence: 0.1,
    };
  }

  // 保存到 system_reports 表（使用 type, content, metadata 表结构）
  let reportId;
  try {
    const metadata = {
      trigger: 'cortex_api',
      generated_at: context.generated_at,
      time_range_hours: timeRangeHours,
    };
    const saveResult = await pool.query(`
      INSERT INTO system_reports (type, content, metadata)
      VALUES ($1, $2::jsonb, $3::jsonb)
      RETURNING id
    `, [
      '48h_summary',
      JSON.stringify(reportData),
      JSON.stringify(metadata),
    ]);
    reportId = saveResult.rows[0].id;
    console.log(`[cortex] generateSystemReport: 简报已保存 id=${reportId}`);
  } catch (err) {
    console.error('[cortex] generateSystemReport: 保存简报失败:', err.message);
    reportId = null;
  }

  return {
    id: reportId,
    ...reportData,
    time_range_hours: timeRangeHours,
    generated_at: context.generated_at,
  };
}

// ============================================================
// Exports
// ============================================================

/**
 * 重置反思去重状态（仅供测试使用）
 */
function _resetReflectionState() {
  _reflectionState.clear();
  _reflectionStateLoaded = false;
}

/**
 * 重置输出去重状态（仅供测试使用）
 */
function _resetOutputDedupState() {
  _outputDedupState.clear();
  _outputDedupStateLoaded = false;
}

export {
  // 主入口
  analyzeDeep,
  performRCA,

  // 48h 系统简报
  generateSystemReport,

  // Memory
  saveCortexAnalysis,
  searchRelevantAnalyses,

  // API (profile-aware)
  callCortexLLM,

  // 验证
  validateCortexDecision,
  createCortexFallback,

  // P2: Absorption Policy
  storeAbsorptionPolicy,

  // 报告级语义去重（测试用）
  _computeObservationKey,
  _deduplicateObservations,

  // 反思去重（测试用）
  _resetReflectionState,
  _checkReflectionBreaker,
  _computeEventHash,

  // 输出去重（测试用）
  _checkOutputDedup,
  _computeOutputHash,
  _resetOutputDedupState,

  // 常量
  CORTEX_ACTION_WHITELIST,
  OUTPUT_DEDUP_THRESHOLD,
};
