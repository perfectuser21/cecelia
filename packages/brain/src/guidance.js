/**
 * brain_guidance 工具函数
 *
 * 两层架构的握手接口（spec: docs/superpowers/specs/2026-05-04-brain-scheduler-consciousness-split.md）：
 *   - Layer 2 意识层（consciousness-loop）调用 setGuidance 写建议
 *   - Layer 1 调度层（tick-scheduler）调用 getGuidance 读建议
 *
 * Key 命名规范：
 *   routing:{task_id}   — 单任务路由建议，TTL 1h
 *   strategy:global     — 全局策略，TTL 24h（+ DECISION_TTL_MIN 额外短路 TTL）
 *   cooldown:{provider} — LLM provider 冷却，TTL 按错误类型
 *   reflection:latest   — 最新反思，TTL 24h
 *
 * DECISION_TTL_MIN（默认 15）：
 *   当 guidance value 含 decision_id 字段时，额外检查 updated_at 距今是否超过此阈值。
 *   超过则返回 null，让 caller 走 EXECUTOR_ROUTING fallback，防止 stale decision 误导调度。
 */

import pool from './db.js';

/** decision_id 标记的 guidance 短路 TTL（分钟），默认 15 分钟 */
function getDecisionTtlMs() {
  const ttlMin = parseInt(process.env.DECISION_TTL_MIN || '15', 10);
  return ttlMin * 60 * 1000;
}

/**
 * 读取一条 guidance。过期或不存在返回 null。
 * 若 value 含 decision_id，额外检查 DECISION_TTL_MIN 短路 TTL（防 stale decision 误导调度）。
 * @param {string} key
 * @returns {Promise<object|null>}
 */
export async function getGuidance(key) {
  const { rows } = await pool.query(
    `SELECT value, updated_at FROM brain_guidance
     WHERE key = $1
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [key]
  );
  if (rows.length === 0) return null;

  const { value, updated_at } = rows[0];

  // Decision TTL 短路检查：含 decision_id 的 guidance 受额外短路 TTL 约束
  if (value && typeof value === 'object' && value.decision_id !== undefined) {
    const ageMs = Date.now() - new Date(updated_at).getTime();
    if (ageMs > getDecisionTtlMs()) {
      console.log(
        `[guidance] strategy decision stale（age=${Math.round(ageMs / 60000)}min > TTL=${parseInt(process.env.DECISION_TTL_MIN || '15', 10)}min），返回 null，让 dispatcher 走 EXECUTOR_ROUTING fallback`
      );
      return null;
    }
  }

  return value;
}

/**
 * 写入一条 guidance（upsert）。
 * @param {string} key
 * @param {object} value
 * @param {'thalamus'|'cortex'|'reflection'|'memory'} source
 * @param {number|null} ttlMs - 有效期毫秒，null 表示永不过期
 */
export async function setGuidance(key, value, source, ttlMs = null) {
  const expiresAt = ttlMs ? new Date(Date.now() + ttlMs).toISOString() : null;
  await pool.query(
    `INSERT INTO brain_guidance (key, value, source, expires_at, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, NOW())
     ON CONFLICT (key) DO UPDATE SET
       value      = EXCLUDED.value,
       source     = EXCLUDED.source,
       expires_at = EXCLUDED.expires_at,
       updated_at = NOW()`,
    [key, JSON.stringify(value), source, expiresAt]
  );
}

/**
 * 删除所有过期 guidance 条目。在 tick 低峰期调用。
 * @returns {Promise<number>} 删除行数
 */
export async function clearExpired() {
  const { rowCount } = await pool.query(
    `DELETE FROM brain_guidance WHERE expires_at IS NOT NULL AND expires_at <= NOW()`,
    []
  );
  return rowCount ?? 0;
}
