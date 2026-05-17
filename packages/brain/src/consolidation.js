/**
 * Daily Consolidation Loop（每日合并循环）
 *
 * 把对话/learnings/任务 → 情节记忆 + self-model 演化。
 *
 * 触发时机：
 *   - tick.js 步骤 10.9：每次 tick 调用 runDailyConsolidationIfNeeded
 *   - 或外部调用 runDailyConsolidation(pool, { forceRun: true })
 *
 * 防重复（基于 elapsed time，与 capability-probe 同源）：
 *   查询 memory_stream 中 source_type='daily_consolidation' 的最近 created_at，
 *   距今超过 CONSOLIDATION_INTERVAL_HOURS 才允许执行。
 *
 * 历史故障 PROBE_FAIL_CONSOLIDATION（48h_consolidations=0 last_run=never）原因：
 *   旧实现用 shouldRunConsolidation() 检查"是否在 UTC 0/4/8/12/16/20 整时刻的前 5 分钟"，
 *   每天仅 6 个 5 分钟窗口共 30 分钟。Tick 间隔与 Brain 重启都可能错过窗口；
 *   再叠加 hasTodayConsolidation 按"日"去重，错过即整天没有补救机会，
 *   导致 last_run 永远停留在 never。现已替换为 elapsed-time 判断。
 */

import { callLLM } from './llm-caller.js';
import { updateSelfModel } from './self-model.js';

/** 整合间隔小时数（可通过 brain_config 配置，默认 4 小时） */
const CONSOLIDATION_INTERVAL_HOURS = parseInt(
  process.env.CECELIA_CONSOLIDATION_INTERVAL_HOURS || '4', 10
);

/** 保留旧常量用于向后兼容 */
const _CONSOLIDATION_HOUR_UTC = parseInt(
  process.env.CECELIA_CONSOLIDATION_HOUR_UTC || '19', 10
);

/** 时间窗口宽度（分钟） */
const TRIGGER_WINDOW_MINUTES = 5;

// ─── 公开 API ────────────────────────────────────────────────────────────────

/**
 * 组合入口：基于 elapsed time 判断是否需要运行 → 按需运行。
 * 供 tick.js 每次 tick 时调用（fire-and-forget）。
 * @param {import('pg').Pool} pool
 * @param {Date} [now] - 注入用于测试
 * @returns {Promise<object>}
 */
export async function runDailyConsolidationIfNeeded(pool, now = new Date()) {
  const check = await shouldRunByElapsed(pool, now, CONSOLIDATION_INTERVAL_HOURS);
  if (!check.shouldRun) {
    return {
      skipped: true,
      reason: check.reason,
      last_run: check.last_run,
      hours_elapsed: check.hours_elapsed,
    };
  }
  return runDailyConsolidation(pool, { now });
}

/**
 * 判断"距上次合并已过去 ≥ intervalHours"，是当前唯一的真实闸门。
 *
 * 查询 memory_stream（与 capability-probe 同源），保证：
 *   - 探针看到 last_run=never 时本函数也会返回 shouldRun=true（自愈触发）。
 *   - 探针看到 last_run=<recent>（48h 内有记录）时，本函数按 intervalHours 判断。
 *
 * @param {import('pg').Pool} pool
 * @param {Date} [now] - 注入用于测试
 * @param {number} [intervalHours] - 触发间隔小时数（默认 CONSOLIDATION_INTERVAL_HOURS）
 * @returns {Promise<{shouldRun:boolean, reason:string, last_run:Date|null, hours_elapsed:number|null}>}
 */
export async function shouldRunByElapsed(pool, now = new Date(), intervalHours = CONSOLIDATION_INTERVAL_HOURS) {
  const { rows } = await pool.query(
    `SELECT max(created_at) AS last_run
     FROM memory_stream
     WHERE source_type = 'daily_consolidation'`
  );
  const lastRun = rows[0]?.last_run ? new Date(rows[0].last_run) : null;

  if (!lastRun) {
    return { shouldRun: true, reason: 'never_run', last_run: null, hours_elapsed: null };
  }

  const hoursElapsed = (now.getTime() - lastRun.getTime()) / (60 * 60 * 1000);
  if (hoursElapsed >= intervalHours) {
    return { shouldRun: true, reason: 'elapsed', last_run: lastRun, hours_elapsed: hoursElapsed };
  }
  return { shouldRun: false, reason: 'too_soon', last_run: lastRun, hours_elapsed: hoursElapsed };
}

