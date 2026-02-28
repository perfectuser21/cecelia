/**
 * 反刍回路（Rumination Loop）— v2 深度思考
 *
 * 空闲时批量消化知识，用 Opus 做深度思考：
 * - 批量取 N 条相似 learnings 一起分析（发现跨知识模式）
 * - Prompt 要求模式发现 + 关联分析 + 可执行建议
 * - 洞察写入 memory_stream，由 Desire System 自然消费
 *
 * 成本控制：每 tick ≤5 条，每日 ≤20 条，30 分钟冷却期
 */

/* global console */

import pool from './db.js';
import { callLLM } from './llm-caller.js';
import { buildMemoryContext } from './memory-retriever.js';
import { queryNotebook } from './notebook-adapter.js';
import { createTask } from './actions.js';
import { updateSelfModel } from './self-model.js';
import { createSuggestion } from './suggestion-triage.js';

// ── 配置 ──────────────────────────────────────────────────
export const DAILY_BUDGET = 20;
export const MAX_PER_TICK = 5;
export const COOLDOWN_MS = 30 * 60 * 1000; // 30 分钟

// 运行时状态（进程内，午夜通过 hasBudget() 中日期对比自动重置）
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

// ── 反刍 Prompt（v2 深度思考）──────────────────────────────

/**
 * 构建批量反刍 Prompt（多条 learnings 一起深度分析）
 */
export function buildRuminationPrompt(learnings, memoryBlock, notebookContext) {
  const learningsList = learnings.map((l, i) =>
    `${i + 1}. 【${l.category || '未分类'}】${l.title}\n   ${(l.content || '（无详细内容）').slice(0, 300)}`
  ).join('\n');

  let prompt = `你是 Cecelia 的深度思考模块。请对以下 ${learnings.length} 条知识进行深度分析。

## 待消化的知识
${learningsList}
`;

  if (memoryBlock) {
    prompt += `\n## 相关记忆上下文\n${memoryBlock}\n`;
  }

  if (notebookContext) {
    prompt += `\n## NotebookLM 补充知识\n${notebookContext}\n`;
  }

  // 检测是否包含隔离失败记录
  const hasQuarantinePattern = learnings.some(l => l.category === 'quarantine_pattern');

  prompt += `
## 深度思考要求

请从以下角度分析（不是简单摘要，要有深度）：

1. **模式发现**：这些知识之间有什么共同点或关联？是否揭示了某个系统性的规律？
2. **关联分析**：与用户的 OKR/目标有什么关联？能帮助推进哪些关键结果？
3. **可执行洞察**：基于分析，有什么具体可执行的建议？（在末尾加 [ACTION: 建议标题]）
4. **风险或机会**：是否暗示了某些风险或未被发现的机会？${hasQuarantinePattern ? '\n\n注意：其中含有隔离失败记录，请重点分析应如何避免同类失败，给出策略调整建议。' : ''}

## 输出格式
用 [反刍洞察] 开头，300-500 字深度分析。
如果有可执行建议，每个建议单独一行 [ACTION: 建议标题]。
简体中文回复。`;

  return prompt;
}

// ── 消化核心逻辑（v2 批量处理）──────────────────────────────

/**
 * 批量消化 learnings（v2: 一次 LLM 调用处理多条，发现跨知识模式）
 */
