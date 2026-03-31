/**
 * post-publish-data-collector.js
 *
 * 发布后数据回收器。
 *
 * 每次 Tick 调用 collectPostPublishData()：
 *   1. 查询已完成 4h+ 且 pipeline_publish_stats 中尚无记录的 content_publish 任务
 *   2. 对每个任务，spawn 对应平台 scraper（fire-and-forget，后台运行）
 *   3. 查询 zenithjoy.publish_logs 中已有的 metrics 写入 pipeline_publish_stats（UPSERT）
 *      （scraper 异步运行，下次 tick 再次写入最新数据）
 *
 * 设计原则：
 *   - fire-and-forget 友好：内部捕获所有异常，不抛出
 *   - 幂等：多次调用结果一致（UPSERT ON CONFLICT）
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

// ─── 常量 ─────────────────────────────────────────────────────────────────────

/** 发布完成后等待采集的延迟（毫秒） */
const COLLECT_DELAY_MS = 4 * 60 * 60 * 1000; // 4 小时

/** scraper 脚本目录 */
const SCRAPER_DIR = '/Users/administrator/perfect21/zenithjoy/workflows/platform-data/workflows/scraper/scripts';

/** 平台 → scraper 脚本文件名映射 */
const SCRAPER_MAP = {
  douyin: 'scraper-douyin-v3.js',
  kuaishou: 'scraper-kuaishou-v3.js',
  xiaohongshu: 'scraper-xiaohongshu-v3.js',
  toutiao: 'scraper-toutiao-v3.js',
  weibo: 'scraper-weibo-v3.js',
  zhihu: 'scraper-zhihu-v8-api.js',
  channels: 'scraper-channels-v3.js',
  wechat: 'scraper-wechat-v3.js',
};

// ─── DB 查询 ──────────────────────────────────────────────────────────────────

/**
 * 查询已完成 4h+ 且尚未采集（pipeline_publish_stats 无记录）的 content_publish 任务。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
async function fetchUncollectedPublishTasks(pool) {
  const { rows } = await pool.query(
    `SELECT t.id, t.payload, t.completed_at
     FROM tasks t
     WHERE t.task_type = 'content_publish'
       AND t.status = 'completed'
       AND t.completed_at IS NOT NULL
       AND t.completed_at < NOW() - INTERVAL '4 hours'
       AND t.payload->>'pipeline_id' IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_publish_stats pps
         WHERE pps.pipeline_id = (t.payload->>'pipeline_id')::uuid
           AND pps.platform = t.payload->>'platform'
       )
     ORDER BY t.completed_at ASC
     LIMIT 10`
  );
  return rows;
}

/**
 * 查询 zenithjoy.publish_logs 中指定 pipeline 的最新 metrics。
 *
 * @param {import('pg').Pool} pool
 * @param {string} pipelineId
 * @param {string} platform
 * @returns {Promise<object|null>}
 */
async function fetchPublishMetrics(pool, pipelineId, platform) {
  try {
    const { rows } = await pool.query(
      `SELECT metrics, platform_post_id
       FROM zenithjoy.publish_logs
       WHERE work_id = $1
         AND platform = $2
         AND metrics IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [pipelineId, platform]
    );
    if (rows.length === 0) return null;
    return rows[0];
  } catch (_err) {
    // zenithjoy schema 可能不存在（开发环境）
    return null;
  }
}

/**
 * 将 metrics 写入 pipeline_publish_stats（UPSERT）。
 *
 * @param {import('pg').Pool} pool
 * @param {object} params
 */
async function upsertStats(pool, { pipelineId, publishTaskId, platform, metrics }) {
  const views = metrics?.views || metrics?.play_count || metrics?.read_count || 0;
  const likes = metrics?.likes || metrics?.like_count || metrics?.digg_count || 0;
  const comments = metrics?.comments || metrics?.comment_count || 0;
  const shares = metrics?.shares || metrics?.share_count || metrics?.forward_count || 0;

  await pool.query(
    `INSERT INTO pipeline_publish_stats
       (pipeline_id, publish_task_id, platform, views, likes, comments, shares, scraped_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (pipeline_id, platform)
     DO UPDATE SET
       views = EXCLUDED.views,
       likes = EXCLUDED.likes,
       comments = EXCLUDED.comments,
       shares = EXCLUDED.shares,
       scraped_at = NOW()`,
    [pipelineId, publishTaskId, platform, views, likes, comments, shares]
  );
}

// ─── Scraper 调用 ─────────────────────────────────────────────────────────────

/**
 * 后台 spawn scraper 脚本（fire-and-forget）。
 *
 * @param {string} platform
 */
function spawnScraper(platform) {
  const scriptFile = SCRAPER_MAP[platform];
  if (!scriptFile) {
    console.warn(`[post-publish-collector] 未知平台 scraper: ${platform}`);
    return;
  }

  const scriptPath = join(SCRAPER_DIR, scriptFile);
  if (!existsSync(scriptPath)) {
    console.warn(`[post-publish-collector] scraper 脚本不存在: ${scriptPath}`);
    return;
  }

  const child = spawn('node', [scriptPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();
  console.log(`[post-publish-collector] 已后台启动 scraper: ${platform} (pid=${child.pid})`);
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

/**
 * 发布后数据回收主函数。
 * 每次 Tick 调用，内部捕获所有异常。
 *
 * @param {import('pg').Pool} pool
 */
export async function collectPostPublishData(pool) {
  try {
    const tasks = await fetchUncollectedPublishTasks(pool);
    if (tasks.length === 0) return;

    for (const task of tasks) {
      const platform = task.payload?.platform;
      const pipelineId = task.payload?.pipeline_id;

      if (!platform || !pipelineId) continue;

      // 1. 查询已有 metrics（scraper 之前可能已写入）
      const logRow = await fetchPublishMetrics(pool, pipelineId, platform);

      if (logRow?.metrics) {
        // 有 metrics 则写入 DB
        try {
          await upsertStats(pool, {
            pipelineId,
            publishTaskId: task.id,
            platform,
            metrics: logRow.metrics,
          });
          console.log(`[post-publish-collector] 已写入 ${platform} stats for pipeline ${pipelineId}`);
        } catch (upsertErr) {
          console.warn(`[post-publish-collector] upsert 失败 (${platform}): ${upsertErr.message}`);
        }
      }

      // 2. 后台 spawn scraper（下次 tick 再读取最新数据）
      spawnScraper(platform);
    }
  } catch (err) {
    console.warn('[post-publish-collector] 整体失败:', err.message);
  }
}
