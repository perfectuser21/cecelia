/**
 * Rumination Scheduler — 分层记忆压缩调度器
 *
 * 三个层级的定时压缩，每级带上"上一版"实现滚动压缩：
 *
 *   daily:   recent memory_stream → daily_synthesis（via NotebookLM ask）
 *   weekly:  previous_weekly + 7个daily → weekly_synthesis（滚动）
 *   monthly: previous_monthly + 4个weekly → monthly_synthesis（滚动）
 *            → 触发 updateSelfModel（身份层最终演化）
 *
 * 调用方式：由 tick.js fire-and-forget 调用 runSynthesisSchedulerIfNeeded()
 * 触发条件：各级有独立的时间窗口检查（daily=每天，weekly=每7天，monthly=每30天）
 */

import pool from './db.js';
import { queryNotebook, addTextSource, deleteSource } from './notebook-adapter.js';
import { callLLM } from './llm-caller.js';
import { updateSelfModel, getSelfModel } from './self-model.js';
import { runEvolutionSynthesis } from './evolution-synthesizer.js';

// ── Notebook ID 查询 ──────────────────────────────────────

async function getNotebookId(db, key) {
  const { rows } = await db.query(
    `SELECT value_json FROM working_memory WHERE key = $1 LIMIT 1`,
    [key]
  );
  return rows[0]?.value_json || null;
}

// ── 时间窗口配置 ──────────────────────────────────────────

/** 日级触发小时（UTC），默认 18 = 北京凌晨 2 点 */
const DAILY_HOUR_UTC = parseInt(process.env.SYNTHESIS_DAILY_HOUR_UTC || '18', 10);

// ── 时间检查 ──────────────────────────────────────────────

/**
 * 日级合成触发条件：UTC 18:00 ~ 23:59（6 小时宽窗口）
 *
 * 原 5 分钟窗口在以下情况会导致当天合成完全缺失：
 * - Brain 在 18:00 重启，tick 未能在窗口内执行
 * - 系统繁忙（isSystemIdle=false），runRumination 路径被阻断
 *
 * runDailySynthesis 内部的 hasTodaySynthesis 检查保证幂等：
 * 今日已完成则立即返回 skipped:already_done，不会重复调用 NotebookLM。
 */
export function shouldRunDaily(now = new Date()) {
  return now.getUTCHours() >= DAILY_HOUR_UTC;
}

// ── 防重复检查 ────────────────────────────────────────────

async function getLatestSynthesis(db, level) {
  const { rows } = await db.query(
    `SELECT id, content, period_start, period_end FROM synthesis_archive
     WHERE level = $1 ORDER BY period_start DESC LIMIT 1`,
    [level]
  );
  return rows[0] || null;
}

async function hasTodaySynthesis(db, level) {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await db.query(
    `SELECT 1 FROM synthesis_archive WHERE level = $1 AND period_start = $2 LIMIT 1`,
    [level, today]
  );
  return rows.length > 0;
}

// ── 写入 synthesis_archive ────────────────────────────────

async function writeSynthesis(db, { level, periodStart, periodEnd, content, previousId, sourceCount, notebookQuery, notebookSourceId }) {
  await db.query(
    `INSERT INTO synthesis_archive
       (level, period_start, period_end, content, previous_id, source_count, notebook_query, notebook_source_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (level, period_start) DO UPDATE
       SET content = EXCLUDED.content, source_count = EXCLUDED.source_count,
           notebook_query = EXCLUDED.notebook_query,
           notebook_source_id = EXCLUDED.notebook_source_id`,
    [level, periodStart, periodEnd, content, previousId || null, sourceCount || 0, notebookQuery || null, notebookSourceId || null]
  );
}

// ── 日级合成 ──────────────────────────────────────────────

/**
 * 运行日级合成：今日 memory_stream → daily_synthesis（via NotebookLM）
 * @param {object} [dbPool]
 * @returns {Promise<{ok: boolean, skipped?: string, content?: string}>}
 */