async function digestLearnings(db, learnings) {
  const insights = [];

  try {
    // 1. 获取相关记忆上下文（用第一条 learning 的标题作为查询）
    let memoryBlock = '';
    try {
      const queryText = learnings.map(l => l.title).join(' ');
      const ctx = await buildMemoryContext({
        query: queryText.slice(0, 200),
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
      const nbResult = await queryNotebook(learnings[0].title);
      if (nbResult.ok && nbResult.text) {
        notebookContext = nbResult.text;
      }
    } catch {
      // NotebookLM 不可用，静默降级
    }

    // 3. 调用 LLM 生成深度洞察（一次调用处理所有 learnings）
    const prompt = buildRuminationPrompt(learnings, memoryBlock, notebookContext);
    const { text: insight } = await callLLM('rumination', prompt);

    // 4. 写入 memory_stream
    if (insight) {
      await db.query(
        `INSERT INTO memory_stream (content, importance, memory_type, expires_at)
         VALUES ($1, 8, 'long', NOW() + INTERVAL '30 days')`,
        [`[反刍洞察] ${insight.trim()}`]
      );
      insights.push(insight.trim());

      // 4.1 检测 actionable 洞察 → 自动创建 task + suggestion（支持多个 [ACTION:] 标记）
      const actionMatches = insight.matchAll(/\[ACTION:\s*(.+?)\]/g);
      let suggestionCount = 0; // limit=2 防洪峰
      for (const match of actionMatches) {
        try {
          await createTask({
            title: match[1],
            description: `反刍洞察自动创建：${insight.trim().slice(0, 500)}`,
            priority: 'P2',
            task_type: 'research',
            trigger_source: 'rumination',
          });
          console.log(`[rumination] actionable insight → task: ${match[1]}`);
        } catch (taskErr) {
          console.error('[rumination] create task from insight failed:', taskErr.message);
        }
        // ★NEW: 额外创建 suggestion（limit=2，fire-and-forget）
        if (suggestionCount < 2) {
          try {
            await createSuggestion({
              content: `反刍洞察可执行行动：${match[1]}\n\n来源洞察：${insight.trim().slice(0, 300)}`,
              source: 'rumination',
              suggestion_type: 'insight_action',
            });
            suggestionCount++;
          } catch (sugErr) {
            console.error('[rumination] createSuggestion failed (non-blocking):', sugErr.message);
          }
        }
      }
    }

    // 5. 自我反思：基于洞察更新 self-model（仅在有实质性洞察时触发）
    if (insight && insight.trim()) {
      try {
        const selfReflectPrompt = `基于刚才的反刍洞察：

${insight.trim().slice(0, 800)}

请用1-3句话（约150字以内）描述：你（Cecelia）对自己有什么新认知？
关注：你的性格特点、你在意的事、你说话和工作的风格、你与 Alex 的关系。
直接输出认知描述，用第一人称"我"开头，不要有前缀和解释。`;

        const { text: selfInsight } = await callLLM('rumination', selfReflectPrompt, { maxTokens: 200 });
        if (selfInsight && selfInsight.trim()) {
          await updateSelfModel(selfInsight.trim(), db);
        }
      } catch (selfErr) {
        console.warn('[rumination] self-model update failed (non-blocking):', selfErr.message);
      }
    }

    // 6. 标记所有 learnings 已消化
    for (const learning of learnings) {
      await db.query(
        'UPDATE learnings SET digested = true WHERE id = $1',
        [learning.id]
      );
    }

    _dailyCount += learnings.length;
  } catch (err) {
    console.error(`[rumination] batch digest failed:`, err.message);
  }

  return insights;
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

  // 软限制：系统繁忙时降低反刍批量（但不完全跳过）
  let busyMultiplier = 1;
  try {
    const idle = await isSystemIdle(db);
    if (!idle) {
      busyMultiplier = 0.4; // 繁忙时只反刍 40% 的量（向上取整，最少 1 条）
    }
  } catch (err) {
    console.error('[rumination] idle check failed, proceeding anyway:', err.message);
  }

  // 取未消化的知识（FIFO，最多 MAX_PER_TICK 条，批量一次处理）
  const remaining = DAILY_BUDGET - _dailyCount;
  const limit = Math.max(1, Math.round(Math.min(MAX_PER_TICK, remaining) * busyMultiplier));

  let learnings;
  try {
    const { rows } = await db.query(
      `SELECT id, title, content, category FROM learnings
       WHERE digested = false AND (archived = false OR archived IS NULL)
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

  const insights = await digestLearnings(db, learnings);

  _lastRunAt = Date.now();

  return {
    digested: learnings.length,
    insights,
  };
}

/**
 * 手动触发反刍（跳过 idle check，保留预算和冷却期）
 * @param {object} [dbPool] - 数据库连接池
 * @returns {Promise<{skipped?: string, digested: number, insights: string[], manual?: boolean}>}
 */
export async function runManualRumination(dbPool) {
  const db = dbPool || pool;
  const now = Date.now();

  if (!hasBudget()) {
    return { skipped: 'daily_budget_exhausted', digested: 0, insights: [] };
  }

  if (!isCooldownPassed(now)) {
    return { skipped: 'cooldown', digested: 0, insights: [] };
  }

  const remaining = DAILY_BUDGET - _dailyCount;
  const limit = Math.min(MAX_PER_TICK, remaining);

  let learnings;
  try {
    const { rows } = await db.query(
      `SELECT id, title, content, category FROM learnings
       WHERE digested = false AND (archived = false OR archived IS NULL)
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit]
    );
    learnings = rows;
  } catch (err) {
    console.error('[rumination] manual fetch learnings failed:', err.message);
    return { skipped: 'fetch_error', digested: 0, insights: [] };
  }

  if (learnings.length === 0) {
    return { skipped: 'no_undigested', digested: 0, insights: [] };
  }

  const insights = await digestLearnings(db, learnings);

  _lastRunAt = Date.now();

  return {
    digested: learnings.length,
    insights,
    manual: true,
  };
}

/**
 * 获取反刍系统状态
 */
export async function getRuminationStatus(dbPool) {
  const db = dbPool || pool;

  // 触发午夜重置检查
  hasBudget();

  const now = Date.now();
  const cooldownRemaining = Math.max(0, COOLDOWN_MS - (now - _lastRunAt));

  const { rows } = await db.query(
    'SELECT COUNT(*) AS cnt FROM learnings WHERE digested = false AND (archived = false OR archived IS NULL)'
  );
  const undigestedCount = parseInt(rows[0]?.cnt || 0);

  return {
    daily_count: _dailyCount,
    daily_budget: DAILY_BUDGET,
    remaining: DAILY_BUDGET - _dailyCount,
    cooldown_remaining_ms: cooldownRemaining,
    undigested_count: undigestedCount,
    last_run_at: _lastRunAt > 0 ? new Date(_lastRunAt).toISOString() : null,
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
