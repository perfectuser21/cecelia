#!/usr/bin/env node
/**
 * backfill-pending-review.js — 积压清零脚本（FR-10）
 *
 * 消化所有 status='pending_review' 的 capture_atoms：
 * 1. ai_reason LIKE '[triage:%' → 已有分诊标记 → 转 parked（进人工队列）
 * 2. target_type IN ('handoff','learning','issue') 且无 journey 关联 → 转 parked
 * 3. 其余（ai_reason IS NULL 或无标记）→ 保持 pending_review，让下次 triage 自然跑
 *
 * 用法：
 *   node packages/brain/src/scripts/backfill-pending-review.js [--dry-run]
 */

import pg from 'pg';

const { Pool } = pg;
const DRY_RUN = process.argv.includes('--dry-run');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia',
});

async function run() {
  console.log(`[backfill-pending-review] 开始积压清零（dry_run=${DRY_RUN}）`);

  // 记录初始数量
  const beforeResult = await pool.query(
    "SELECT count(*) FROM capture_atoms WHERE status='pending_review'"
  );
  const beforeCount = parseInt(beforeResult.rows[0].count, 10);
  console.log(`[backfill-pending-review] 当前 pending_review 总数: ${beforeCount}`);

  let parkedCount = 0;

  if (!DRY_RUN) {
    // Case 1: ai_reason 含 [triage:] 前缀 → 已有分诊标记，转 parked
    const parkedByTriage = await pool.query(
      `UPDATE capture_atoms
       SET status = 'parked', updated_at = now()
       WHERE status = 'pending_review'
         AND ai_reason LIKE '[triage:%'
       RETURNING id`
    );
    parkedCount += parkedByTriage.rows.length;
    console.log(`[backfill-pending-review] 含 [triage:] 标记转 parked: ${parkedByTriage.rows.length}`);

    // Case 2: target_type 系统产出类型且无 journey 关联 → 转 parked
    const parkedNoJourney = await pool.query(
      `UPDATE capture_atoms
       SET status = 'parked', ai_reason = '[backfill:no_journey]', updated_at = now()
       WHERE status = 'pending_review'
         AND target_type IN ('handoff','learning','issue')
         AND (ai_reason IS NULL OR ai_reason NOT LIKE '[triage:%')
         AND (routed_to_table IS NULL OR routed_to_id IS NULL)
       RETURNING id`
    );
    parkedCount += parkedNoJourney.rows.length;
    console.log(`[backfill-pending-review] 无 journey 关联转 parked: ${parkedNoJourney.rows.length}`);
  } else {
    const dryTriage = await pool.query(
      "SELECT count(*) FROM capture_atoms WHERE status='pending_review' AND ai_reason LIKE '[triage:%'"
    );
    console.log(`[backfill-pending-review] [DRY-RUN] 含 [triage:] 标记将转 parked: ${dryTriage.rows[0].count}`);

    const dryNoJourney = await pool.query(
      `SELECT count(*) FROM capture_atoms
       WHERE status='pending_review'
         AND target_type IN ('handoff','learning','issue')
         AND (ai_reason IS NULL OR ai_reason NOT LIKE '[triage:%')
         AND (routed_to_table IS NULL OR routed_to_id IS NULL)`
    );
    console.log(`[backfill-pending-review] [DRY-RUN] 无 journey 关联将转 parked: ${dryNoJourney.rows[0].count}`);
  }

  // 剩余 pending_review 数量
  const afterResult = await pool.query(
    "SELECT count(*) FROM capture_atoms WHERE status='pending_review'"
  );
  const afterCount = parseInt(afterResult.rows[0].count, 10);

  console.log(`[backfill-pending-review] 完成: 转 parked=${parkedCount}, 剩余 pending_review=${afterCount}`);

  if (afterCount === 0) {
    console.log('[backfill-pending-review] ✓ 积压已全部清零');
  } else {
    console.log(`[backfill-pending-review] ⚠ 仍有 ${afterCount} 条待下次 triage 处理`);
  }

  await pool.end();
}

run().catch(err => {
  console.error(`[backfill-pending-review] 失败: ${err.message}`);
  process.exit(1);
});
