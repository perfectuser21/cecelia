/**
 * daily-real-business-smoke.js
 *
 * 每天凌晨 4:00（北京时间）= UTC 20:00，触发一条真实 content-pipeline：
 * - content_type: solo-company-case
 * - topic: "[E2E daily smoke] YYYY-MM-DD"
 *
 * 目的：防止生产腐蚀（如 NotebookLM auth 断了 1 个月没人发现）。
 *
 * 成功标准：
 * 1. pipeline status = completed
 * 2. content-export stage completed（含 NAS 上传）
 * 3. 图片数量 ≥ 9
 *
 * 失败处理：
 * - 30 min 超时 或 pipeline failed → P0 飞书告警 + 创建 Brain dev task
 * - 记录哪个 stage 失败（research / copywriting / generate / image_review / export）
 *
 * 清理：30 天后自动 archive（加 smoke-archived tag，不污染选题池）
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { raise } from '../alerting.js';

// 触发时间：UTC 20:00 = 北京时间 04:00
export const SMOKE_HOUR_UTC = 20;
// 触发窗口宽度：5 分钟（与 tick 周期对齐）
export const SMOKE_WINDOW_MINUTES = 5;
// 告警超时：30 分钟内未完成则 P0 告警
export const ALERT_TIMEOUT_MS = 30 * 60 * 1000;
// poll 间隔：30 秒
export const POLL_INTERVAL_MS = 30 * 1000;
// 最少图片数
export const MIN_IMAGES = 9;
// 自动 archive 天数
export const ARCHIVE_AFTER_DAYS = 30;

// stage 执行顺序（用于定位失败阶段）
const STAGE_ORDER = [
  'content-research',
  'content-copywriting',
  'content-copy-review',
  'content-generate',
  'content-image-review',
  'content-export',
];

/**
 * 判断当前是否在每日 smoke 触发窗口内（UTC 20:00-20:05）
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isInSmokeWindow(now = new Date()) {
  return now.getUTCHours() === SMOKE_HOUR_UTC && now.getUTCMinutes() < SMOKE_WINDOW_MINUTES;
}

/**
 * 检查今天是否已触发过 daily smoke（幂等保护）
 * @param {import('pg').Pool} db
 * @param {Date} [now]
 * @returns {Promise<boolean>}
 */
export async function hasTodaySmoke(db, now = new Date()) {
  const dateStr = now.toISOString().slice(0, 10);
  const { rows } = await db.query(
    `SELECT id FROM tasks
     WHERE trigger_source = 'brain_cron_daily_smoke'
       AND created_at >= $1::date::timestamptz
       AND created_at <  ($1::date + INTERVAL '1 day')::timestamptz
     LIMIT 1`,
    [dateStr]
  );
  return rows.length > 0;
}

/**
 * 创建每日 smoke pipeline 任务（ZJ pipeline-worker 将在 60s 内拉取执行）
 * @param {import('pg').Pool} db
 * @param {Date} [now]
 * @returns {Promise<string>} task_id
 */
