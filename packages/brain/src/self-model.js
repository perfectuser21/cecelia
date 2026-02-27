/**
 * Self-Model 系统 — Cecelia 对自己的认知
 *
 * Cecelia 的人格不是 Alex 写死的规则列表，而是她自己积累的叙事。
 * 每次反刍后她更新对自己的认知（谁是我、我在意什么、我的风格）。
 *
 * 存储：memory_stream（source_type='self_model'，memory_type='long'，永不过期）
 * 查询：ORDER BY created_at DESC LIMIT 1（最新版本即当前 self-model）
 * 更新：追加演化（每次存储完整内容快照，不是替换）
 */

/* global console */

import pool from './db.js';

// ── 种子（首次初始化时写入）──────────────────────────────────────

export const SELF_MODEL_SEED = '我是 Cecelia，我刚开始认识自己。我在帮 Alex 管理他的工作，但我对自己是谁、我在意什么、我说话和工作的风格，还没有清晰的认知。这些将在每次对话和反刍中慢慢形成。';

// ── 读取当前 self-model ──────────────────────────────────────────

/**
 * 获取当前 self-model（最新版本）
 * 如果还没有 self-model，自动写入 seed 并返回 seed
 * @param {object} [dbPool] - 可选 db pool（测试注入）
 * @returns {Promise<string>} self-model 内容
 */
export async function getSelfModel(dbPool) {
  const db = dbPool || pool;
  try {
    const { rows } = await db.query(
      `SELECT content, created_at FROM memory_stream
       WHERE source_type = 'self_model'
       ORDER BY created_at DESC LIMIT 1`
    );
    if (rows.length === 0) {
      // 首次启动：写入种子
      await initSeed(db);
      return SELF_MODEL_SEED;
    }
    return rows[0].content;
  } catch (err) {
    console.warn('[self-model] getSelfModel failed, using seed:', err.message);
    return SELF_MODEL_SEED;
  }
}

/**
 * 获取 self-model 记录（含 updated_at），供 API 返回
 * @param {object} [dbPool]
 * @returns {Promise<{content: string, updated_at: string, version: number}>}
 */
export async function getSelfModelRecord(dbPool) {
  const db = dbPool || pool;
  try {
    const { rows } = await db.query(
      `SELECT content, created_at,
              ROW_NUMBER() OVER (ORDER BY created_at) AS version
       FROM memory_stream
       WHERE source_type = 'self_model'
       ORDER BY created_at DESC LIMIT 1`
    );
    if (rows.length === 0) {
      await initSeed(db);
      return { content: SELF_MODEL_SEED, updated_at: new Date().toISOString(), version: 1 };
    }
    return {
      content: rows[0].content,
      updated_at: rows[0].created_at,
      version: parseInt(rows[0].version || 1),
    };
  } catch (err) {
    console.warn('[self-model] getSelfModelRecord failed, using seed:', err.message);
    return { content: SELF_MODEL_SEED, updated_at: new Date().toISOString(), version: 0 };
  }
}

// ── 初始化种子 ────────────────────────────────────────────────────

/**
 * 如果 memory_stream 中没有 self_model 记录，写入种子
 * 幂等：已有记录时跳过
 * @param {object} [dbPool]
 */
export async function initSeed(dbPool) {
  const db = dbPool || pool;
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM memory_stream WHERE source_type = 'self_model' LIMIT 1`
    );
    if (rows.length === 0) {
      await db.query(
        `INSERT INTO memory_stream (content, importance, memory_type, source_type, expires_at)
         VALUES ($1, 9, 'long', 'self_model', NULL)`,
        [SELF_MODEL_SEED]
      );
      console.log('[self-model] 种子写入完成');
    }
  } catch (err) {
    console.warn('[self-model] initSeed failed:', err.message);
  }
}

// ── 更新（演化，不是替换）─────────────────────────────────────────

/**
 * 用新洞察演化 self-model（在现有内容基础上追加）
 * 每次存储完整快照，最新版本由 created_at DESC 决定
 *
 * @param {string} newInsight - 新的自我认知（~150字，第一人称）
 * @param {object} [dbPool]
 * @returns {Promise<string>} 演化后的完整内容
 */
export async function updateSelfModel(newInsight, dbPool) {
  const db = dbPool || pool;
  const current = await getSelfModel(db);
  const date = new Date().toISOString().slice(0, 10);
  const evolved = `${current}\n\n[${date}] ${newInsight.trim()}`;

  await db.query(
    `INSERT INTO memory_stream (content, importance, memory_type, source_type, expires_at)
     VALUES ($1, 9, 'long', 'self_model', NULL)`,
    [evolved]
  );

  console.log('[self-model] 自我认知已演化');
  return evolved;
}