/**
 * @deprecated 仅保留向后兼容：旧"窄时间窗口"判断已被 shouldRunByElapsed 取代
 * （参见模块顶部 PROBE_FAIL_CONSOLIDATION 历史故障说明）。
 * @param {Date} [now]
 * @returns {boolean}
 */
export function shouldRunConsolidation(now = new Date()) {
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  return (utcHour % CONSOLIDATION_INTERVAL_HOURS === 0) && utcMinute < TRIGGER_WINDOW_MINUTES;
}

/**
 * @deprecated 仅保留向后兼容：旧"按日去重"已被 shouldRunByElapsed 取代。
 * @param {import('pg').Pool} pool
 * @returns {Promise<boolean>}
 */
export async function hasTodayConsolidation(pool) {
  const today = new Date().toISOString().split('T')[0];
  const { rows } = await pool.query(
    `SELECT id FROM daily_logs
     WHERE date = $1 AND type = 'consolidation'
     LIMIT 1`,
    [today]
  );
  return rows.length > 0;
}

/**
 * 主入口：运行每日合并
 * @param {import('pg').Pool} pool
 * @param {{ forceRun?: boolean, now?: Date }} [opts]
 */
export async function runDailyConsolidation(pool, opts = {}) {
  const { forceRun = false, now = new Date() } = opts;
  const today = now.toISOString().split('T')[0];

  if (!forceRun) {
    const check = await shouldRunByElapsed(pool, now, CONSOLIDATION_INTERVAL_HOURS);
    if (!check.shouldRun) {
      console.log(
        `[consolidation] 跳过：${check.reason} ` +
        `(last_run=${check.last_run?.toISOString() ?? 'never'} ` +
        `hours_elapsed=${check.hours_elapsed?.toFixed(2) ?? 'n/a'})`
      );
      return { skipped: true, reason: check.reason };
    }
  }

  console.log(`[consolidation] 开始每日合并 ${today}...`);

  const { memories, learnings, tasks } = await gatherTodayData(pool);
  const hasData = memories.length > 0 || learnings.length > 0 || tasks.length > 0;

  if (!hasData) {
    console.log('[consolidation] 今日无活动数据，记录空合并');
    const emptySummary = { date: today, note: '今日无活动数据', empty: true };
    // 空合并也写入 memory_stream — 否则 capability-probe 会把"空闲日"误报为
    // PROBE_FAIL_CONSOLIDATION（探针只看 memory_stream 表，importance 调低到 3 区分常规合并）
    await pool.query(
      `INSERT INTO memory_stream (content, importance, memory_type, source_type, expires_at)
       VALUES ($1, 3, 'long', 'daily_consolidation', NOW() + INTERVAL '90 days')`,
      [JSON.stringify(emptySummary)]
    );
    await markConsolidationDone(pool, today, emptySummary);
    return { skipped: false, empty: true };
  }

  // LLM 生成每日摘要
  let summary;
  try {
    const prompt = buildConsolidationPrompt({ memories, learnings, tasks, date: today });
    const raw = await callLLM('cortex', prompt, { maxTokens: 800 });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    summary = jsonMatch ? JSON.parse(jsonMatch[0]) : { date: today, note: raw.slice(0, 500) };
  } catch (err) {
    console.warn('[consolidation] LLM 调用失败:', err.message);
    summary = { date: today, note: 'LLM 调用失败' };
  }

  // 写入情节记忆（type=daily_consolidation，保留 90 天）
  await pool.query(
    `INSERT INTO memory_stream (content, importance, memory_type, source_type, expires_at)
     VALUES ($1, 8, 'long', 'daily_consolidation', NOW() + INTERVAL '90 days')`,
    [JSON.stringify(summary)]
  );

  // 触发 self-model 演化（有洞察时）
  if (summary.self_model_delta?.insight) {
    try {
      await updateSelfModel(summary.self_model_delta.insight, pool);
    } catch (err) {
      console.warn('[consolidation] self-model 更新失败:', err.message);
    }
  }

  // 标记今日已完成
  await markConsolidationDone(pool, today, summary);

  console.log(
    `[consolidation] 完成：${memories.length} 条记忆, ` +
    `${learnings.length} 条学习, ${tasks.length} 个任务`
  );
  return { done: true, summary };
}