export async function createSmokeTask(db, now = new Date()) {
  const dateStr = now.toISOString().slice(0, 10);
  const topic = `[E2E daily smoke] ${dateStr}`;
  const payload = {
    keyword: topic,
    content_type: 'solo-company-case',
    triggered_by: 'brain_cron_daily_smoke',
    triggered_at: now.toISOString(),
  };

  const { rows } = await db.query(
    `INSERT INTO tasks (
       title, task_type, status, priority,
       created_by, payload, trigger_source,
       location, domain, tags
     )
     VALUES (
       $1, 'content-pipeline', 'queued', 'P1',
       'brain-cron-smoke', $2, 'brain_cron_daily_smoke',
       'us', 'content', ARRAY['daily-smoke', 'e2e']
     )
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [topic, JSON.stringify(payload)]
  );

  if (!rows.length) {
    // ON CONFLICT：当天已存在 smoke，取已有记录
    const existing = await db.query(
      `SELECT id FROM tasks
       WHERE trigger_source = 'brain_cron_daily_smoke'
         AND created_at >= $1::date::timestamptz
         AND created_at <  ($1::date + INTERVAL '1 day')::timestamptz
       LIMIT 1`,
      [dateStr]
    );
    return existing.rows[0]?.id;
  }

  return rows[0].id;
}

/**
 * 查询 pipeline 当前状态
 * @param {import('pg').Pool} db
 * @param {string} taskId
 * @returns {Promise<{status: string, payload: object}|null>}
 */
export async function getPipelineStatus(db, taskId) {
  const { rows } = await db.query(
    `SELECT status, payload FROM tasks WHERE id = $1`,
    [taskId]
  );
  return rows[0] || null;
}

/**
 * 查询 pipeline 所有 stage 子任务
 * @param {import('pg').Pool} db
 * @param {string} taskId
 * @returns {Promise<Record<string, {status: string, summary: string|null}>>}
 */
export async function getPipelineStages(db, taskId) {
  const { rows } = await db.query(
    `SELECT task_type, status, summary
     FROM tasks
     WHERE payload->>'parent_pipeline_id' = $1
     ORDER BY created_at ASC`,
    [taskId]
  );
  const stages = {};
  for (const r of rows) {
    stages[r.task_type] = { status: r.status, summary: r.summary || null };
  }
  return stages;
}

/**
 * 找到第一个 failed 的 stage 名称，否则返回 null
 * @param {Record<string, {status: string}>} stages
 * @returns {string|null}
 */
export function findFailedStage(stages) {
  for (const name of STAGE_ORDER) {
    if (stages[name]?.status === 'failed') return name;
  }
  return null;
}

/**
 * 断言 pipeline 产出：export stage 完成（含 NAS）+ 图片 ≥ MIN_IMAGES
 * @param {import('pg').Pool} db
 * @param {string} taskId
 * @param {object} payload
 * @returns {Promise<{ok: boolean, imageCount: number, nasOk: boolean, message?: string}>}
 */
export async function assertSmokeOutput(db, taskId, payload) {
  const stages = await getPipelineStages(db, taskId);

  const exportStage = stages['content-export'];
  const nasOk = exportStage?.status === 'completed';

  // 扫描图片文件（逻辑与 output 端点一致）
  const HOME = process.env.HOME || '/Users/administrator';
  const IMAGES_DIR = join(HOME, 'claude-output', 'images');
  const keyword = payload?.keyword || '';
  const topic = keyword
    .replace(/[^a-zA-Z0-9一-鿿]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

  let imageCount = 0;
  if (existsSync(IMAGES_DIR)) {
    const topicNoDash = topic.replace(/-/g, '');
    imageCount = readdirSync(IMAGES_DIR).filter(f => {
      const fl = f.toLowerCase();
      return (
        fl.startsWith(`${topic}-`) ||
        (topicNoDash !== topic && fl.startsWith(`${topicNoDash}-`))
      ) && f.endsWith('.png');
    }).length;
  }

  const enoughImages = imageCount >= MIN_IMAGES;

  if (!nasOk || !enoughImages) {
    const parts = [];
    if (!nasOk) parts.push(`export stage 未完成（status: ${exportStage?.status || 'missing'}）`);
    if (!enoughImages) parts.push(`图片不足（${imageCount}/${MIN_IMAGES}）`);
    return { ok: false, imageCount, nasOk, message: parts.join('；') };
  }

  return { ok: true, imageCount, nasOk };
}

/**
 * 处理 smoke 失败：P0 飞书告警 + 创建 Brain dev task
 * @param {import('pg').Pool} db
 * @param {string} taskId
 * @param {string} reason
 * @param {string|null} failedStage
 */
export async function handleSmokeFailure(db, taskId, reason, failedStage = null) {
  const stageInfo = failedStage ? `，失败阶段：${failedStage}` : '';
  const alertMsg = `每日真业务 E2E smoke 失败（pipeline: ${taskId}）${stageInfo}。${reason}`;

  await raise('P0', 'daily_smoke_failed', alertMsg);

  try {
    const dateStr = new Date().toISOString().slice(0, 10);
    await db.query(
      `INSERT INTO tasks (
         title, task_type, status, priority,
         created_by, payload, trigger_source, location
       )
       VALUES (
         $1, 'dev', 'queued', 'P1',
         'brain-cron-smoke', $2, 'brain_cron_smoke_alert', 'us'
       )`,
      [
        `[smoke-alert] 每日真业务 E2E 失败 ${dateStr}`,
        JSON.stringify({
          pipeline_id: taskId,
          reason,
          failed_stage: failedStage,
          alert_type: 'daily_smoke_failed',
        }),
      ]
    );
    console.log(`[daily-smoke] 已创建告警 dev task，pipeline=${taskId}`);
  } catch (err) {
    console.error('[daily-smoke] 创建告警 task 失败:', err.message);
  }
}

/**
 * 后台轮询 pipeline 完成状态并断言产出（fire-and-forget，不阻塞 tick）
 * @param {import('pg').Pool} db
 * @param {string} taskId
 * @param {object} payload
 * @param {number} [maxWaitMs]
 */
export async function waitAndAssertSmoke(db, taskId, payload, maxWaitMs = ALERT_TIMEOUT_MS) {
  const startAt = Date.now();
  console.log(`[daily-smoke] 开始等待 pipeline=${taskId}（max ${maxWaitMs / 60000} min）`);

  while (Date.now() - startAt < maxWaitMs) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    let row;
    try {
      row = await getPipelineStatus(db, taskId);
    } catch (err) {
      console.warn('[daily-smoke] 查询 pipeline 状态失败:', err.message);
      continue;
    }

    if (!row) {
      console.warn(`[daily-smoke] pipeline ${taskId} 不存在，退出轮询`);
      break;
    }

    if (row.status === 'completed') {
      console.log(`[daily-smoke] pipeline=${taskId} 已完成，断言产出`);
      const assertion = await assertSmokeOutput(db, taskId, payload);
      if (assertion.ok) {
        console.log(`[daily-smoke] ✅ smoke 通过：图片=${assertion.imageCount}，NAS=${assertion.nasOk}`);
      } else {
        await handleSmokeFailure(db, taskId, `产出断言失败：${assertion.message}`, null);
      }
      return;
    }

    if (row.status === 'failed') {
      const stages = await getPipelineStages(db, taskId).catch(() => ({}));
      const failedStage = findFailedStage(stages);
      await handleSmokeFailure(db, taskId, 'pipeline 状态为 failed', failedStage);
      return;
    }

    console.log(`[daily-smoke] pipeline=${taskId} status=${row.status}，继续等待…`);
  }

  // 超时
  const stages = await getPipelineStages(db, taskId).catch(() => ({}));
  const failedStage = findFailedStage(stages);
  await handleSmokeFailure(
    db, taskId,
    `${maxWaitMs / 60000} 分钟内未完成（超时）`,
    failedStage || null
  );
}

/**
 * 将 30 天前的 smoke pipeline 加 smoke-archived tag（不污染选题池）
 * @param {import('pg').Pool} db
 */
export async function archiveOldSmokePipelines(db) {
  const { rowCount } = await db.query(
    `UPDATE tasks
     SET tags = array_append(tags, 'smoke-archived'),
         updated_at = NOW()
     WHERE trigger_source = 'brain_cron_daily_smoke'
       AND created_at < NOW() - INTERVAL '${ARCHIVE_AFTER_DAYS} days'
       AND NOT ('smoke-archived' = ANY(COALESCE(tags, ARRAY[]::text[])))`
  );
  if (rowCount > 0) {
    console.log(`[daily-smoke] Archived ${rowCount} old smoke pipelines`);
  }
}

/**
 * 每日 smoke 调度入口（Tick 末尾 fire-and-forget 调用）
 * @param {import('pg').Pool} db
 * @param {Date} [now]
 * @returns {Promise<{triggered: boolean, skipped_window: boolean, skipped_today: boolean, task_id?: string}>}
 */
export async function runDailySmoke(db, now = new Date()) {
  if (!isInSmokeWindow(now)) {
    return { triggered: false, skipped_window: true, skipped_today: false };
  }

  // 顺带清理旧 smoke（fire-and-forget）
  archiveOldSmokePipelines(db).catch(e =>
    console.warn('[daily-smoke] archive 失败（不阻断）:', e.message)
  );

  try {
    const alreadyRan = await hasTodaySmoke(db, now);
    if (alreadyRan) {
      return { triggered: false, skipped_window: false, skipped_today: true };
    }
  } catch (err) {
    console.warn('[daily-smoke] 去重检查失败（继续执行）:', err.message);
  }

  let taskId;
  try {
    taskId = await createSmokeTask(db, now);
    console.log(`[daily-smoke] 创建 smoke pipeline task=${taskId}`);
  } catch (err) {
    console.error('[daily-smoke] 创建 smoke task 失败:', err.message);
    await raise('P0', 'daily_smoke_create_failed', `每日 smoke 任务创建失败：${err.message}`);
    return { triggered: false, skipped_window: false, skipped_today: false, error: err.message };
  }

  const payload = {
    keyword: `[E2E daily smoke] ${now.toISOString().slice(0, 10)}`,
    content_type: 'solo-company-case',
  };

  // 后台异步轮询断言（不阻塞 tick）
  waitAndAssertSmoke(db, taskId, payload).catch(e =>
    console.error('[daily-smoke] waitAndAssertSmoke 意外错误:', e.message)
  );

  return { triggered: true, skipped_window: false, skipped_today: false, task_id: taskId };
}
