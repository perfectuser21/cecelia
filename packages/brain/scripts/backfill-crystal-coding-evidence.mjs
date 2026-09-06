#!/usr/bin/env node
/**
 * backfill-crystal-coding-evidence.mjs — 判官口粮第二铲的手动铲子
 *
 * 常态由 scheduler job `crystal-coding-evidence` 每 10 分钟自动同步；
 * 本 CLI 用于首次回填历史窗口、或改完聚合规则后重算（幂等，重跑不长行）。
 *
 * 用法：
 *   node packages/brain/scripts/backfill-crystal-coding-evidence.mjs [--days=30] [--dry-run]
 */

import pool from '../src/db.js';
import { syncCodingEvidence, CODING_EVIDENCE_DEFAULT_DAYS } from '../src/crystal/coding-evidence.js';

function parseArgs(argv) {
  const daysArg = argv.find((a) => a.startsWith('--days='));
  const days = daysArg ? Number(daysArg.split('=')[1]) : CODING_EVIDENCE_DEFAULT_DAYS;
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`--days 必须是正数，收到: ${daysArg}`);
  }
  return { days, dryRun: argv.includes('--dry-run') };
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('backfill-crystal-coding-evidence.mjs');
if (isDirectRun) {
  const { days, dryRun } = parseArgs(process.argv.slice(2));
  // force：手动铲子不受 scheduler 的 10min 自 gate 约束
  syncCodingEvidence({ days, dryRun, force: true })
    .then((r) => {
      console.log(
        '[crystal-coding-evidence] %s 窗口=%d天 源(harness_attempts=%d, sequencer_ledger=%d) 丢弃无法归格=%d → 证据行=%d',
        dryRun ? 'DRY-RUN（未写库）' : '已写库',
        r.days,
        r.source_records.harness_attempts,
        r.source_records.sequencer_ledger,
        r.dropped_unmapped,
        r.evidence_rows,
      );
      for (const row of r.rows) {
        console.log(
          '  %s %s runs=%d passes=%d avg_ms=%s postcondition=%s',
          row.report_date,
          row.unit_key,
          row.runs,
          row.passes,
          row.avg_ms === null ? 'null' : Math.round(row.avg_ms),
          row.has_postcondition,
        );
      }
      return pool.end();
    })
    .catch((err) => {
      console.error('[crystal-coding-evidence] 失败:', err.message);
      process.exitCode = 1;
      return pool.end();
    });
}