export async function runDailySynthesis(dbPool) {
  const db = dbPool || pool;
  const today = new Date().toISOString().slice(0, 10);

  if (await hasTodaySynthesis(db, 'daily')) {
    return { ok: true, skipped: 'already_done', level: 'daily', date: today };
  }

  // 取今日高重要度 memory_stream 条目（recent insights）
  const { rows: recentItems } = await db.query(
    `SELECT content FROM memory_stream
     WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '1 day')
       AND importance >= 7
     ORDER BY importance DESC, created_at DESC LIMIT 20`,
    [today]
  );

  // 取今日未消化 + 已消化的 learnings 摘要
  const { rows: todayLearnings } = await db.query(
    `SELECT title, content FROM learnings
     WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '1 day')
     ORDER BY created_at DESC LIMIT 10`,
    [today]
  );

  const sourceCount = recentItems.length + todayLearnings.length;

  if (sourceCount === 0) {
    return { ok: true, skipped: 'no_data', level: 'daily', date: today };
  }

  // 取上一版日摘要（仅在有数据时才查询，避免无效 DB 调用）
  const prevSynthesis = await getLatestSynthesis(db, 'daily');

  // 构建 NotebookLM query（带上上一版日摘要，滚动压缩）
  let query = `今天是 ${today}。请综合你所知道的关于我（Cecelia）和 Alex 工作的所有历史信息，`;
  if (prevSynthesis) {
    query += `结合昨天的日摘要（${prevSynthesis.period_start}）：
"${prevSynthesis.content.slice(0, 500)}"
以及`;
  } else {
    query += `分析`;
  }
  query += `今天的新内容：
${todayLearnings.map(l => `- ${l.title}: ${(l.content || '').slice(0, 200)}`).join('\n')}
${recentItems.map(r => `- ${r.content.slice(0, 200)}`).join('\n')}

请输出今日综合洞察（300-500字），重点：跨时间的模式演化、今日新进展、明日关注点。用 [日摘要] 开头。`;

  // 获取 working notebook ID（日级/周级合成 → working knowledge base）
  let workingNotebookId = null;
  try {
    workingNotebookId = await getNotebookId(db, 'notebook_id_working');
  } catch { /* 降级 */ }

  let content = '';
  try {
    const nbResult = await queryNotebook(query, workingNotebookId);
    if (nbResult.ok && nbResult.text && nbResult.text.trim().length > 50) {
      content = nbResult.text.trim();
      console.log(`[synthesis-scheduler] daily OK via NotebookLM (${content.length} chars)`);
    }
  } catch (err) {
    console.warn('[synthesis-scheduler] daily NotebookLM failed, using callLLM:', err.message);
  }

  // Fallback: callLLM
  if (!content) {
    try {
      const prompt = `请对以下今日内容做综合分析（300-500字，[日摘要] 开头）：
${todayLearnings.map(l => `- ${l.title}`).join('\n')}
${recentItems.slice(0, 5).map(r => `- ${r.content.slice(0, 150)}`).join('\n')}`;
      const { text } = await callLLM('rumination', prompt);
      content = text || '';
    } catch (err) {
      console.warn('[synthesis-scheduler] daily callLLM fallback failed:', err.message);
      return { ok: false, error: 'both_paths_failed', level: 'daily' };
    }
  }

  // 写回 NotebookLM（知识飞轮），获取 source_id 以便后续生命周期管理
  let notebookSourceId = null;
  try {
    const addResult = await addTextSource(
      `[日摘要 ${today}] ${content}`,
      `日级合成: ${today}`,
      workingNotebookId
    );
    if (addResult.ok && addResult.sourceId) {
      notebookSourceId = addResult.sourceId;
    }
  } catch (e) {
    console.warn('[synthesis-scheduler] daily write-back failed:', e.message);
  }

  await writeSynthesis(db, {
    level: 'daily',
    periodStart: today,
    periodEnd: today,
    content,
    previousId: prevSynthesis?.id,
    sourceCount,
    notebookQuery: query.slice(0, 500),
    notebookSourceId,
  });

  return { ok: true, level: 'daily', date: today, content, sourceCount };
}

