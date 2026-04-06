/**
 * daily-scrape-scheduler.js
 *
 * 每日全平台数据采集调度器。
 *
 * 每次 Tick 末尾调用 scheduleDailyScrape()，内部判断是否到达每日触发时间。
 * 如果是，则为所有8个平台各创建一个 platform_scraper 任务（幂等）。
 *
 * 触发时间：UTC 20:00（北京时间次日 04:00）
 * 幂等机制：同一天同一平台只创建一次 platform_scraper 任务
 *
 * 平台列表：douyin / kuaishou / xiaohongshu / toutiao / toutiao-2 / weibo / channels / gongzhonghao
 */

/** 每日触发小时（UTC）= 北京时间 04:00 次日 */
const DAILY_SCRAPE_HOUR_UTC = 20;

/** 支持的采集平台列表 */
const SCRAPE_PLATFORMS = [
  'douyin',
  'kuaishou',
  'xiaohongshu',
  'toutiao',
  'toutiao-2',
  'weibo',
  'channels',
  'gongzhonghao',
];

/**
 * 判断当前时间是否在每日采集触发窗口内（UTC 20:00 ± 5 分钟）。
 *
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isInDailyScrapeWindow(now = new Date()) {
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  return utcHour === DAILY_SCRAPE_HOUR_UTC && utcMinute < 5;
}

/**
 * 检查今天是否已经为某个平台创建过 platform_scraper 任务。
 *
 * @param {import('pg').Pool} pool
 * @param {string} platform
 * @returns {Promise<boolean>}
 */
async function alreadyScheduledToday(pool, platform) {
  const { rows } = await pool.query(
    `SELECT 1 FROM tasks
     WHERE task_type = 'platform_scraper'
       AND payload->>'platform' = $1
       AND created_at >= NOW() - INTERVAL '20 hours'
     LIMIT 1`,
    [platform]
  );
  return rows.length > 0;
}

/**
 * 为指定平台创建 platform_scraper 任务。
 *
 * @param {import('pg').Pool} pool
 * @param {string} platform
 * @returns {Promise<string>} 新任务 ID
 */
async function createPlatformScraperTask(pool, platform) {
  const { rows } = await pool.query(
    `INSERT INTO tasks (
       task_type, title, status, priority, payload, created_at, updated_at
     ) VALUES (
       'platform_scraper', $1, 'queued', 30, $2, NOW(), NOW()
     ) RETURNING id`,
    [
      `每日采集: ${platform}`,
      JSON.stringify({
        platform,
        triggered_by: 'daily-scrape-scheduler',
        scheduled_at: new Date().toISOString(),
      }),
    ]
  );
  return rows[0].id;
}

/**
 * 每 Tick 调用：判断是否到达每日采集时间，若是则为所有平台创建 platform_scraper 任务。
 *
 * @param {import('pg').Pool} pool
 * @param {object} [opts]
 * @param {boolean} [opts.force] - 强制立即触发（跳过时间窗口检查），用于 API 手动触发
 * @returns {Promise<{scheduled: number, skipped: number, inWindow: boolean}>}
 */
export async function scheduleDailyScrape(pool, { force = false } = {}) {
  const now = new Date();
  const inWindow = isInDailyScrapeWindow(now);

  if (!inWindow && !force) {
    return { scheduled: 0, skipped: 0, inWindow: false };
  }

  let scheduled = 0;
  let skipped = 0;

  for (const platform of SCRAPE_PLATFORMS) {
    try {
      const alreadyDone = await alreadyScheduledToday(pool, platform);
      if (alreadyDone) {
        skipped++;
        continue;
      }
      await createPlatformScraperTask(pool, platform);
      scheduled++;
    } catch (err) {
      console.error(`[daily-scrape-scheduler] 创建 ${platform} 任务失败: ${err.message}`);
    }
  }

  if (scheduled > 0) {
    console.log(`[daily-scrape-scheduler] 每日采集调度完成: scheduled=${scheduled}, skipped=${skipped}`);
  }

  return { scheduled, skipped, inWindow };
}

export { SCRAPE_PLATFORMS };
