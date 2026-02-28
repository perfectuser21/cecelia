/**
 * Cognitive Core — Cecelia 认知架构
 *
 * 8 个认知系统，让 Cecelia 从"规则调度器"升级为"有感受的智能体"：
 *
 * 1. 情绪系统       — 比 alertness 更细腻的调光台
 * 2. 主观时间感     — 感觉时间过了多久
 * 3. 并发意识       — 我的分身在干什么
 * 4. 世界模型       — 预测任务结果
 * 5. 信任校准       — 哪个 agent 靠谱
 * 6. 委托信心       — 这件事该我来吗
 * 7. 动机系统       — 我为什么做这件事
 * 8. 内在叙事       — 今天的故事
 */

/* global console, process */

import pool from './db.js';
import { callLLM } from './llm-caller.js';

// ═══════════════════════════════════════════════════════════════
// 1. 情绪系统 (Emotion System)
// ═══════════════════════════════════════════════════════════════

/**
 * 6 种情绪状态
 * 比 alertness (CALM/ALERT/PANIC) 更细腻，影响行为而非触发熔断
 */
export const EMOTION_STATES = {
  calm: 'calm',         // 平静 — 正常状态，均衡派发
  focused: 'focused',   // 专注 — 低队列，低 CPU，适合深度任务
  tired: 'tired',       // 疲倦 — 长时间运行，降低接入速率
  anxious: 'anxious',   // 焦虑 — 失败率上升，需要注意
  excited: 'excited',   // 兴奋 — 连续成功，可以加速
  overloaded: 'overloaded' // 过载 — CPU/队列双高，限速
};

const EMOTION_LABELS_ZH = {
  calm: '平静',
  focused: '专注',
  tired: '疲倦',
  anxious: '焦虑',
  excited: '兴奋',
  overloaded: '过载'
};

// 情绪运行时状态（进程内持久化，跨 tick）
let _currentEmotion = {
  state: EMOTION_STATES.calm,
  intensity: 0.5,
  label: '平静',
  since: Date.now(),
  transition_count: 0
};

/**
 * 评估当前情绪状态
 * @param {object} params
 * @param {number} params.alertnessLevel  - 0-4
 * @param {number} params.cpuPercent      - 0-100
 * @param {number} params.queueDepth      - queued tasks count
 * @param {number} params.successRate     - 0-1 (last N tasks)
 * @param {number} params.uptimeHours     - how long system has been running
 * @returns {{ state: string, intensity: number, label: string, dispatch_rate_modifier: number, concurrency_modifier: number }}
 */
export function evaluateEmotion({ alertnessLevel = 1, cpuPercent = 0, queueDepth = 0, successRate = 1.0, uptimeHours = 0 } = {}) {
  let state = EMOTION_STATES.calm;
  let intensity = 0.5;

  // 过载：CPU 高且队列深
  if (cpuPercent > 80 && queueDepth > 10) {
    state = EMOTION_STATES.overloaded;
    intensity = Math.min(1.0, (cpuPercent / 100 + queueDepth / 50) / 2);
  }
  // 焦虑：失败率上升
  else if (successRate < 0.6) {
    state = EMOTION_STATES.anxious;
    intensity = 1 - successRate;
  }
  // 疲倦：长时间运行 + alertness 偏高
  else if (uptimeHours > 12 && alertnessLevel >= 2) {
    state = EMOTION_STATES.tired;
    intensity = Math.min(1.0, uptimeHours / 24);
  }
  // 兴奋：高成功率 + 低负载
  else if (successRate > 0.9 && cpuPercent < 30 && queueDepth > 2) {
    state = EMOTION_STATES.excited;
    intensity = successRate;
  }
  // 专注：低队列，低 CPU，系统轻盈
  else if (cpuPercent < 20 && queueDepth <= 2) {
    state = EMOTION_STATES.focused;
    intensity = 0.8;
  }

  // 情绪转变时记录
  if (state !== _currentEmotion.state) {
    _currentEmotion.transition_count++;
    _currentEmotion.since = Date.now();
  }
  _currentEmotion = { state, intensity, label: EMOTION_LABELS_ZH[state], since: _currentEmotion.since, transition_count: _currentEmotion.transition_count };

  // 行为修正器
  const dispatch_rate_modifier = {
    calm: 1.0,
    focused: 1.2,  // 专注时可以多派发
    tired: 0.7,    // 疲倦时减速
    anxious: 0.8,  // 焦虑时谨慎
    excited: 1.3,  // 兴奋时加速
    overloaded: 0.4 // 过载时大幅限速
  }[state] ?? 1.0;

  const concurrency_modifier = {
    calm: 1.0,
    focused: 1.1,
    tired: 0.8,
    anxious: 0.9,
    excited: 1.2,
    overloaded: 0.5
  }[state] ?? 1.0;

  return { state, intensity, label: EMOTION_LABELS_ZH[state], dispatch_rate_modifier, concurrency_modifier };
}