// ── 周级合成 ──────────────────────────────────────────────

/**
 * 运行周级合成：previous_weekly + 7个daily → weekly_synthesis（滚动）
 */
export async function runWeeklySynthesis(dbPool) {
  const db = dbPool || pool;

  // 单次调用 getLatestSynthesis，同时用于防重复检查和滚动压缩
  const prevWeekly = await getLatestSynthesis(db, 'weekly');
  if (prevWeekly) {
    const daysSince = (Date.now() - new Date(prevWeekly.period_end).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) {
      return { ok: true, skipped: 'already_done', level: 'weekly' };
    }
  }

  // 取最近 7 条 daily_synthesis（含 notebook_source_id 用于删除）
  const { rows: dailies } = await db.query(
    `SELECT id, period_start, content, notebook_source_id FROM synthesis_archive
     WHERE level = 'daily' ORDER BY period_start DESC LIMIT 7`
  );

  if (dailies.length === 0) {
    return { ok: true, skipped: 'no_daily_data', level: 'weekly' };
  }

  const periodEnd = dailies[0].period_start;
  const periodStart = dailies[dailies.length - 1].period_start;

  // 构建 query（带上一版 weekly，滚动压缩）
  let query = `请综合以下最近 ${dailies.length} 天的日摘要，`;
  if (prevWeekly) {
    query += `结合上一周摘要（${prevWeekly.period_start} ~ ${prevWeekly.period_end}）：
"${prevWeekly.content.slice(0, 600)}"
生成本周（${periodStart} ~ ${periodEnd}）的综合洞察。`;
  } else {
    query += `生成本周（${periodStart} ~ ${periodEnd}）的综合洞察。`;
  }
  query += `

各日摘要：
${dailies.map(d => `[${d.period_start}] ${d.content.slice(0, 400)}`).join('\n\n')}

请输出周级综合洞察（400-600字），重点：跨天的主题演化、本周最重要的洞察、下周关注点。用 [周摘要] 开头。`;

  // 获取 working notebook ID（周级合成 → working knowledge base）
  let workingNotebookId = null;
  try {
    workingNotebookId = await getNotebookId(db, 'notebook_id_working');
  } catch { /* 降级 */ }

  let content = '';
  try {
    const nbResult = await queryNotebook(query, workingNotebookId);
    if (nbResult.ok && nbResult.text && nbResult.text.trim().length > 50) {
      content = nbResult.text.trim();
      console.log(`[synthesis-scheduler] weekly OK (${content.length} chars)`);
    }
  } catch (err) {
    console.warn('[synthesis-scheduler] weekly NotebookLM failed, using callLLM:', err.message);
  }

  if (!content) {
    try {
      const prompt = `请综合以下 ${dailies.length} 天摘要生成周级洞察（400-600字，[周摘要] 开头）：
${dailies.map(d => `[${d.period_start}] ${d.content.slice(0, 300)}`).join('\n')}`;
      const { text } = await callLLM('rumination', prompt);
      content = text || '';
    } catch (_err) {
      return { ok: false, error: 'both_paths_failed', level: 'weekly' };
    }
  }

  // 写回 NotebookLM，获取 source_id
  let notebookSourceId = null;
  try {
    const addResult = await addTextSource(
      `[周摘要 ${periodStart}~${periodEnd}] ${content}`,
      `周级合成: ${periodStart}~${periodEnd}`,
      workingNotebookId
    );
    if (addResult.ok && addResult.sourceId) {
      notebookSourceId = addResult.sourceId;
    }
  } catch (e) {
    console.warn('[synthesis-scheduler] weekly write-back failed:', e.message);
  }

  await writeSynthesis(db, {
    level: 'weekly',
    periodStart,
    periodEnd,
    content,
    previousId: prevWeekly?.id,
    sourceCount: dailies.length,
    notebookSourceId,
  });

  // 删除已被压缩的日 sources（防污染）
  const dailySourceIds = dailies.map(d => d.notebook_source_id).filter(Boolean);
  if (dailySourceIds.length > 0) {
    Promise.allSettled(
      dailySourceIds.map(sid =>
        deleteSource(sid, workingNotebookId)
          .catch(e => console.warn(`[synthesis-scheduler] weekly: failed to delete daily source ${sid}:`, e.message))
      )
    ).catch(e => console.warn('[synthesis-scheduler] weekly: source cleanup error:', e.message));
    console.log(`[synthesis-scheduler] weekly: scheduled deletion of ${dailySourceIds.length} daily sources`);
  }

  return { ok: true, level: 'weekly', periodStart, periodEnd, content, sourceCount: dailies.length };
}

