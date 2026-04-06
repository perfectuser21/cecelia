#!/usr/bin/env node
/**
 * backfill-publish-logs.js
 *
 * 历史数据补录脚本：将所有已完成的 content_publish 任务写入 zenithjoy.publish_logs。
 *
 * 使用方式：
 *   node packages/brain/scripts/backfill-publish-logs.js
 *   node packages/brain/scripts/backfill-publish-logs.js --dry-run   # 只查询不写入
 *   node packages/brain/scripts/backfill-publish-logs.js --days=7    # 只处理最近 N 天
 *
 * 逻辑：
 *   1. 查询所有 status='completed' AND task_type='content_publish' 的任务
 *   2. 对每个任务：upsert zenithjoy.works，再幂等写入 zenithjoy.publish_logs
 *   3. 已存在的记录跳过（幂等）
 */

import pool from '../src/db.js';

// ─── 配置 ─────────────────────────────────────────────────────────────────────

const VALID_PLATFORMS = ['wechat', 'douyin', 'xiaohongshu', 'zhihu', 'toutiao', 'kuaishou', 'weibo', 'channels'];

const CONTENT_TYPE_MAP = {
  article: 'long_form_article',
  long_form: 'long_form_article',
  long_form_article: 'long_form_article',
  image_text: 'image_text',
  'image-text': 'image_text',
  'solo-company-case': 'image_text',
  video: 'video',
};

// ─── 参数解析 ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const daysArg = args.find(a => a.startsWith('--days='));
const DAYS = daysArg ? parseInt(daysArg.split('=')[1], 10) : null;

if (DRY_RUN) console.log('[backfill] DRY RUN 模式：只查询，不写入');
if (DAYS) console.log(`[backfill] 只处理最近 ${DAYS} 天的任务`);

// ─── 主逻辑 ──────────────────────────────────────────────────────────────────

async function backfill() {
  let processed = 0;
  let skipped = 0;
  let inserted = 0;
  let errors = 0;

  try {
    // 1. 查询所有已完成的 content_publish 任务
    const dateFilter = DAYS
      ? `AND completed_at >= NOW() - INTERVAL '${DAYS} days'`
      : '';

    const { rows: tasks } = await pool.query(
      `SELECT id, title, payload, completed_at
       FROM tasks
       WHERE task_type = 'content_publish'
         AND status = 'completed'
         ${dateFilter}
       ORDER BY completed_at ASC`
    );

    console.log(`[backfill] 找到 ${tasks.length} 个已完成的 content_publish 任务`);

    for (const task of tasks) {
      processed++;
      const { platform, pipeline_keyword, parent_pipeline_id, content_type } = task.payload || {};

      // 跳过无 platform 或 platform 不合法的任务
      if (!platform) {
        console.warn(`[backfill] task=${task.id} 无 platform，跳过`);
        skipped++;
        continue;
      }
      if (!VALID_PLATFORMS.includes(platform)) {
        console.warn(`[backfill] task=${task.id} platform='${platform}' 不在枚举，跳过`);
        skipped++;
        continue;
      }

      const normalizedContentType = CONTENT_TYPE_MAP[content_type] || 'image_text';
      const workTitle = pipeline_keyword || `pipeline:${parent_pipeline_id || task.id}`;
      const contentId = parent_pipeline_id || task.id;

      if (DRY_RUN) {
        console.log(`[backfill][dry] task=${task.id} platform=${platform} contentId=${contentId} title="${workTitle}"`);
        continue;
      }

      try {
        // 2. Upsert zenithjoy.works
        const workUpsert = await pool.query(
          `INSERT INTO zenithjoy.works (content_id, title, content_type, status)
           VALUES ($1, $2, $3, 'published')
           ON CONFLICT (content_id) DO UPDATE SET
             status = 'published',
             updated_at = NOW()
           RETURNING id`,
          [contentId, workTitle, normalizedContentType]
        );
        const workId = workUpsert.rows[0]?.id;
        if (!workId) {
          console.warn(`[backfill] task=${task.id} works upsert 返回空，跳过`);
          skipped++;
          continue;
        }

        // 3. 幂等检查 publish_logs
        const existing = await pool.query(
          `SELECT id FROM zenithjoy.publish_logs WHERE work_id = $1 AND platform = $2`,
          [workId, platform]
        );
        if (existing.rows.length > 0) {
          console.log(`[backfill] work_id=${workId} platform=${platform} 已存在，跳过`);
          skipped++;
          continue;
        }

        // 4. 写入 publish_logs
        const publishedAt = task.completed_at || new Date().toISOString();
        await pool.query(
          `INSERT INTO zenithjoy.publish_logs
             (work_id, platform, status, published_at, response)
           VALUES ($1, $2, 'published', $3, $4)`,
          [
            workId,
            platform,
            publishedAt,
            JSON.stringify({
              task_id: task.id,
              pipeline_keyword: pipeline_keyword || null,
              parent_pipeline_id: parent_pipeline_id || null,
              backfilled: true,
            })
          ]
        );
        inserted++;
        console.log(`[backfill] ✅ 写入 work_id=${workId} platform=${platform} keyword="${pipeline_keyword}" completed_at=${publishedAt}`);
      } catch (rowErr) {
        errors++;
        console.error(`[backfill] ❌ task=${task.id} 写入失败: ${rowErr.message}`);
      }
    }
  } finally {
    await pool.end().catch(() => {});
  }

  console.log(`\n[backfill] 完成：处理=${processed} 写入=${inserted} 跳过=${skipped} 错误=${errors}`);
}

backfill().catch(err => {
  console.error('[backfill] 致命错误:', err.message);
  process.exit(1);
});