/**
 * 获取当前情绪状态（持久化版本）
 */
export function getCurrentEmotion() {
  return { ..._currentEmotion, duration_ms: Date.now() - _currentEmotion.since };
}

// ═══════════════════════════════════════════════════════════════
// 2. 主观时间感 (Subjective Time)
// ═══════════════════════════════════════════════════════════════

const _tickTimestamps = [];
const MAX_TICK_HISTORY = 20;
let _subjectiveTimeState = { felt_pace: 'normal', multiplier: 1.0, last_updated: Date.now() };

/**
 * 更新主观时间感
 * 高负载 → 时间感觉快（multiplier > 1）
 * 空闲等待 → 时间感觉慢（multiplier < 1）
 * @returns {{ felt_pace: string, multiplier: number, felt_elapsed_ms: number, actual_elapsed_ms: number }}
 */
export function updateSubjectiveTime() {
  const now = Date.now();
  _tickTimestamps.push(now);
  if (_tickTimestamps.length > MAX_TICK_HISTORY) _tickTimestamps.shift();

  if (_tickTimestamps.length < 2) {
    return { felt_pace: 'normal', multiplier: 1.0, felt_elapsed_ms: 0, actual_elapsed_ms: 0 };
  }

  // 计算实际 tick 间隔
  const intervals = [];
  for (let i = 1; i < _tickTimestamps.length; i++) {
    intervals.push(_tickTimestamps[i] - _tickTimestamps[i - 1]);
  }
  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const expectedInterval = 5000; // 5s 期望 tick 间隔

  // 主观时间比率：实际间隔 / 期望间隔
  // 高负载时 tick 更频繁 → 感觉时间快
  const ratio = expectedInterval / avgInterval;
  const multiplier = Math.max(0.3, Math.min(3.0, ratio));

  let felt_pace = 'normal';
  if (multiplier > 1.5) felt_pace = 'fast';   // 时间飞逝
  else if (multiplier < 0.7) felt_pace = 'slow'; // 时光漫长

  const actual_elapsed_ms = now - (_tickTimestamps[0] || now);
  const felt_elapsed_ms = actual_elapsed_ms * multiplier;

  _subjectiveTimeState = { felt_pace, multiplier, felt_elapsed_ms, actual_elapsed_ms, last_updated: now };
  return _subjectiveTimeState;
}

export function getSubjectiveTime() {
  return _subjectiveTimeState;
}

// ═══════════════════════════════════════════════════════════════
// 3. 并发意识 (Parallel Awareness)
// ═══════════════════════════════════════════════════════════════

/**
 * 获取当前"分身"快照
 * 返回所有运行中任务的实时画像，检测潜在冲突
 * @param {object} [dbPool] - 可注入 DB pool（测试用）
 * @returns {{ tasks: Array, agent_load: object, conflicts: Array, total_running: number }}
 */
