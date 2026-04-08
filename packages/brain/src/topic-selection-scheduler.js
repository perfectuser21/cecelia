/**
 * topic-selection-scheduler.js
 *
 * 每日内容选题调度器。
 * 每次 Tick 末尾调用 triggerDailyTopicSelection()，内部判断是否到达每日触发时间（01:00 UTC = 09:00 北京时间）。
 * 如果是，则调用 topic-selector.js 生成选题，并为每个选题创建 content-pipeline task。
 *
 * 触发窗口：UTC 01:00 - 12:00（北京时间 09:00 - 20:00）
 *   - 首选窗口：UTC 01:00（北京 09:00），正常触发
 *   - 补偿窗口：UTC 01:00-12:00，任何 tick 均可触发，由 hasTodayTopics 负责幂等
 *   - 超过 UTC 12:00（北京 20:00）则不再补偿（避免夜间触发）
 * 去重策略：同一天内已有 payload.trigger_source = daily_topic_selection 的 content-pipeline task → 跳过
 * 限流：每日最多创建 MAX_DAILY_TOPICS 条 content-pipeline tasks
 */

import { generateTopics } from './topic-selector.js';
import { saveSuggestions } from './topic-suggestion-manager.js';
import { sampleTopics } from './content-types/ai-solopreneur-topic-library.js';

// ─── 常量 ────────────────────────────────────────────────────────────────────

/**
 * 禁用开关：false = AI 自动选题已启用（内容生成引擎 v1）。
 * 启用条件：solo-company-case.yaml 已配置 NotebookLM notebook_id，
 * 主题库（ai-solopreneur-topic-library.js）提供精选种子词保证选题质量。
 */
const DISABLED = false;

/** 每日触发时间（UTC 小时）= 北京时间 09:00 */
const DAILY_TOPIC_HOUR_UTC = 1;

/** 补偿窗口截止时间（UTC 小时）= 北京时间 20:00。超过此时间不再补偿生成 */
const DAILY_TOPIC_CATCHUP_CUTOFF_UTC = 12;

/** 每日最少创建的 content-pipeline tasks 数量（对应 KR 目标：≥5条） */
const MIN_DAILY_TOPICS = 5;

/** 每日最多创建的 content-pipeline tasks 数量 */
const MAX_DAILY_TOPICS = 5;

/** 每日从主题库注入 LLM Prompt 的种子词数量 */
const SEED_TOPIC_COUNT = 5;

/** KR goal_id：内容生成 KR（AI每天产出≥5条内容）
 * 通过 SELECT id FROM key_results WHERE status='active' AND title ILIKE '%内容生成%' 验证
 */
const CONTENT_KR_GOAL_ID = '65b4142d-242b-457d-abfa-c0c38037f1e9';

// ─── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 每日选题触发器。由 tick.js 在每次 Tick 末尾调用。
 *
 * @param {import('pg').Pool} pool - PostgreSQL 连接池
 * @param {Date} [now] - 当前时间（测试时可注入）
 * @returns {Promise<{triggered: number, skipped: boolean, skipped_window: boolean}>}
 */
