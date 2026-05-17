/**
 * content-analytics.js
 *
 * 通用内容效果数据读写模块。
 *
 * 数据层：content_analytics 表（时序快照，支持多次采集同一内容）
 *
 * 主要函数：
 *   - writeContentAnalytics()   写入单条采集快照
 *   - queryWeeklyROI()          计算指定周期内容 ROI
 *   - getTopContentByPlatform() 按平台查热门内容
 *   - bulkWriteContentAnalytics() 批量写入（平台爬虫批量回写场景）
 */

/**
 * 写入单条内容效果快照。
 *
 * @param {import('pg').Pool} pool
 * @param {object} params
 * @param {string} params.platform    - 平台名（douyin/xiaohongshu/weibo/wechat 等）
 * @param {string} [params.contentId] - 平台侧内容 ID
 * @param {string} [params.title]     - 内容标题
 * @param {Date|string} [params.publishedAt] - 发布时间
 * @param {object} params.metrics     - { views, likes, comments, shares, clicks }
 * @param {string} [params.source]    - 来源：scraper/api/manual（默认 scraper）
 * @param {string} [params.pipelineId] - 关联流水线 UUID
 * @param {object} [params.rawData]   - 平台原始字段
 * @returns {Promise<string>} 新记录 UUID
 */
export async function writeContentAnalytics(pool, {
  platform,
  contentId,
  title,
  publishedAt,
  metrics = {},
  source = 'scraper',
  pipelineId,
  rawData = {},
}) {
  if (!platform) throw new Error('platform is required');
  const { views = 0, likes = 0, comments = 0, shares = 0, clicks = 0 } = metrics;

  const { rows } = await pool.query(
    `INSERT INTO content_analytics
       (platform, content_id, title, published_at, views, likes, comments, shares, clicks,
        source, pipeline_id, raw_data, collected_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
     RETURNING id`,
    [
      platform,
      contentId || null,
      title || null,
      publishedAt || null,
      views,
      likes,
      comments,
      shares,
      clicks,
      source,
      pipelineId || null,
      JSON.stringify(rawData),
    ]
  );
  return rows[0].id;
}

/**
 * 批量写入多条内容效果快照（平台爬虫批量回写场景）。
 *
 * @param {import('pg').Pool} pool
 * @param {Array<object>} items - 每项同 writeContentAnalytics 的 params
 * @returns {Promise<number>} 写入条数
 */
export async function bulkWriteContentAnalytics(pool, items) {
  if (!Array.isArray(items) || items.length === 0) return 0;

  let count = 0;
  for (const item of items) {
    try {
      await writeContentAnalytics(pool, item);
      count++;
    } catch (err) {
      console.warn(`[content-analytics] bulkWrite 单条失败（跳过）: ${err.message}`);
    }
  }
  return count;
}

/**
 * 计算指定时间范围内的内容 ROI。
 *
 * ROI 定义（简化版）：
 *   - 每平台：总曝光 / 内容条数 = 平均每篇曝光
 *   - 互动率：(点赞 + 评论 + 转发) / 曝光 × 1000 = 千次互动数 (CPM-like)
 *
 * @param {import('pg').Pool} pool
 * @param {Date} start
 * @param {Date} end
 * @returns {Promise<Array<{platform, content_count, total_views, total_likes, total_comments, total_shares, avg_views_per_content, engagement_rate}>>}
 */
export async function queryWeeklyROI(pool, start, end) {
  const { rows } = await pool.query(
    `SELECT
       platform,
       COUNT(*)::int                              AS content_count,
       COALESCE(SUM(views), 0)::bigint            AS total_views,
       COALESCE(SUM(likes), 0)::bigint            AS total_likes,
       COALESCE(SUM(comments), 0)::bigint         AS total_comments,
       COALESCE(SUM(shares), 0)::bigint           AS total_shares,
       CASE WHEN COUNT(*) > 0
         THEN ROUND(COALESCE(SUM(views), 0)::numeric / COUNT(*), 0)
         ELSE 0
       END                                        AS avg_views_per_content,
       CASE WHEN COALESCE(SUM(views), 0) > 0
         THEN ROUND(
           (COALESCE(SUM(likes), 0) + COALESCE(SUM(comments), 0) + COALESCE(SUM(shares), 0))::numeric
           / COALESCE(SUM(views), 0) * 1000,
           2
         )
         ELSE 0
       END                                        AS engagement_rate
     FROM content_analytics
     WHERE collected_at >= $1
       AND collected_at < $2
     GROUP BY platform
     ORDER BY total_views DESC`,
    [start, end]
  );

  return rows.map(r => ({
    platform: r.platform,
    content_count: Number(r.content_count),
    total_views: Number(r.total_views),
    total_likes: Number(r.total_likes),
    total_comments: Number(r.total_comments),
    total_shares: Number(r.total_shares),
    avg_views_per_content: Number(r.avg_views_per_content),
    engagement_rate: Number(r.engagement_rate),
  }));
}

/**
 * 将采集结果写入 pipeline_publish_stats 表（用于话题热度评分）。
 * 多次采集同一发布任务时追加新行（时序快照语义）。
 *
 * @param {import('pg').Pool} pool
 * @param {object} params
 * @param {string} params.publishTaskId - content_publish 任务 ID
 * @param {string|null} [params.pipelineId] - 上游 pipeline ID
 * @param {string} params.platform     - 平台名
 * @param {object} params.metrics      - { views, likes, comments, shares }
 * @returns {Promise<void>}
 */
export async function upsertPipelinePublishStats(pool, { publishTaskId, pipelineId, platform, metrics }) {
  if (!publishTaskId) throw new Error('publishTaskId is required');
  if (!platform) throw new Error('platform is required');
  const { views = 0, likes = 0, comments = 0, shares = 0 } = metrics || {};
  await pool.query(
    `INSERT INTO pipeline_publish_stats
       (pipeline_id, publish_task_id, platform, views, likes, comments, shares, scraped_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [pipelineId || null, publishTaskId, platform, views, likes, comments, shares]
  );
}

/**
 * 获取指定时间范围内按平台分组的热门内容（按曝光量排序）。
 *
 * @param {import('pg').Pool} pool
 * @param {object} [opts]
 * @param {string} [opts.platform]   - 筛选平台
 * @param {Date}   [opts.since]      - 起始时间（默认 7 天前）
 * @param {number} [opts.limit]      - 最多返回条数（默认 10）
 * @returns {Promise<Array<{platform, title, views, likes, comments, shares, collected_at}>>}
 */
export async function getTopContentByPlatform(pool, { platform, since, limit = 10 } = {}) {
  const sinceDate = since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const params = [sinceDate, limit];
  const platformClause = platform ? `AND platform = $3` : '';
  if (platform) params.push(platform);

  const { rows } = await pool.query(
    `SELECT platform, title, content_id, views, likes, comments, shares, collected_at
     FROM content_analytics
     WHERE collected_at >= $1
       ${platformClause}
     ORDER BY views DESC
     LIMIT $2`,
    params
  );
  return rows;
}
