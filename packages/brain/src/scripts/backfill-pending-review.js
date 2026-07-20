#!/usr/bin/env node
/**
 * backfill-pending-review.js — 消化 pending_review 积压（一次性）
 * FR-10: 积压清零
 */
import pool from '../db.js';

async function main() {
  console.log('[backfill] 开始消化 pending_review 积压...');

  // 1. 记录积压数
  const { rows: before } = await pool.query(
    `SELECT count(*) FROM capture_atoms WHERE status='pending_review'`
  );
  console.log(`[backfill] 运行前 pending_review: ${before[0].count}`);

  // 2. 已有 [triage:] 前缀标记 → 转 parked（进人工队列）
  const { rows: parked } = await pool.query(
    `UPDATE capture_atoms
     SET status = 'parked', updated_at = now()
     WHERE status = 'pending_review'
       AND (ai_reason LIKE '[triage:%' OR ai_reason LIKE '[aging:%')
     RETURNING id`
  );
  console.log(`[backfill] 转 parked: ${parked.length} 条`);

  // 3. no_journey / low_confidence 标记 → 转 parked
  const { rows: parked2 } = await pool.query(
    `UPDATE capture_atoms
     SET status = 'parked', updated_at = now()
     WHERE status = 'pending_review'
       AND (ai_reason LIKE '%no_journey%' OR ai_reason LIKE '%low_confidence%')
     RETURNING id`
  );
  console.log(`[backfill] no_journey/low_confidence 转 parked: ${parked2.length} 条`);

  // 4. 剩余 pending_review（ai_reason IS NULL 或无 triage 前缀）→ 保持，让 triage 自然处理
  // 不动，等 triage 自然跑

  // 5. 触发一次 capture-triage 运行
  try {
    const { runCaptureTriage } = await import('../capture-triage.js');
    const result = await runCaptureTriage(pool);
    console.log('[backfill] capture-triage 运行结果:', result);
  } catch (err) {
    console.warn('[backfill] capture-triage 调用失败（非致命）:', err.message);
  }

  const { rows: after } = await pool.query(
    `SELECT count(*) FROM capture_atoms WHERE status='pending_review'`
  );
  console.log(`[backfill] 运行后 pending_review: ${after[0].count}`);

  const { rows: parkedCount } = await pool.query(
    `SELECT count(*) FROM capture_atoms WHERE status='parked'`
  );
  console.log(`[backfill] 当前 parked: ${parkedCount[0].count}`);

  await pool.end();
  console.log('[backfill] 完成');
}

main().catch(err => {
  console.error('[backfill] 失败:', err);
  process.exit(1);
});
