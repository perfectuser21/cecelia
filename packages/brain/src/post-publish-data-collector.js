/**
 * post-publish-data-collector.js
 *
 * 发布后数据回收模块。
 *
 * 设计原则：
 *   - content_publish 任务完成超过 4 小时后，自动触发对应平台 scraper 任务
 *   - scraper 任务通过 Brain 任务队列派发（不直接调脚本）
 *   - 将采集结果写入 pipeline_publish_stats 表
 *   - fire-and-forget 友好：内部捕获所有异常，不抛出
 */

/** scraper 任务类型 */
const SCRAPER_TASK_TYPE = 'platform_scraper';

/**
 * 查询已完成超过 4 小时、尚未触发数据采集的 content_publish 任务。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
async function fetchPendingCollectionTasks(pool) {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.payload, t.completed_at,
            t.payload->>'pipeline_id' AS pipeline_id,
            t.payload->>'platform' AS platform
     FROM tasks t
     WHERE t.task_type = 'content_publish'
       AND t.status = 'completed'
       AND t.completed_at IS NOT NULL
       AND t.completed_at < NOW() - INTERVAL '4 hours'
       AND NOT EXISTS (
         SELECT 1 FROM tasks s
         WHERE s.task_type = $1
           AND s.payload->>'source_publish_task_id' = t.id::text
       )
       AND t.payload->>'pipeline_id' IS NOT NULL
       AND t.payload->>'platform' IS NOT NULL
     ORDER BY t.completed_at ASC
     LIMIT 20`,
    [SCRAPER_TASK_TYPE]
  );
  return rows;
}

/**
 * 派发 platform_scraper 任务到 Brain 任务队列。
 *
 * @param {import('pg').Pool} pool
 * @param {object} publishTask - 原始 content_publish 任务
 */
async function dispatchScraperTask(pool, publishTask) {
  const { id: publishTaskId, pipeline_id: pipelineId, platform } = publishTask;

  await pool.query(
    `INSERT INTO tasks (
       task_type, title, status, priority, payload, created_at, updated_at
     ) VALUES (
       $1, $2, 'queued', 30, $3, NOW(), NOW()
     )`,
    [
      SCRAPER_TASK_TYPE,
      `数据采集: ${platform} pipeline=${pipelineId}`,
      JSON.stringify({
        platform,
        pipeline_id: pipelineId,
        source_publish_task_id: publishTaskId,
        triggered_by: 'post-publish-data-collector',
      }),
    ]
  );
}

/**
 * 将 scraper 采集结果写入 pipeline_publish_stats 表。
 *
 * @param {import('pg').Pool} pool
 * @param {object} params
 * @param {string} params.pipelineId
 * @param {string} params.publishTaskId
 * @param {string} params.platform
 * @param {object} params.metrics - { views, likes, comments, shares }
 */
export async function writePipelinePublishStats(pool, { pipelineId, publishTaskId, platform, metrics }) {
  const { views = 0, likes = 0, comments = 0, shares = 0 } = metrics || {};
  await pool.query(
    `INSERT INTO pipeline_publish_stats
       (pipeline_id, publish_task_id, platform, views, likes, comments, shares, scraped_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [pipelineId, publishTaskId, platform, views, likes, comments, shares]
  );
}

/**
 * 每 tick 调用：扫描已完成 content_publish 任务，触发数据采集任务。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{scheduled: number}>}
 */
export async function schedulePostPublishCollection(pool) {
  let scheduled = 0;

  try {
    const tasks = await fetchPendingCollectionTasks(pool);

    for (const task of tasks) {
      try {
        await dispatchScraperTask(pool, task);
        scheduled++;
        console.log(`[post-publish-collector] 已派发采集任务: ${task.platform} pipeline=${task.pipeline_id}`);
      } catch (err) {
        console.error(`[post-publish-collector] 派发任务失败 ${task.id}: ${err.message}`);
      }
    }

    if (scheduled > 0) {
      console.log(`[post-publish-collector] 本轮共派发 ${scheduled} 个采集任务`);
    }
  } catch (err) {
    console.error(`[post-publish-collector] 扫描异常: ${err.message}`);
  }

  return { scheduled };
}
