/**
 * 反刍回路（Rumination Loop）
 *
 * 空闲时自动消化用户分享的知识，与 OKR 关联后写入 memory_stream，
 * 由 Desire System 自然消费产生洞察。
 *
 * 成本控制：每 tick ≤3 条，每日 ≤10 条，30 分钟冷却期
 */

/* global console */

import pool from './db.js';
import { callLLM } from './llm-caller.js';
import { buildMemoryContext } from './memory-retriever.js';
import { queryNotebook } from './notebook-adapter.js';

// ── 配置 ──────────────────────────────────────────────────
export const DAILY_BUDGET = 10;
export const MAX_PER_TICK = 3;
export const COOLDOWN_MS = 30 * 60 * 1000; // 30 分钟

// 运行时状态（进程内，午夜不重置 — Phase 2 做）
let _dailyCount = 0;
let _lastRunAt = 0;
let _lastResetDate = new Date().toDateString();

// ── 测试辅助 ──────────────────────────────────────────────
export function _resetState() {
  _dailyCount = 0;
  _lastRunAt = 0;
  _lastResetDate = new Date().toDateString();
}

// ── 条件检查 ──────────────────────────────────────────────

/**
 * 检查系统是否空闲（in_progress=0 且 queued≤3）
 */
async function isSystemIdle(dbPool) {
  const { rows } = await dbPool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
      COUNT(*) FILTER (WHERE status = 'queued') AS queued
    FROM tasks
  `);
  const t = rows[0] || {};
  return parseInt(t.in_progress || 0) === 0 && parseInt(t.queued || 0) <= 3;
}

/**
 * 检查冷却期是否已过
 */
function isCooldownPassed(now) {
  return (now - _lastRunAt) >= COOLDOWN_MS;
}

/**
 * 检查每日预算
 */
function hasBudget() {
  // 简易日期重置
  const today = new Date().toDateString();
  if (today !== _lastResetDate) {
    _dailyCount = 0;
    _lastResetDate = today;
  }
  return _dailyCount < DAILY_BUDGET;
}

// ── 反刍 Prompt ──────────────────────────────────────────

function buildRuminationPrompt(learning, memoryBlock, notebookContext) {
  let prompt = `你是 Cecelia 的反刍模块。请消化以下用户分享的知识，产出 1-2 句简洁洞察。

## 用户分享的知识
标题：${learning.title}
内容：${learning.content || '（无详细内容）'}
分类：${learning.category || '未分类'}
`;

  if (memoryBlock) {
    prompt += `\n## 相关记忆上下文\n${memoryBlock}\n`;
  }

  if (notebookContext) {
    prompt += `\n## NotebookLM 补充知识\n${notebookContext}\n`;
  }

  prompt += `
## 要求
1. 将这条知识与用户已有的 OKR/目标关联
2. 产出 1-2 句洞察（格式：[反刍洞察] ...）
3. 如果没有明显关联，说明知识的潜在价值
4. 简体中文回复`;

  return prompt;
}

// ── 核心流程 ──────────────────────────────────────────────

/**
 * 运行反刍回路（由 tick.js 调用）
 * @param {object} [dbPool] - 数据库连接池（可选，默认用全局 pool）
 * @returns {Promise<{skipped?: string, digested: number, insights: string[]}>}
 */
export async function runRumination(dbPool) {
  const db = dbPool || pool;
  const now = Date.now();

  // 前置条件检查
  if (!hasBudget()) {
    return { skipped: 'daily_budget_exhausted', digested: 0, insights: [] };
  }

  if (!isCooldownPassed(now)) {
    return { skipped: 'cooldown', digested: 0, insights: [] };
  }

  let idle;
  try {
    idle = await isSystemIdle(db);
  } catch (err) {
    console.error('[rumination] idle check failed:', err.message);
    return { skipped: 'idle_check_error', digested: 0, insights: [] };
  }

  if (!idle) {
    return { skipped: 'system_busy', digested: 0, insights: [] };
  }

  // 取未消化的知识（FIFO，最多 MAX_PER_TICK 条）
  const remaining = DAILY_BUDGET - _dailyCount;
  const limit = Math.min(MAX_PER_TICK, remaining);

  let learnings;
  try {
    const { rows } = await db.query(
      `SELECT id, title, content, category FROM learnings
       WHERE digested = false
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit]
    );
    learnings = rows;
  } catch (err) {
    console.error('[rumination] fetch learnings failed:', err.message);
    return { skipped: 'fetch_error', digested: 0, insights: [] };
  }

  if (learnings.length === 0) {
    return { skipped: 'no_undigested', digested: 0, insights: [] };
  }

  // 逐条消化
  const insights = [];

  for (const learning of learnings) {
    try {
      // 1. 获取相关记忆上下文
      let memoryBlock = '';
      try {
        const ctx = await buildMemoryContext({
          query: learning.title,
          mode: 'reflect',
          tokenBudget: 500,
          pool: db,
        });
        memoryBlock = ctx.block || '';
      } catch {
        // 记忆检索失败不影响反刍
      }

      // 2. 查询 NotebookLM（可选，降级安全）
      let notebookContext = '';
      try {
        const nbResult = await queryNotebook(learning.title);
        if (nbResult.ok && nbResult.text) {
          notebookContext = nbResult.text;
        }
      } catch {
        // NotebookLM 不可用，静默降级
      }

      // 3. 调用 LLM 生成洞察
      const prompt = buildRuminationPrompt(learning, memoryBlock, notebookContext);
      const { text: insight } = await callLLM('rumination', prompt);

      // 4. 写入 memory_stream
      if (insight) {
        await db.query(
          `INSERT INTO memory_stream (content, importance, memory_type, expires_at)
           VALUES ($1, 7, 'long', NOW() + INTERVAL '30 days')`,
          [`[反刍洞察] ${insight.trim()}`]
        );
        insights.push(insight.trim());
      }

      // 5. 标记已消化
      await db.query(
        'UPDATE learnings SET digested = true WHERE id = $1',
        [learning.id]
      );

      _dailyCount++;
    } catch (err) {
      console.error(`[rumination] digest learning ${learning.id} failed:`, err.message);
      // 单条失败不影响其他
    }
  }

  _lastRunAt = Date.now();

  return {
    digested: insights.length,
    insights,
  };
}

/**
 * 获取未消化知识数量（供 perception.js 使用）
 */
export async function getUndigestedCount(dbPool) {
  const db = dbPool || pool;
  const { rows } = await db.query(
    'SELECT COUNT(*) AS cnt FROM learnings WHERE digested = false'
  );
  return parseInt(rows[0]?.cnt || 0);
}
