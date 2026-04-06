/**
 * social-media-sync.js
 *
 * 从本机 social_media_raw 数据库同步内容数据到 Brain 的 content_analytics 表。
 *
 * 数据流：
 *   social_media_raw.content_master + content_snapshots
 *   → Brain content_analytics（供周报 ROI 计算 + 选题热度评分使用）
 *
 * 设计原则：
 *   - 幂等：按 (platform, content_id, date) 去重，不重复插入
 *   - fire-and-forget 友好：所有异常内部捕获，不向 tick 抛出
 *   - 轻量：每次最多同步近 N 天数据，避免全量扫描
 *
 * 被调用方：
 *   - tick.js（每 tick 调用 syncSocialMediaData）
 *   - POST /api/brain/analytics/social-media-sync（手动触发）
 */

import pg from 'pg';
import pool from './db.js';
import { bulkWriteContentAnalytics } from './content-analytics.js';

// social_media_raw DB 连接（独立连接池，避免与主 pool 混用）
const rawPool = new pg.Pool({
  host:     process.env.RAW_DB_HOST     || 'localhost',
  database: process.env.RAW_DB_NAME     || 'social_media_raw',
  user:     process.env.RAW_DB_USER     || process.env.USER || 'cecelia',
  password: process.env.RAW_DB_PASSWORD || '',
  port:     parseInt(process.env.RAW_DB_PORT || '5432'),
  connectionTimeoutMillis: 3000,
  max: 3,
});

/** 每次同步最多往回查 N 天 */
const SYNC_LOOKBACK_DAYS = 30;

/** 已知平台列表（用于覆盖状态检查） */
export const KNOWN_PLATFORMS = [
  'douyin',
  'kuaishou',
  'xiaohongshu',
  'toutiao',
  'weibo',
  'zhihu',
  'channels',
  'wechat',
];

/**
 * 从 social_media_raw 读取最近 SYNC_LOOKBACK_DAYS 天的内容快照。
 *
 * @returns {Promise<Array<{platform, content_id, title, publish_time, views, likes, comments, shares}>>}
 */
