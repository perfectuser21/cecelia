/**
 * brain_guidance 工具函数
 *
 * 两层架构的握手接口（spec: docs/superpowers/specs/2026-05-04-brain-scheduler-consciousness-split.md）：
 *   - Layer 2 意识层（consciousness-loop）调用 setGuidance 写建议
 *   - Layer 1 调度层（tick-scheduler）调用 getGuidance 读建议
 *
 * Key 命名规范：
 *   routing:{task_id}   — 单任务路由建议，TTL 1h
 *   strategy:global     — 全局策略，TTL 24h
 *   cooldown:{provider} — LLM provider 冷却，TTL 按错误类型
 *   reflection:latest   — 最新反思，TTL 24h
 */

import pool from './db.js';

/**
 * 读取一条 guidance。过期或不存在返回 null。
 * @param {string} key
 * @returns {Promise<object|null>}
 */
export async function getGuidance(key) {
  const { rows } = await pool.query(
    `SELECT value FROM brain_guidance
     WHERE key = $1
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [key]
  );
  return rows.length > 0 ? rows[0].value : null;
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
