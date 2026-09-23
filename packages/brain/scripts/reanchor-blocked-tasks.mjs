#!/usr/bin/env node
// packages/brain/scripts/reanchor-blocked-tasks.mjs
// 一次性回填：把因 map_revision_mismatch 自动停车的任务解锁并清零连续失败计数，
// 快进本身交给下次派发的预检完成（任务 d9c405e2）。不做定时 job（会与 map_recovery 类任务形成 churn）。
//   node packages/brain/scripts/reanchor-blocked-tasks.mjs [--dry-run]
import pool from '../src/db.js';
import { unblockTask } from '../src/task-updater.js';

const dryRun = process.argv.includes('--dry-run');

const { rows } = await pool.query(
  `SELECT id, title, blocked_detail
     FROM tasks
    WHERE status = 'blocked'
      AND blocked_reason = 'dispatch_fail_autoblock'
      AND (
        blocked_detail->>'reason_code' = 'map_revision_mismatch'
        OR blocked_detail->>'last_error' = 'map_revision_mismatch'
        OR blocked_detail->>'message' LIKE '%base_sha 落后%'
      )
    ORDER BY created_at`,
);
console.log(`[reanchor-blocked-tasks] 候选 ${rows.length} 条${dryRun ? '（dry-run，不改库）' : ''}`);
let done = 0;
let failed = 0;
for (const row of rows) {
  if (dryRun) {
    console.log(`  - ${row.id} | ${String(row.title).slice(0, 60)}`);
    continue;
  }
  try {
    await pool.query(
      `UPDATE tasks
          SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"dispatch_fail_consecutive":0}'::jsonb
        WHERE id = $1`,
      [row.id],
    );
    const result = await unblockTask(row.id);
    if (result?.success) {
      done += 1;
      console.log(`  ✓ ${row.id} 已解锁`);
    } else {
      failed += 1;
      console.log(`  ✗ ${row.id} 解锁失败: ${result?.error ?? 'unknown'}`);
    }
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${row.id} 异常: ${err.message}`);
  }
}
console.log(`[reanchor-blocked-tasks] 完成 ${done} 失败 ${failed}`);
await pool.end();
