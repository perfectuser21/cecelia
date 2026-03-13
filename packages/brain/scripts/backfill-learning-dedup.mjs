/**
 * backfill-learning-dedup.mjs
 *
 * 历史 learning 聚合去重：将 learnings 表中重复的 failure_pattern 按 error_type 归并。
 *
 * 策略：
 *   - 只处理 category = 'failure_pattern' 的记录
 *   - 按 error_type（从 content 中推断）分组
 *   - 每组保留最新一条（representative），其余标记为 digested=true
 *   - representative 的 occurrence_count = 组内总数
 *
 * 运行方式：
 *   node packages/brain/scripts/backfill-learning-dedup.mjs [--dry-run]
 */

import pg from 'pg';
import { config } from 'dotenv';

config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    `postgresql://cecelia:${process.env.DB_PASSWORD || 'cecelia'}@localhost:5432/cecelia`,
});

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * 从 learning content 推断 error_type
 */
function inferErrorType(content = '', title = '') {
  const text = (content + ' ' + title).toLowerCase();
  if (text.includes('oauth') || text.includes('401') || text.includes('unauthorized')) return 'OAUTH_401';
  if (text.includes('403') || text.includes('forbidden')) return 'AUTH_403';
  if (text.includes('rate limit') || text.includes('429')) return 'RATE_LIMIT';
  if (text.includes('timeout') || text.includes('timed out')) return 'TIMEOUT';
  if (text.includes('network') || text.includes('econnrefused') || text.includes('enotfound')) return 'NETWORK_ERROR';
  if (text.includes('billing') || text.includes('quota')) return 'QUOTA_EXHAUSTED';
  return null;
}

async function run() {
  console.log(`[backfill] 开始 learning 去重聚合${DRY_RUN ? '（DRY RUN）' : ''}`);

  // 1. 加载所有 failure_pattern 且未 digested 的 learning
  const { rows: learnings } = await pool.query(`
    SELECT id, title, content, created_at, occurrence_count, error_type
    FROM learnings
    WHERE category = 'failure_pattern'
      AND (digested = false OR digested IS NULL)
    ORDER BY created_at DESC
  `);

  console.log(`[backfill] 共找到 ${learnings.length} 条待处理 failure_pattern learning`);

  // 2. 按推断的 error_type 分组
  const groups = new Map(); // error_type -> [records]
  const noType = []; // 无法推断 error_type 的

  for (const row of learnings) {
    const et = row.error_type || inferErrorType(row.content, row.title);
    if (!et) {
      noType.push(row);
      continue;
    }
    if (!groups.has(et)) groups.set(et, []);
    groups.get(et).push(row);
  }

  console.log(`[backfill] 分组结果：${groups.size} 种 error_type，${noType.length} 条无法分类`);

  let totalMerged = 0;
  let totalRepresentatives = 0;

  // 3. 每组：保留最新记录（already sorted desc），其余 digested=true
  for (const [errorType, records] of groups.entries()) {
    if (records.length <= 1) {
      // 单条：仅确保 error_type 字段写入
      const r = records[0];
      if (!r.error_type && !DRY_RUN) {
        await pool.query(
          'UPDATE learnings SET error_type = $1 WHERE id = $2',
          [errorType, r.id]
        );
      }
      continue;
    }

    const representative = records[0]; // 最新
    const duplicates = records.slice(1);
    const totalCount = records.reduce((sum, r) => sum + (r.occurrence_count || 1), 0);

    console.log(`[backfill] error_type=${errorType}: ${records.length} 条 → 保留 ${representative.id}，归并 ${duplicates.length} 条，count=${totalCount}`);

    if (!DRY_RUN) {
      // 更新 representative
      await pool.query(
        `UPDATE learnings
         SET occurrence_count = $1, error_type = $2, updated_at = NOW()
         WHERE id = $3`,
        [totalCount, errorType, representative.id]
      );

      // 标记其余为 digested
      const dupIds = duplicates.map(r => r.id);
      await pool.query(
        `UPDATE learnings SET digested = true, archived = true WHERE id = ANY($1::uuid[])`,
        [dupIds]
      );
    }

    totalMerged += duplicates.length;
    totalRepresentatives += 1;
  }

  console.log(`\n[backfill] 完成！`);
  console.log(`  归并记录数: ${totalMerged}`);
  console.log(`  代表性记录: ${totalRepresentatives}`);
  console.log(`  无法分类: ${noType.length}`);

  if (DRY_RUN) {
    console.log('\n[backfill] ⚠️  DRY RUN 模式，未实际修改数据库');
  }

  await pool.end();
}

run().catch(err => {
  console.error('[backfill] 失败:', err.message);
  process.exit(1);
});