export async function triggerDailyTopicSelection(pool, now = new Date()) {
  if (DISABLED) {
    return { triggered: 0, skipped: false, skipped_window: true, disabled: true };
  }

  // 1. 判断是否在触发窗口内
  if (!isInTriggerWindow(now)) {
    return { triggered: 0, skipped: false, skipped_window: true };
  }

  // 2. 检查今天是否已经生成过
  if (await hasTodayTopics(pool)) {
    return { triggered: 0, skipped: true, skipped_window: false };
  }

  // 3. 从主题库抽取种子词，注入 LLM Prompt 保证选题质量
  const seedTopics = sampleTopics(SEED_TOPIC_COUNT);
  const seedKeywords = seedTopics.map(t => t.keyword);
  console.log(`[topic-selection-scheduler] 今日种子词: ${seedKeywords.join('、')}`);

  // 4. 生成选题（种子词注入 LLM，引导方向）
  let topics;
  try {
    topics = await generateTopics(pool, seedKeywords);
  } catch (err) {
    console.error('[topic-selection-scheduler] generateTopics 失败:', err.message);
    return { triggered: 0, skipped: false, skipped_window: false, error: err.message };
  }

  if (!topics || topics.length === 0) {
    console.warn('[topic-selection-scheduler] 未生成任何选题，跳过任务创建');
    return { triggered: 0, skipped: false, skipped_window: false };
  }

  // 5. 限流：取 MIN_DAILY_TOPICS～MAX_DAILY_TOPICS 个，确保 ≥5 条
  const toCreate = topics.slice(0, MAX_DAILY_TOPICS);

  // 6. 将全部选题存入推荐队列（pending，2h 后自动晋级创建 content-pipeline task）
  const today = toDateString(now);
  const savedSuggestions = await saveSuggestions(pool, toCreate, today).catch(err => {
    console.warn('[topic-selection-scheduler] saveSuggestions 失败:', err.message);
    return 0;
  });
  console.log(`[topic-selection-scheduler] 已推荐 ${savedSuggestions} 个选题待审核（2h 后自动晋级，目标≥${MIN_DAILY_TOPICS}条）`);

  // 剩余选题（saveSuggestions 未入队的）直接进内容队列
  const autoQueue = toCreate.slice(savedSuggestions);
  let created = 0;

  for (const topic of autoQueue) {
    try {
      await createContentPipelineTask(pool, topic, today);
      created++;
    } catch (err) {
      console.error(`[topic-selection-scheduler] 创建任务失败 (${topic.keyword}):`, err.message);
    }
  }

  console.log(`[topic-selection-scheduler] 今日选题完成，推荐队列 ${savedSuggestions} 个（2h自动晋级），直接创建 ${created} 个`);
  return { triggered: created, suggested: savedSuggestions, skipped: false, skipped_window: false };
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

/**
 * 判断当前时间是否在每日触发窗口内。
 * 窗口：UTC 01:00 - 12:00（北京时间 09:00 - 20:00）
 * 幂等保护由 hasTodayTopics() 负责，避免重复触发。
 * @param {Date} now
 * @returns {boolean}
 */
function isInTriggerWindow(now) {
  const utcHour = now.getUTCHours();
  return utcHour >= DAILY_TOPIC_HOUR_UTC && utcHour < DAILY_TOPIC_CATCHUP_CUTOFF_UTC;
}

/**
 * 检查今天是否已经创建过 daily_topic_selection 任务
 * @param {import('pg').Pool} pool
 * @returns {Promise<boolean>}
 */
export async function hasTodayTopics(pool) {
  const { rows } = await pool.query(
    `SELECT id FROM tasks
     WHERE payload->>'trigger_source' = 'daily_topic_selection'
       AND created_at >= CURRENT_DATE::timestamptz
       AND created_at < (CURRENT_DATE + INTERVAL '1 day')::timestamptz
     LIMIT 1`
  );
  return rows.length > 0;
}

/**
 * 为单个选题创建 content-pipeline task
 * @param {import('pg').Pool} pool
 * @param {object} topic - 选题对象
 * @param {string} today - 日期字符串 YYYY-MM-DD
 */
async function createContentPipelineTask(pool, topic, today) {
  const title = `[内容流水线] ${topic.keyword} ${today}`;
  const payload = JSON.stringify({
    pipeline_keyword: topic.keyword,
    content_type: topic.content_type,
    title_candidates: topic.title_candidates,
    hook: topic.hook,
    why_hot: topic.why_hot,
    priority_score: topic.priority_score,
    trigger_source: 'daily_topic_selection',
    selected_date: today,
  });

  await pool.query(
    `INSERT INTO tasks (
       title, task_type, status, priority,
       goal_id, created_by, payload, trigger_source, location, domain
     )
     VALUES (
       $1, 'content-pipeline', 'queued', 'P1',
       $2, 'cecelia-brain', $3, 'brain_auto', 'us', 'content'
     )`,
    [title, CONTENT_KR_GOAL_ID, payload]
  );

  // 同步写入 topic_selection_log（可选，失败不影响主流程）
  try {
    await pool.query(
      `INSERT INTO topic_selection_log
         (selected_date, keyword, content_type, title_candidates, hook, why_hot, priority_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        today,
        topic.keyword,
        topic.content_type,
        JSON.stringify(topic.title_candidates),
        topic.hook,
        topic.why_hot,
        topic.priority_score,
      ]
    );
  } catch (logErr) {
    // topic_selection_log 写入失败不阻断主流程
    console.warn('[topic-selection-scheduler] topic_selection_log 写入失败:', logErr.message);
  }
}

/**
 * 将 Date 格式化为 YYYY-MM-DD
 * @param {Date} date
 * @returns {string}
 */
function toDateString(date) {
  return date.toISOString().split('T')[0];
}
