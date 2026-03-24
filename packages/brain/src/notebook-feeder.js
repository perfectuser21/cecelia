/**
 * Notebook Feeder — 系统性喂入 NotebookLM
 *
 * 每天定时把 Cecelia 的核心知识喂入 NotebookLM，确保 NotebookLM
 * 能在 queryNotebook 时综合全量历史：
 *
 *   - 今日新增 learnings（标题 + 内容）
 *   - 高重要度 memory_stream（importance >= 7，今日新增）
 *   - 当前 OKR/goals 摘要（每周一次）
 *
 * 调用方式：由 tick.js fire-and-forget 调用 feedDailyIfNeeded()
 * 防重复：通过 working_memory key 'notebook_last_feed_date' 检查今日是否已喂
 */

/* global console */

import pool from './db.js';
import { addTextSource } from './notebook-adapter.js';

// ── 笔记本 ID 查询 ────────────────────────────────────────

/**
 * 从 working_memory 获取笔记本 ID 配置
 * @returns {{ working: string|null, self: string|null, alex: string|null }}
 */
async function getNotebookIds(db) {
  const { rows } = await db.query(
    `SELECT key, value_json FROM working_memory
     WHERE key IN ('notebook_id_working', 'notebook_id_self', 'notebook_id_alex')`
  );
  const ids = { working: null, self: null, alex: null };
  for (const row of rows) {
    const key = row.key.replace('notebook_id_', '');
    ids[key] = typeof row.value_json === 'string' ? row.value_json : null;
  }
  return ids;
}

// ── 防重复 ────────────────────────────────────────────────

async function getLastFeedDate(db) {
  const { rows } = await db.query(
    `SELECT value_json FROM working_memory WHERE key = 'notebook_last_feed_date' LIMIT 1`
  );
  return rows[0]?.value_json?.date || null;
}

async function setLastFeedDate(db, date) {
  await db.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ('notebook_last_feed_date', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()`,
    [JSON.stringify({ date })]
  );
}

// ── 喂入今日 learnings ────────────────────────────────────

async function feedTodayLearnings(db, today, notebookId) {
  const { rows } = await db.query(
    `SELECT title, content, category FROM learnings
     WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '1 day')
     ORDER BY created_at DESC LIMIT 15`,
    [today]
  );

  if (rows.length === 0) return 0;

  const text = `[每日学习 ${today}]
${rows.map(l => `【${l.category || '未分类'}】${l.title}
${(l.content || '').slice(0, 300)}`).join('\n\n')}`;

  addTextSource(text, `学习记录: ${today}`, notebookId)
    .catch(e => console.warn('[notebook-feeder] learnings feed failed:', e.message));

  return rows.length;
}

// ── 喂入高重要度 memory_stream ────────────────────────────

async function feedHighImportanceMemory(db, today, notebookId) {
  const { rows } = await db.query(
    `SELECT content, importance FROM memory_stream
     WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '1 day')
       AND importance >= 7
       AND source_type IS DISTINCT FROM 'self_model'
     ORDER BY importance DESC, created_at DESC LIMIT 10`,
    [today]
  );

  if (rows.length === 0) return 0;

  const text = `[高重要度记忆 ${today}]
${rows.map(r => `[重要度${r.importance}] ${r.content.slice(0, 300)}`).join('\n\n')}`;

  addTextSource(text, `重要记忆: ${today}`, notebookId)
    .catch(e => console.warn('[notebook-feeder] memory feed failed:', e.message));

  return rows.length;
}

// ── 喂入 OKR（每周一次）──────────────────────────────────

async function shouldFeedOkr(db) {
  const { rows } = await db.query(
    `SELECT value_json FROM working_memory WHERE key = 'notebook_last_okr_feed' LIMIT 1`
  );
  if (!rows[0]) return true;
  const lastFeed = rows[0].value_json?.date;
  if (!lastFeed) return true;
  const daysSince = (Date.now() - new Date(lastFeed).getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= 7;
}

async function feedOkr(db, today, notebookId) {
  if (!(await shouldFeedOkr(db))) return 0;

  // 迁移：goals → key_results（含 priority 字段）
  const { rows: goals } = await db.query(
    `SELECT title, status, priority FROM key_results
     WHERE status NOT IN ('completed', 'cancelled', 'archived')
     ORDER BY priority, created_at DESC LIMIT 10`
  ).catch(() => ({ rows: [] }));

  // 迁移：projects → okr_initiatives（name→title）
  const { rows: projects } = await db.query(
    `SELECT title AS name, 'initiative' AS type, status FROM okr_initiatives
     WHERE status NOT IN ('archived')
     ORDER BY created_at DESC LIMIT 10`
  ).catch(() => ({ rows: [] }));

  if (goals.length === 0 && projects.length === 0) return 0;

  const text = `[OKR & 项目状态 ${today}]
Goals:
${goals.map(g => `- [${g.priority}] ${g.title} (${g.status})`).join('\n')}

Projects/Initiatives:
${projects.map(p => `- [${p.type}] ${p.name} (${p.status || 'active'})`).join('\n')}`;

  addTextSource(text, `OKR状态: ${today}`, notebookId)
    .catch(e => console.warn('[notebook-feeder] OKR feed failed:', e.message));

  await db.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ('notebook_last_okr_feed', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()`,
    [JSON.stringify({ date: today })]
  );

  return goals.length + projects.length;
}

// ── 统一入口 ──────────────────────────────────────────────

/**
 * 按需运行每日喂入（今日已喂过则跳过）
 * fire-and-forget 友好：内部捕获所有错误
 * @param {object} [dbPool]
 * @returns {Promise<{ok: boolean, skipped?: string, fed?: object}>}
 */
export async function feedDailyIfNeeded(dbPool) {
  const db = dbPool || pool;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const lastFeed = await getLastFeedDate(db);
    if (lastFeed === today) {
      return { ok: true, skipped: 'already_fed_today', date: today };
    }

    // 查询笔记本 ID（working: learnings/memory, self: OKR）
    const notebookIds = await getNotebookIds(db).catch(() => ({ working: null, self: null, alex: null }));

    const [learningsCount, memoryCount, okrCount] = await Promise.all([
      feedTodayLearnings(db, today, notebookIds.working),
      feedHighImportanceMemory(db, today, notebookIds.working),
      feedOkr(db, today, notebookIds.self),
    ]);

    await setLastFeedDate(db, today);

    console.log(`[notebook-feeder] daily feed done: learnings=${learningsCount}, memory=${memoryCount}, okr=${okrCount}`);
    return {
      ok: true,
      date: today,
      fed: { learnings: learningsCount, memory: memoryCount, okr: okrCount },
    };
  } catch (err) {
    console.warn('[notebook-feeder] feedDailyIfNeeded failed:', err.message);
    return { ok: false, error: err.message };
  }
}