// ─── 内部函数 ─────────────────────────────────────────────────────────────────

/**
 * 汇总今日数据
 */
async function gatherTodayData(pool) {
  const today = new Date().toISOString().split('T')[0];

  // 今日 memory_stream（对话/洞察/反思片段）
  const { rows: memories } = await pool.query(
    `SELECT content, source_type, importance, created_at
     FROM memory_stream
     WHERE created_at >= $1::date
       AND source_type IN (
         'chat', 'feishu_chat', 'orchestrator_chat', 'narrative',
         'task_reflection', 'conversation_insight',
         'failure_record', 'user_fact'
       )
     ORDER BY created_at ASC
     LIMIT 30`,
    [today]
  );

  // 今日新增 learnings
  const { rows: learnings } = await pool.query(
    `SELECT title, content, category
     FROM learnings
     WHERE created_at >= $1::date
     ORDER BY created_at ASC
     LIMIT 20`,
    [today]
  );

  // 今日完成/失败任务（tasks 表无 failed_at，失败任务用 updated_at）
  const { rows: tasks } = await pool.query(
    `SELECT title, task_type, status,
            COALESCE(completed_at, updated_at) AS ended_at
     FROM tasks
     WHERE (completed_at >= $1::date OR (status = 'failed' AND updated_at >= $1::date))
       AND status IN ('completed', 'failed')
     ORDER BY COALESCE(completed_at, updated_at) ASC
     LIMIT 20`,
    [today]
  );

  return { memories, learnings, tasks };
}

/**
 * 向 daily_logs 写入今日合并记录
 */
async function markConsolidationDone(pool, date, summary) {
  const existing = await pool.query(
    `SELECT id FROM daily_logs WHERE date = $1 AND type = 'consolidation' LIMIT 1`,
    [date]
  );

  const summaryJson = JSON.stringify(summary);
  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE daily_logs SET summary = $2, agent = 'consolidation' WHERE id = $1`,
      [existing.rows[0].id, summaryJson]
    );
  } else {
    await pool.query(
      `INSERT INTO daily_logs (date, summary, type, agent)
       VALUES ($1, $2, 'consolidation', 'consolidation')`,
      [date, summaryJson]
    );
  }
}

/**
 * 构建 LLM 合并 prompt
 */
function buildConsolidationPrompt({ memories, learnings, tasks, date }) {
  const memText = memories
    .map(m => `[${m.source_type}] ${String(m.content).slice(0, 200)}`)
    .join('\n') || '（无）';

  const learnText = learnings
    .map(l => `- ${l.title}: ${String(l.content).slice(0, 150)}`)
    .join('\n') || '（无）';

  const taskText = tasks
    .map(t => `- [${t.status}] ${t.title} (${t.task_type})`)
    .join('\n') || '（无）';

  return `你是 Cecelia，一个 AI 管家系统。请对今日（${date}）的活动做一次深度综合。

## 今日记忆片段
${memText}

## 今日新增洞察
${learnText}

## 今日任务结果
${taskText}

请以 JSON 格式输出今日综合报告，只输出 JSON，不要任何其他文字：
{
  "date": "${date}",
  "key_events": ["今日最重要的1-3件事"],
  "new_learnings": ["获得的1-3个关键洞察"],
  "completed_goals": ["完成的关键任务摘要（1-3条）"],
  "mood_trajectory": "今日整体工作节奏和情绪走向（1句话）",
  "self_model_delta": {
    "insight": "基于今日活动，对自己能力/认知/角色的新认知（1-2句）"
  }
}`;
}
