#!/usr/bin/env node
// packages/brain/scripts/reanchor-blocked-tasks.mjs
// 一次性回填：把因 map_revision_mismatch 自动停车的任务解锁并清零连续失败计数，
// 快进本身交给下次派发的预检完成（任务 d9c405e2）。不做定时 job（会与 map_recovery 类任务形成 churn）。
//
// 前置条件：必须在含 d9c405e2 预检重锚定的 Brain 版本部署到 us-vps 之后再跑，
// 否则任务解锁后下一次派发会立刻重新撞上同一个 map_revision_mismatch 停车。
//
//   node packages/brain/scripts/reanchor-blocked-tasks.mjs [--dry-run] [--confirm-database=<name>]
import { pathToFileURL } from 'node:url';

import pool from '../src/db.js';
import { emit } from '../src/event-bus.js';
import { unblockTask } from '../src/task-updater.js';

// M1：第三个 OR 子句（blocked_detail->>'message' LIKE '%base_sha 落后%'）是主动停车时
// 以字符串 detail 写入的历史形态（非结构化 reason_code）。生产 2026-09-23 实测：125 条
// autoblock 停车任务里，前两个结构化条件之外，正是这条字符串匹配命中了另外 32 条主动
// 停车任务，另外 90 条历史回滚残骸不命中——不可删，也不可放宽/收紧匹配条件。
const CANDIDATES_SQL = `
  SELECT id, title, blocked_detail
    FROM tasks
   WHERE status = 'blocked'
     AND blocked_reason = 'dispatch_fail_autoblock'
     AND (
       blocked_detail->>'reason_code' = 'map_revision_mismatch'
       OR blocked_detail->>'last_error' = 'map_revision_mismatch'
       OR blocked_detail->>'message' LIKE '%base_sha 落后%'
     )
   ORDER BY created_at
`;

const UNBLOCK_HINT = '可能原因：任务不在 blocked 态 / 存在未解决 harness_gaps / pending hard 依赖';

/**
 * 扫描并解锁因 map_revision_mismatch 自动停车的任务。
 * @param {object} opts
 * @param {{query: Function}} opts.db - db pool（或兼容 query() 的 mock）
 * @param {boolean} opts.dryRun - true 时只列候选，不改库
 * @param {Function} [opts.log] - 日志函数，默认 console.log
 * @param {Function} [opts.emit] - 事件留痕函数，签名同 event-bus.emit
 * @returns {Promise<{candidates: number, done: number, failed: number, task_ids: string[]}>}
 */
export async function reanchorBlockedTasks({ db, dryRun, log = console.log, emit: emitFn }) {
  const { rows } = await db.query(CANDIDATES_SQL);
  const candidates = rows.length;
  const taskIds = rows.map(row => row.id);
  log(`[reanchor-blocked-tasks] 候选 ${candidates} 条${dryRun ? '（dry-run，不改库）' : ''}`);

  let done = 0;
  let failed = 0;
  for (const row of rows) {
    if (dryRun) {
      log(`  - ${row.id} | ${String(row.title).slice(0, 60)}`);
      continue;
    }
    try {
      await db.query(
        `UPDATE tasks
            SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"dispatch_fail_consecutive":0}'::jsonb
          WHERE id = $1`,
        [row.id],
      );
      const result = await unblockTask(row.id);
      if (result?.success) {
        done += 1;
        log(`  ✓ ${row.id} 已解锁`);
      } else {
        failed += 1;
        log(`  ✗ ${row.id} 解锁失败: ${result?.error ?? 'unknown'}（${UNBLOCK_HINT}）`);
      }
    } catch (err) {
      failed += 1;
      log(`  ✗ ${row.id} 异常: ${err.message}（${UNBLOCK_HINT}）`);
    }
  }
  log(`[reanchor-blocked-tasks] 完成 ${done} 失败 ${failed}`);

  if (emitFn) {
    await emitFn('backfill:reanchor_blocked_tasks', 'reanchor-blocked-tasks', {
      candidates,
      unblocked: done,
      failed,
      dry_run: dryRun,
      task_ids: taskIds,
    });
  }

  return { candidates, done, failed, task_ids: taskIds };
}

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const confirmArg = argv.find(arg => arg.startsWith('--confirm-database='));
  const confirmDatabase = confirmArg ? confirmArg.slice('--confirm-database='.length) : null;
  return { dryRun, confirmDatabase };
}

async function main() {
  const { dryRun, confirmDatabase } = parseArgs(process.argv.slice(2));
  try {
    // I2：库确认闸——非 dry-run 必须显式确认当前连的是哪个库，防止误跑到 us-vps 生产。
    const { rows } = await pool.query('SELECT current_database() AS database_name');
    const databaseName = rows?.[0]?.database_name ?? null;
    console.log(`[reanchor-blocked-tasks] 当前数据库: ${databaseName}`);

    if (!dryRun && (!confirmDatabase || confirmDatabase !== databaseName)) {
      console.log(
        `[reanchor-blocked-tasks] 数据库确认不匹配或缺失（--confirm-database=${confirmDatabase ?? '(未提供)'}，实际 ${databaseName}），已阻止执行，不改库`,
      );
      process.exitCode = 2;
      return;
    }

    const result = await reanchorBlockedTasks({ db: pool, dryRun, emit });
    process.exitCode = result.failed > 0 ? 1 : 0;
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(err => {
    console.error(`[reanchor-blocked-tasks] 异常: ${err.message}`);
    process.exitCode = 1;
  });
}