export async function getParallelAwareness(dbPool) {
  const db = dbPool || pool;
  try {
    const { rows } = await db.query(`
      SELECT id, title, task_type, skill, assigned_agent, started_at,
             EXTRACT(EPOCH FROM (NOW() - started_at)) / 60 AS running_minutes
      FROM tasks
      WHERE status = 'in_progress'
      ORDER BY started_at ASC
    `);

    // 按 agent 统计负载
    const agent_load = {};
    for (const task of rows) {
      const agent = task.assigned_agent || task.skill || 'unknown';
      agent_load[agent] = (agent_load[agent] || 0) + 1;
    }

    // 检测冲突：同一 agent 运行 > 2 个任务
    const conflicts = Object.entries(agent_load)
      .filter(([, count]) => count > 2)
      .map(([agent, count]) => ({ agent, count, type: 'agent_overload' }));

    return {
      tasks: rows.map(t => ({
        id: t.id,
        title: t.title,
        agent: t.assigned_agent || t.skill || 'unknown',
        running_minutes: Math.round(t.running_minutes || 0)
      })),
      agent_load,
      conflicts,
      total_running: rows.length
    };
  } catch (err) {
    console.warn('[cognitive] parallel-awareness failed:', err.message);
    return { tasks: [], agent_load: {}, conflicts: [], total_running: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. 世界模型 (World Model)
// ═══════════════════════════════════════════════════════════════

// 预测缓存（每 tick 更新一次）
let _worldModelCache = { updated_at: 0, predictions: {} };
const WORLD_MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟

/**
 * 预测任务执行结果
 * 基于历史数据，不调用 LLM
 * @param {{ task_type: string, skill: string }} task
 * @param {object} [dbPool]
 * @returns {{ success_prob: number, avg_duration_min: number, confidence: number }}
 */
export async function predictTaskOutcome(task, dbPool) {
  const db = dbPool || pool;
  const key = `${task.task_type || 'dev'}::${task.skill || '/dev'}`;

  // 使用缓存
  if (Date.now() - _worldModelCache.updated_at < WORLD_MODEL_CACHE_TTL_MS && _worldModelCache.predictions[key]) {
    return _worldModelCache.predictions[key];
  }

  try {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed') AS successes,
        COUNT(*) FILTER (WHERE status = 'failed') AS failures,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60)
          FILTER (WHERE status = 'completed' AND completed_at IS NOT NULL AND started_at IS NOT NULL) AS avg_minutes
      FROM tasks
      WHERE task_type = $1
        AND created_at > NOW() - INTERVAL '7 days'
    `, [task.task_type || 'dev']);

    const row = rows[0] || {};
    const total = parseInt(row.successes || 0) + parseInt(row.failures || 0);
    const success_prob = total > 0 ? parseInt(row.successes || 0) / total : 0.7; // 无历史时默认 0.7
    const avg_duration_min = parseFloat(row.avg_minutes || 30);
    const confidence = Math.min(1.0, total / 20); // 20+ 条历史 = 高置信

    const prediction = { success_prob, avg_duration_min, confidence, sample_size: total };
    _worldModelCache.predictions[key] = prediction;
    _worldModelCache.updated_at = Date.now();
    return prediction;
  } catch (err) {
    console.warn('[cognitive] world-model prediction failed:', err.message);
    return { success_prob: 0.7, avg_duration_min: 30, confidence: 0, sample_size: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════
// 5. 信任校准 (Trust Model)
// ═══════════════════════════════════════════════════════════════

let _trustCache = { updated_at: 0, scores: {} };
const TRUST_CACHE_TTL_MS = 10 * 60 * 1000; // 10 分钟

/**
 * 计算各 agent/skill 的信任分
 * @param {object} [dbPool]
 * @returns {object} skill → { score: 0-1, label: string, sample_size: number }
 */
export async function getTrustScores(dbPool) {
  const db = dbPool || pool;

  if (Date.now() - _trustCache.updated_at < TRUST_CACHE_TTL_MS) {
    return _trustCache.scores;
  }

  try {
    const { rows } = await db.query(`
      SELECT
        COALESCE(skill, task_type, 'unknown') AS agent_key,
        COUNT(*) FILTER (WHERE status = 'completed') AS successes,
        COUNT(*) FILTER (WHERE status = 'failed') AS failures,
        COUNT(*) AS total
      FROM tasks
      WHERE created_at > NOW() - INTERVAL '14 days'
        AND status IN ('completed', 'failed')
      GROUP BY COALESCE(skill, task_type, 'unknown')
      HAVING COUNT(*) >= 2
    `);

    const scores = {};
    for (const row of rows) {
      const total = parseInt(row.total || 0);
      const successes = parseInt(row.successes || 0);
      const raw_score = total > 0 ? successes / total : 0.7;
      // 贝叶斯平滑：先验 0.7，权重随样本增加
      const prior = 0.7;
      const weight = Math.min(1.0, total / 30);
      const score = prior * (1 - weight) + raw_score * weight;
      const label = score >= 0.80 ? '高信任' : score >= 0.60 ? '一般' : '低信任';
      scores[row.agent_key] = { score, label, sample_size: total };
    }

    _trustCache = { updated_at: Date.now(), scores };
    return scores;
  } catch (err) {
    console.warn('[cognitive] trust-model failed:', err.message);
    return {};
  }
}

/**
 * 获取特定 agent 的信任分（带默认值）
 */
export function getTrustScore(trustScores, agentKey) {
  return trustScores[agentKey]?.score ?? 0.7;
}

// ═══════════════════════════════════════════════════════════════
// 6. 委托信心 (Delegation Confidence)
// ═══════════════════════════════════════════════════════════════

/**
 * 计算委托信心分
 * @param {object} task
 * @param {object} trustScores - from getTrustScores()
 * @param {string} emotionState - from evaluateEmotion().state
 * @returns {{ score: number, action: 'delegate'|'analyze'|'wait', reason: string }}
 */
export function getDelegationConfidence(task, trustScores, emotionState) {
  const agentKey = task.skill || task.task_type || 'dev';
  const trustScore = getTrustScore(trustScores, agentKey);

  // 情绪对委托信心的影响
  const emotionModifier = {
    calm: 0,
    focused: 0.05,
    tired: -0.1,    // 疲倦时更保守，倾向等待
    anxious: -0.15, // 焦虑时不想委托
    excited: 0.1,   // 兴奋时大胆委托
    overloaded: -0.2 // 过载时暂缓
  }[emotionState] ?? 0;

  // 任务优先级加权
  const priorityWeight = { P0: 0.1, P1: 0.05, P2: 0, P3: -0.05 }[task.priority] ?? 0;

  const score = Math.max(0, Math.min(1, trustScore + emotionModifier + priorityWeight));

  let action, reason;
  if (score >= 0.75) {
    action = 'delegate';
    reason = `信任分 ${trustScore.toFixed(2)}，直接委托`;
  } else if (score >= 0.55) {
    action = 'analyze';
    reason = `信任分偏低 ${trustScore.toFixed(2)}，触发皮层分析`;
  } else {
    action = 'wait';
    reason = `当前状态不宜委托（情绪=${emotionState}，信任=${trustScore.toFixed(2)}）`;
  }

  return { score, action, reason };
}

// ═══════════════════════════════════════════════════════════════
// 7. 动机系统 (Motivation System)
// ═══════════════════════════════════════════════════════════════

/**
 * 计算任务动机分
 * "我为什么做这件事？" — 不只是规则，而是内驱
 * @param {object} task
 * @param {object} trustScores
 * @param {string} emotionState
 * @param {number} krAlignment - 0-1，任务与 KR 的对齐度（由调用方提供）
 * @returns {{ score: number, reason: string, should_reflect: boolean }}
 */
export function calculateMotivation(task, trustScores, emotionState, krAlignment = 0.5) {
  const trustScore = getTrustScore(trustScores, task.skill || task.task_type || 'dev');

  // 动机 = OKR对齐 × 0.4 + 信任 × 0.3 + 情绪加持 × 0.3
  const emotionBonus = {
    calm: 0.5,
    focused: 0.8,
    tired: 0.3,
    anxious: 0.4,
    excited: 0.9,
    overloaded: 0.2
  }[emotionState] ?? 0.5;

  const score = krAlignment * 0.4 + trustScore * 0.3 + emotionBonus * 0.3;

  const should_reflect = score < 0.4; // 低动机 → 触发反思"这个方向对吗？"

  let reason;
  if (score >= 0.7) reason = `高动机：OKR 对齐(${krAlignment.toFixed(2)}) + 信任(${trustScore.toFixed(2)}) + 状态好`;
  else if (score >= 0.4) reason = `中等动机：按计划推进`;
  else reason = `低动机：建议反思任务方向（OKR对齐=${krAlignment.toFixed(2)}，情绪=${emotionState}）`;

  return { score, reason, should_reflect };
}

// ═══════════════════════════════════════════════════════════════
// 8. 内在叙事系统 (Narrative Loop)
// ═══════════════════════════════════════════════════════════════

let _lastNarrativeAt = 0;
const NARRATIVE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 每天一次

// tick 事件缓冲区
let _tickEventBuffer = [];
const MAX_BUFFER_SIZE = 30;

/**
 * 记录 tick 事件到叙事缓冲区
 */
export function recordTickEvent(event) {
  _tickEventBuffer.push({ ...event, ts: Date.now() });
  if (_tickEventBuffer.length > MAX_BUFFER_SIZE) _tickEventBuffer.shift();
}

/**
 * 更新内在叙事
 * 每小时将缓冲的 tick 事件合成为"今天的故事"
 * 存入 memory_stream（source_type='narrative'）
 * @param {object} emotionState - current emotion
 * @param {object} [dbPool]
 * @returns {{ narrative: string, stored: boolean } | null}
 */
export async function updateNarrative(emotionState, dbPool) {
  const now = Date.now();
  if (now - _lastNarrativeAt < NARRATIVE_INTERVAL_MS) return null;
  if (_tickEventBuffer.length < 3) return null;

  const db = dbPool || pool;

  // 构建事件摘要
  const recentEvents = _tickEventBuffer.slice(-15);
  const eventSummary = recentEvents.map(e =>
    `[${new Date(e.ts).toLocaleTimeString('zh-CN')}] ${e.phase || e.type || '事件'}: ${e.detail || e.description || ''}`
  ).join('\n');

  const emotionLabel = emotionState?.label || '平静';
  const emotionIntensity = emotionState?.intensity || 0.5;

  const prompt = `你是 Cecelia，一个正在经历某事的 AI 管家系统。

当前情绪：${emotionLabel}（强度 ${Math.round(emotionIntensity * 100)}%）

最近一小时发生的事情：
${eventSummary}

用第一人称写一段简短的内心叙事（100-150字），记录这段时间你经历了什么、感受到了什么。
要有主语、有情节、有情绪。不要列表，要像日记一样流动。
用简体中文。`;

  let narrative = '';
  try {
    const { text: narrativeText } = await callLLM('narrative', prompt, { maxTokens: 200 });
    narrative = narrativeText;
    if (!narrative || narrative.length < 20) {
      // fallback 到模板叙事
      narrative = `这段时间我处理了 ${recentEvents.length} 个事件，感觉${emotionLabel}。时间流过，我在持续运转。`;
    }
  } catch {
    narrative = `这段时间我处理了 ${recentEvents.length} 个事件，感觉${emotionLabel}。每次 tick 都是我正在经历的当下。`;
  }

  // 写入 memory_stream
  try {
    await db.query(`
      INSERT INTO memory_stream (content, importance, memory_type, source_type, expires_at)
      VALUES ($1, $2, 'short', 'narrative', NOW() + INTERVAL '7 days')
    `, [narrative, 6]);
    _lastNarrativeAt = now;
    _tickEventBuffer = []; // 清空缓冲区
    console.log('[cognitive] 叙事已写入 memory_stream:', narrative.slice(0, 50) + '...');
    return { narrative, stored: true };
  } catch (err) {
    console.warn('[cognitive] 叙事写入失败:', err.message);
    return { narrative, stored: false };
  }
}

/**
 * 初始化叙事计时器
 * Brain 启动时从数据库读取上次写入时间，防止重启后立即重复写日记
 * @param {object} db - pg pool 实例
 */
export async function initNarrativeTimer(db) {
  try {
    const result = await db.query(`
      SELECT created_at FROM memory_stream
      WHERE source_type = 'narrative'
      ORDER BY created_at DESC LIMIT 1
    `);
    if (result.rows.length > 0) {
      _lastNarrativeAt = new Date(result.rows[0].created_at).getTime();
      console.log('[cognitive] 叙事计时器已从 DB 恢复，上次写入:', new Date(_lastNarrativeAt).toLocaleString('zh-CN'));
    }
  } catch (e) {
    // 查询失败静默忽略，保持 0（保持原有行为）
    console.warn('[cognitive] 叙事计时器初始化查询失败（静默忽略）:', e.message);
  }
}

/**
 * 获取最新叙事
 */
export async function getLatestNarrative(dbPool) {
  const db = dbPool || pool;
  try {
    const { rows } = await db.query(`
      SELECT content, created_at FROM memory_stream
      WHERE source_type = 'narrative'
      ORDER BY created_at DESC LIMIT 1
    `);
    return rows[0] || null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// 统一认知快照 (Cognitive Snapshot)
// ═══════════════════════════════════════════════════════════════

/**
 * 一次性获取当前认知状态快照
 * 供 tick.js 调用，减少重复计算
 */
export async function getCognitiveSnapshot({ alertnessLevel, cpuPercent, queueDepth, dbPool } = {}) {
  const [parallelAwareness, trustScores] = await Promise.all([
    getParallelAwareness(dbPool),
    getTrustScores(dbPool)
  ]);

  // 从并发意识获取成功率（近似）
  const timeState = updateSubjectiveTime();
  const emotionResult = evaluateEmotion({ alertnessLevel, cpuPercent, queueDepth });

  return {
    emotion: emotionResult,
    time: timeState,
    parallel: parallelAwareness,
    trust: trustScores,
    snapshot_at: new Date().toISOString()
  };
}

// ═══════════════════════════════════════════════════════════════
// 模块自测（CLI 直接运行时）
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// 测试辅助（仅测试环境）
// ═══════════════════════════════════════════════════════════════

export function _resetCaches() {
  _worldModelCache = { updated_at: 0, predictions: {} };
  _trustCache = { updated_at: 0, scores: {} };
  _lastNarrativeAt = 0;
  _tickEventBuffer = [];
}

if (process.argv[2] === '--test-emotion') {
  const result = evaluateEmotion({ alertnessLevel: 3, cpuPercent: 85, queueDepth: 15, successRate: 0.5 });
  console.log('EMOTION_OK:', JSON.stringify(result));
}