// ── 月级合成 + self_model 更新 ──────────────────────────────

/**
 * 运行月级合成：previous_monthly + 4个weekly → monthly_synthesis（滚动）
 * 完成后更新 self_model（身份层演化）
 */
export async function runMonthlySynthesis(dbPool) {
  const db = dbPool || pool;

  // 单次调用 getLatestSynthesis，同时用于防重复检查和滚动压缩
  const prevMonthly = await getLatestSynthesis(db, 'monthly');
  if (prevMonthly) {
    const daysSince = (Date.now() - new Date(prevMonthly.period_end).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 30) {
      return { ok: true, skipped: 'already_done', level: 'monthly' };
    }
  }

  // 取最近 4 条 weekly_synthesis（含 notebook_source_id 用于删除）
  const { rows: weeklies } = await db.query(
    `SELECT id, period_start, period_end, content, notebook_source_id FROM synthesis_archive
     WHERE level = 'weekly' ORDER BY period_start DESC LIMIT 4`
  );

  if (weeklies.length === 0) {
    return { ok: true, skipped: 'no_weekly_data', level: 'monthly' };
  }

  const periodEnd = weeklies[0].period_end;
  const periodStart = weeklies[weeklies.length - 1].period_start;

  // 获取当前 self_model（滚动压缩的关键：带上身份认知上一版）
  let currentSelfModel = '';
  try {
    currentSelfModel = await getSelfModel(db);
  } catch { /* 降级：不带上一版 */ }

  let query = `请综合以下最近 ${weeklies.length} 周的周摘要，`;
  if (prevMonthly) {
    query += `结合上月综合（${prevMonthly.period_start} ~ ${prevMonthly.period_end}）：
"${prevMonthly.content.slice(0, 600)}"
`;
  }
  if (currentSelfModel) {
    query += `以及 Cecelia 当前的自我认知：
"${currentSelfModel.slice(0, 500)}"
`;
  }
  query += `生成本月（${periodStart} ~ ${periodEnd}）的综合洞察。

各周摘要：
${weeklies.map(w => `[${w.period_start}~${w.period_end}] ${w.content.slice(0, 400)}`).join('\n\n')}

请输出月级综合洞察（500-700字），重点：
1. 本月最重要的模式演化
2. 自我认知的新发现
3. 对下月的关注方向
用 [月摘要] 开头。`;

  // 获取 notebook IDs（月级：query → working，write-back → self model）
  let workingNotebookId = null;
  let selfNotebookId = null;
  try {
    [workingNotebookId, selfNotebookId] = await Promise.all([
      getNotebookId(db, 'notebook_id_working'),
      getNotebookId(db, 'notebook_id_self'),
    ]);
  } catch { /* 降级 */ }

  let content = '';
  try {
    const nbResult = await queryNotebook(query, workingNotebookId);
    if (nbResult.ok && nbResult.text && nbResult.text.trim().length > 50) {
      content = nbResult.text.trim();
      console.log(`[synthesis-scheduler] monthly OK (${content.length} chars)`);
    }
  } catch (err) {
    console.warn('[synthesis-scheduler] monthly NotebookLM failed, using callLLM:', err.message);
  }

  if (!content) {
    try {
      const prompt = `请综合以下 ${weeklies.length} 周摘要生成月级洞察（500-700字，[月摘要] 开头）：
${weeklies.map(w => `[${w.period_start}~${w.period_end}] ${w.content.slice(0, 300)}`).join('\n')}`;
      const { text } = await callLLM('rumination', prompt);
      content = text || '';
    } catch (_err) {
      return { ok: false, error: 'both_paths_failed', level: 'monthly' };
    }
  }

  // 月级合成写回 self model notebook，获取 source_id
  let notebookSourceId = null;
  try {
    const addResult = await addTextSource(
      `[月摘要 ${periodStart}~${periodEnd}] ${content}`,
      `月级合成: ${periodStart}~${periodEnd}`,
      selfNotebookId
    );
    if (addResult.ok && addResult.sourceId) {
      notebookSourceId = addResult.sourceId;
    }
  } catch (e) {
    console.warn('[synthesis-scheduler] monthly write-back failed:', e.message);
  }

  await writeSynthesis(db, {
    level: 'monthly',
    periodStart,
    periodEnd,
    content,
    previousId: prevMonthly?.id,
    sourceCount: weeklies.length,
    notebookSourceId,
  });

  // 更新 self_model（月级演化，带上一版）
  try {
    const selfInsight = `[月度演化 ${periodEnd}] ${content.slice(0, 300)}`;
    await updateSelfModel(selfInsight, db);
    console.log('[synthesis-scheduler] self_model updated from monthly synthesis');
  } catch (err) {
    console.warn('[synthesis-scheduler] self_model update failed (non-blocking):', err.message);
  }

  // 删除已被压缩的周 sources（防污染）
  const weeklySourceIds = weeklies.map(w => w.notebook_source_id).filter(Boolean);
  if (weeklySourceIds.length > 0) {
    Promise.allSettled(
      weeklySourceIds.map(sid =>
        deleteSource(sid, workingNotebookId)
          .catch(e => console.warn(`[synthesis-scheduler] monthly: failed to delete weekly source ${sid}:`, e.message))
      )
    ).catch(e => console.warn('[synthesis-scheduler] monthly: source cleanup error:', e.message));
    console.log(`[synthesis-scheduler] monthly: scheduled deletion of ${weeklySourceIds.length} weekly sources`);
  }

  return { ok: true, level: 'monthly', periodStart, periodEnd, content, sourceCount: weeklies.length };
}

