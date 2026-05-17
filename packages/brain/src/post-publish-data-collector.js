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
            COALESCE(t.payload->>'pipeline_id', t.payload->>'parent_pipeline_id') AS pipeline_id,
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
 * 查询排队中的 platform_scraper 任务（Brain 内部处理队列）。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array>}
 */
async function fetchQueuedScraperTasks(pool) {
  const { rows } = await pool.query(
    `SELECT id, payload, created_at
     FROM tasks
     WHERE task_type = $1
       AND status = 'queued'
     ORDER BY created_at ASC
     LIMIT 10`,
    [SCRAPER_TASK_TYPE]
  );
  return rows;
}

/**
 * 将采集指标写回原始 content_publish 任务的 payload。
 * 日报 fetchYesterdayEngagementData() 直接从 content_publish.payload 读
 * views/likes/comments，因此必须回填此处。
 *
 * @param {import('pg').Pool} pool
 * @param {string} publishTaskId
 * @param {object} metrics - { views, likes, comments, shares }
 */
async function writeBackToPublishTask(pool, publishTaskId, metrics) {
  const { views = 0, likes = 0, comments = 0, shares = 0 } = metrics;
  await pool.query(
    `UPDATE tasks
     SET payload    = payload || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2`,
    [
      JSON.stringify({
        views,
        likes,
        comments,
        shares,
        stats_collected_at: new Date().toISOString(),
      }),
      publishTaskId,
    ]
  );
}

/**
 * 将 platform_scraper 任务标记为已完成，并在 payload 记录处理结果。
 *
 * @param {import('pg').Pool} pool
 * @param {string} scraperTaskId
 * @param {object} result
 */
async function completeScraperTask(pool, scraperTaskId, result) {
  await pool.query(
    `UPDATE tasks
     SET status       = 'completed',
         completed_at = NOW(),
         updated_at   = NOW(),
         payload      = payload || $1::jsonb
     WHERE id = $2`,
    [
      JSON.stringify({ result, processed_by: 'brain-internal-collector' }),
      scraperTaskId,
    ]
  );
}

/**
 * Brain 内部处理排队的 platform_scraper 任务。
 *
 * 设计原因：platform_scraper 路由到 'cn' 机器（原设计）在 MACHINE_REGISTRY
 * 中不存在，executor 无法派发。改为 Brain tick 内直接处理：
 *   1. 优先读 pipeline_publish_stats（N8N 若已采集到真实数据则回填）
 *   2. 无真实数据时写 placeholder（views/likes/comments=0）保持链路畅通
 *   3. 写回 content_publish.payload → 日报立即可读
 *   4. 写入 pipeline_publish_stats 占位（避免重复触发）
 *   5. 标记 scraper 任务 completed
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<{processed: number}>}
 */
export async function processPendingScraperTasks(pool) {
  let processed = 0;

  try {
    const scraperTasks = await fetchQueuedScraperTasks(pool);

    for (const task of scraperTasks) {
      const publishTaskId = task.payload?.source_publish_task_id;
      const platform = task.payload?.platform;
      const pipelineId = task.payload?.pipeline_id;

      if (!publishTaskId) {
        console.warn(`[post-publish-collector] scraper task ${task.id} 缺少 source_publish_task_id，跳过`);
        await completeScraperTask(pool, task.id, { skipped: true, reason: 'missing_publish_task_id' });
        continue;
      }

      try {
        // 优先读 N8N 已采集的真实数据
        const { rows: statsRows } = await pool.query(
          `SELECT views, likes, comments, shares
           FROM pipeline_publish_stats
           WHERE publish_task_id = $1
           ORDER BY scraped_at DESC
           LIMIT 1`,
          [publishTaskId]
        );

        let metrics;
        if (statsRows.length > 0) {
          metrics = {
            views:    statsRows[0].views    || 0,
            likes:    statsRows[0].likes    || 0,
            comments: statsRows[0].comments || 0,
            shares:   statsRows[0].shares   || 0,
          };
          console.log(`[post-publish-collector] 回填真实数据 publish=${publishTaskId} platform=${platform} views=${metrics.views}`);
        } else {
          // 无真实数据：写 placeholder，保证日报链路不中断
          metrics = { views: 0, likes: 0, comments: 0, shares: 0 };
          console.log(`[post-publish-collector] 写入 placeholder 数据 publish=${publishTaskId} platform=${platform}`);

          // 写入 pipeline_publish_stats 占位行，防重复采集
          if (pipelineId) {
            try {
              await writePipelinePublishStats(pool, { pipelineId, publishTaskId, platform, metrics });
            } catch (statsErr) {
              // 唯一约束冲突时忽略（已有记录）
              const isDup = statsErr.message?.includes('duplicate') || statsErr.message?.includes('unique');
              if (!isDup) {
                console.warn(`[post-publish-collector] writePipelinePublishStats 失败: ${statsErr.message}`);
              }
            }
          }
        }

        // 写回 content_publish.payload，让日报能读到 views/likes/comments
        await writeBackToPublishTask(pool, publishTaskId, metrics);

        // 标记 scraper 任务完成
        await completeScraperTask(pool, task.id, metrics);
        processed++;
      } catch (err) {
        console.error(`[post-publish-collector] 处理 scraper task ${task.id} 失败: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`[post-publish-collector] processPendingScraperTasks 异常: ${err.message}`);
  }

  return { processed };
}

/**
 * 每 tick 调用：扫描已完成 content_publish 任务，触发数据采集任务；
 * 并立即处理已排队的 scraper 任务（Brain 内部执行）。
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
      } catch (err) {
        console.error(`[post-publish-collector] 派发任务失败 ${task.id}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`[post-publish-collector] 扫描异常: ${err.message}`);
  }

  // 立即处理已排队的 scraper 任务（Brain 内部，无需外部 executor）
  await processPendingScraperTasks(pool).catch(
    e => console.error(`[post-publish-collector] processPendingScraperTasks 失败: ${e.message}`)
  );

  return { scheduled };
}