async function fetchRawSnapshots() {
  const since = new Date(Date.now() - SYNC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const { rows } = await rawPool.query(
    `SELECT
       m.platform,
       m.id::text                         AS content_id,
       m.title,
       m.publish_time,
       s.views,
       s.likes,
       s.comments,
       s.shares,
       s.snapshot_date
     FROM content_snapshots s
     JOIN content_master m ON s.content_master_id = m.id
     WHERE s.snapshot_date >= $1::date
     ORDER BY s.snapshot_date DESC, m.platform
     LIMIT 2000`,
    [since.toISOString()]
  );
  return rows;
}

/**
 * 检查 content_analytics 中已有哪些 (platform, content_id, date) 组合，用于去重。
 *
 * @param {Array<{platform, content_id, snapshot_date}>} rows
 * @returns {Promise<Set<string>>} - "platform:content_id:date" 格式的已存在集合
 */
async function fetchExistingKeys(rows) {
  if (rows.length === 0) return new Set();

  const tuples = rows.map(r => {
    const d = r.snapshot_date instanceof Date
      ? r.snapshot_date.toISOString().slice(0, 10)
      : String(r.snapshot_date).slice(0, 10);
    return `(${pool.escapeLiteral ? '' : ''}${''}${r.platform}:${r.content_id}:${d}`;
  });

  // 用宽松查询：只查 platform + content_id 存在的记录，date 精度在应用层对比
  const platforms = [...new Set(rows.map(r => r.platform))];
  const contentIds = [...new Set(rows.map(r => String(r.content_id)))];

  const { rows: existing } = await pool.query(
    `SELECT platform, content_id,
            DATE(collected_at AT TIME ZONE 'UTC')::text AS snap_date
     FROM content_analytics
     WHERE platform = ANY($1)
       AND content_id = ANY($2)
       AND source = 'social_media_raw'`,
    [platforms, contentIds]
  );

  const keySet = new Set(existing.map(r => `${r.platform}:${r.content_id}:${r.snap_date}`));
  return keySet;
}

/**
 * 将 social_media_raw 快照批量写入 content_analytics，跳过已存在记录。
 *
 * @param {import('pg').Pool} [dbPool] - 注入用于测试
 * @returns {Promise<{synced: number, skipped: number, source_count: number}>}
 */
export async function syncSocialMediaData(dbPool = pool) {
  let sourceCount = 0;
  let synced = 0;
  let skipped = 0;

  try {
    const rows = await fetchRawSnapshots();
    sourceCount = rows.length;

    if (rows.length === 0) {
      return { synced: 0, skipped: 0, source_count: 0 };
    }

    const existingKeys = await fetchExistingKeys(rows);

    const toWrite = [];
    for (const row of rows) {
      const dateStr = row.snapshot_date instanceof Date
        ? row.snapshot_date.toISOString().slice(0, 10)
        : String(row.snapshot_date).slice(0, 10);
      const key = `${row.platform}:${row.content_id}:${dateStr}`;

      if (existingKeys.has(key)) {
        skipped++;
        continue;
      }

      toWrite.push({
        platform:    row.platform,
        contentId:   String(row.content_id),
        title:       row.title || null,
        publishedAt: row.publish_time || null,
        metrics: {
          views:    Number(row.views)    || 0,
          likes:    Number(row.likes)    || 0,
          comments: Number(row.comments) || 0,
          shares:   Number(row.shares)   || 0,
          clicks:   0,
        },
        source:    'social_media_raw',
        pipelineId: null,
        rawData:   { snapshot_date: dateStr },
      });
    }

    if (toWrite.length > 0) {
      synced = await bulkWriteContentAnalytics(dbPool, toWrite);
    }

    console.log(`[social-media-sync] 同步完成: source=${sourceCount} synced=${synced} skipped=${skipped}`);
  } catch (err) {
    // social_media_raw 不存在或连接失败时静默处理（环境可能没有该 DB）
    if (err.message?.includes('does not exist') || err.code === 'ECONNREFUSED' || err.code === '3D000') {
      // 不打印警告，这是正常的（DB 尚未有数据时）
    } else {
      console.warn(`[social-media-sync] 同步失败: ${err.message}`);
    }
  }

  return { synced, skipped, source_count: sourceCount };
}

/**
 * 查询各平台在 content_analytics 中的最后采集时间和数据量。
 * 用于"采集覆盖状态"端点和选题引擎感知。
 *
 * @param {import('pg').Pool} [dbPool]
 * @returns {Promise<Array<{platform, content_count, last_collected_at, has_data: boolean}>>}
 */
export async function getCollectionCoverage(dbPool = pool) {
  const { rows } = await dbPool.query(
    `SELECT
       platform,
       COUNT(*)::int                  AS content_count,
       MAX(collected_at)              AS last_collected_at,
       MAX(collected_at) > NOW() - INTERVAL '7 days' AS is_fresh
     FROM content_analytics
     GROUP BY platform`
  );

  // 构建已有平台 Map
  const coverageMap = new Map(rows.map(r => [r.platform, r]));

  // 补全未有数据的已知平台
  const result = KNOWN_PLATFORMS.map(platform => {
    const r = coverageMap.get(platform);
    return {
      platform,
      content_count:    r ? Number(r.content_count) : 0,
      last_collected_at: r ? r.last_collected_at : null,
      is_fresh:          r ? Boolean(r.is_fresh) : false,
      has_data:          Boolean(r && r.content_count > 0),
    };
  });

  // 加入未知平台（不在 KNOWN_PLATFORMS 里但 DB 有数据的）
  for (const [platform, r] of coverageMap) {
    if (!KNOWN_PLATFORMS.includes(platform)) {
      result.push({
        platform,
        content_count:    Number(r.content_count),
        last_collected_at: r.last_collected_at,
        is_fresh:          Boolean(r.is_fresh),
        has_data:          true,
      });
    }
  }

  return result;
}