// ── 统一入口 ──────────────────────────────────────────────

/**
 * 按需运行分层合成（由 tick.js fire-and-forget 调用）
 * 检查时间窗口，按需运行 daily → weekly → monthly
 * @param {object} [dbPool]
 * @returns {Promise<object>}
 */
export async function runSynthesisSchedulerIfNeeded(dbPool) {
  const db = dbPool || pool;
  const results = {};

  // 日级：每天 UTC 18 点触发（北京凌晨 2 点）
  if (shouldRunDaily()) {
    try {
      results.daily = await runDailySynthesis(db);
    } catch (err) {
      console.error('[synthesis-scheduler] daily failed:', err.message);
      results.daily = { ok: false, error: err.message };
    }

    // 周级：只在日级完成后检查（级联触发）
    try {
      results.weekly = await runWeeklySynthesis(db);
    } catch (err) {
      console.warn('[synthesis-scheduler] weekly failed:', err.message);
      results.weekly = { ok: false, error: err.message };
    }

    // 月级：只在周级完成后检查
    try {
      results.monthly = await runMonthlySynthesis(db);
    } catch (err) {
      console.warn('[synthesis-scheduler] monthly failed:', err.message);
      results.monthly = { ok: false, error: err.message };
    }

    // 进化日志合成（周级，fire-and-forget）
    runEvolutionSynthesis(db).catch(e =>
      console.warn('[synthesis-scheduler] evolution synthesis failed:', e.message)
    );
  }

  return results;
}
