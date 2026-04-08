#!/usr/bin/env node
/**
 * push-scraper-data.js
 *
 * CN Mac mini 平台数据推送脚本。
 *
 * 数据流：
 *   social_media_raw DB（本机）→ POST Brain API /api/brain/analytics/scrape-result
 *
 * 使用方式（在 CN Mac mini 上运行）：
 *   node push-scraper-data.js
 *   RAW_DB_HOST=localhost RAW_DB_NAME=social_media_raw BRAIN_API=http://38.23.47.81:5221 node push-scraper-data.js
 *
 * 环境变量：
 *   RAW_DB_HOST    - social_media_raw DB 主机（默认 localhost）
 *   RAW_DB_NAME    - DB 名称（默认 social_media_raw）
 *   RAW_DB_USER    - DB 用户（默认 $USER）
 *   RAW_DB_PASSWORD - DB 密码（默认空）
 *   RAW_DB_PORT    - DB 端口（默认 5432）
 *   BRAIN_API      - Brain API 基础 URL（默认 http://localhost:5221）
 *   LOOKBACK_DAYS  - 往回查天数（默认 7）
 *   DRY_RUN        - 设为 1 则只打印，不实际推送
 */

import pg from 'pg';
import https from 'node:https';
import http from 'node:http';

const RAW_DB_HOST     = process.env.RAW_DB_HOST     || 'localhost';
const RAW_DB_NAME     = process.env.RAW_DB_NAME     || 'social_media_raw';
const RAW_DB_USER     = process.env.RAW_DB_USER     || process.env.USER || 'cecelia';
const RAW_DB_PASSWORD = process.env.RAW_DB_PASSWORD || '';
const RAW_DB_PORT     = parseInt(process.env.RAW_DB_PORT || '5432');
const BRAIN_API       = process.env.BRAIN_API       || 'http://localhost:5221';
const LOOKBACK_DAYS   = parseInt(process.env.LOOKBACK_DAYS || '7');
const DRY_RUN         = process.env.DRY_RUN === '1';

const rawPool = new pg.Pool({
  host:                   RAW_DB_HOST,
  database:               RAW_DB_NAME,
  user:                   RAW_DB_USER,
  password:               RAW_DB_PASSWORD,
  port:                   RAW_DB_PORT,
  connectionTimeoutMillis: 5000,
  max:                    3,
});

/**
 * 从 social_media_raw 读取近 N 天快照，按平台分组。
 * @returns {Promise<Map<string, Array>>} platform → items[]
 */
async function fetchByPlatform() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const { rows } = await rawPool.query(
    `SELECT
       m.platform,
       m.id::text          AS content_id,
       m.title,
       m.publish_time      AS published_at,
       s.views,
       s.likes,
       s.comments,
       s.shares,
       s.snapshot_date
     FROM content_snapshots s
     JOIN content_master m ON s.content_master_id = m.id
     WHERE s.snapshot_date >= $1::date
     ORDER BY m.platform, s.snapshot_date DESC`,
    [since.toISOString().slice(0, 10)]
  );

  const byPlatform = new Map();
  for (const row of rows) {
    if (!byPlatform.has(row.platform)) {
      byPlatform.set(row.platform, []);
    }
    byPlatform.get(row.platform).push({
      contentId:   row.content_id,
      title:       row.title || null,
      publishedAt: row.published_at || null,
      views:       Number(row.views)    || 0,
      likes:       Number(row.likes)    || 0,
      comments:    Number(row.comments) || 0,
      shares:      Number(row.shares)   || 0,
      rawData:     { snapshot_date: String(row.snapshot_date).slice(0, 10) },
    });
  }

  return byPlatform;
}

/**
 * POST 请求到 Brain API。
 * @param {string} path
 * @param {object} body
 * @returns {Promise<object>}
 */
function postToBrain(path, body) {
  return new Promise((resolve, reject) => {
    const url    = new URL(path, BRAIN_API);
    const data   = JSON.stringify(body);
    const driver = url.protocol === 'https:' ? https : http;

    const req = driver.request(
      {
        hostname: url.hostname,
        port:     url.port || (url.protocol === 'https:' ? 443 : 80),
        path:     url.pathname,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 15000,
      },
      (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, body: raw });
          }
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => reject(new Error('Brain API 请求超时')));
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log(`[push-scraper-data] 启动 | DB=${RAW_DB_HOST}/${RAW_DB_NAME} | Brain=${BRAIN_API} | lookback=${LOOKBACK_DAYS}d | dry_run=${DRY_RUN}`);

  let byPlatform;
  try {
    byPlatform = await fetchByPlatform();
  } catch (err) {
    // 连接失败或表不存在时给出清晰提示
    if (err.code === 'ECONNREFUSED') {
      console.error(`[push-scraper-data] ❌ 无法连接 ${RAW_DB_HOST}:${RAW_DB_PORT} — 请确认在 CN Mac mini 上运行`);
    } else if (err.code === '3D000' || err.message?.includes('does not exist')) {
      console.error(`[push-scraper-data] ❌ 数据库 "${RAW_DB_NAME}" 不存在 — 请先运行平台采集器`);
    } else {
      console.error(`[push-scraper-data] ❌ 读取数据失败: ${err.message}`);
    }
    process.exit(1);
  }

  if (byPlatform.size === 0) {
    console.log('[push-scraper-data] 无近期数据，退出（正常）');
    await rawPool.end();
    return;
  }

  let totalPushed  = 0;
  let totalSkipped = 0;

  for (const [platform, items] of byPlatform) {
    console.log(`[push-scraper-data] ${platform}: ${items.length} 条`);

    if (DRY_RUN) {
      console.log(`  [dry-run] 跳过推送`);
      totalSkipped += items.length;
      continue;
    }

    try {
      const { status, body } = await postToBrain('/api/brain/analytics/scrape-result', {
        platform,
        items,
      });

      if (status === 201) {
        console.log(`  ✅ 推送成功: written=${body.written}`);
        totalPushed += body.written || 0;
      } else {
        console.warn(`  ⚠️  Brain 返回 ${status}: ${JSON.stringify(body)}`);
        totalSkipped += items.length;
      }
    } catch (err) {
      console.error(`  ❌ 推送失败: ${err.message}`);
      totalSkipped += items.length;
    }
  }

  await rawPool.end();

  console.log(`[push-scraper-data] 完成 | pushed=${totalPushed} skipped=${totalSkipped}`);
}

main().catch(err => {
  console.error('[push-scraper-data] 未捕获异常:', err.message);
  process.exit(1);
});
