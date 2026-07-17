/**
 * promise-map-nightly.js — MJ5 S4 保鲜对账（nightly）
 *
 * 每晚对账 4 条断言；任一失败 → Bark 告警。
 * 调度模型：scheduler-jobs.js 60s 轮询 + 自 gate（时间窗口 + 哨兵去重）
 *
 * PRD: docs/prd/2026-07-17-mj5-promise-map-first-cut.prd.md §六
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import pool from './db.js';
import { sendBark } from './notifier.js';
// A2 与 S2 锚点闸同口径（豁免/存量 cutoff 单一来源；日历日边界防 naive timestamp 时区偏移）
import { ANCHOR_EXEMPT_TASK_TYPES, ANCHOR_EXEMPT_ACTIONS, ANCHOR_LEGACY_CUTOFF_DAY } from './anchor-check.js';

export const SENTINEL_KEY = 'promise-map-nightly';
export const NIGHTLY_HOUR_UTC = 2;     // 北京时间 10:00
const DEDUP_WINDOW_MS = 23 * 3600 * 1000;

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

// 三闸代码路径（S1/S2/S3 各闸的核心实现文件）
const GATE_FILES = [
  join(SRC_DIR, 'routes', 'journeys.js'),   // S1 schema/API
  join(SRC_DIR, 'anchor-check.js'),          // S2 锚点执法
  join(SRC_DIR, 'cascade-list.js'),          // S3 联动清单
];

/**
 * 运行全部 4 条断言，返回结构化结果数组。
 * 设计为纯 pool 注入，方便测试。
 *
 * @param {object} pool - pg pool
 * @returns {Promise<Array<{key, label, ok, detail}>>}
 */
export async function buildNightlyAssertions(queryPool) {
  const results = [];

  // ── A1: 带锚 PR 昨日 merge，格子已回写 green ──────────────
  const { rows: anchoredPRs } = await queryPool.query(`
    SELECT dr.id, dr.task_id, t.payload->'anchor'->>'step_id' AS step_id, dr.pr_url
    FROM dev_records dr
    JOIN tasks t ON t.id::text = dr.task_id::text
    WHERE dr.merged_at > NOW() - INTERVAL '24 hours'
      AND t.payload->'anchor'->>'step_id' IS NOT NULL
  `);

  let a1Failed = [];
  for (const pr of anchoredPRs) {
    const { rows: [{ count }] } = await queryPool.query(
      `SELECT COUNT(*) FROM journey_step_links WHERE step_id = $1 AND cell_status = 'green'`,
      [pr.step_id],
    );
    if (parseInt(count, 10) === 0) {
      a1Failed.push(pr.pr_url || pr.task_id);
    }
  }

  if (anchoredPRs.length === 0) {
    results.push({ key: 'anchor_cell_writeback', label: '带锚 PR 格子回写', ok: true, detail: '昨日无带锚 merge，跳过' });
  } else if (a1Failed.length === 0) {
    results.push({ key: 'anchor_cell_writeback', label: '带锚 PR 格子回写', ok: true, detail: `${anchoredPRs.length} 个带锚 PR 格子均已回写 green` });
  } else {
    results.push({ key: 'anchor_cell_writeback', label: '带锚 PR 格子回写', ok: false, detail: `${a1Failed.length} 个带锚 PR 格子未回写：${a1Failed.join(', ')}` });
  }

  // ── A2: 无锚 merge PR = 0 ─────────────────────────────────
  const { rows: [{ count: unanchoredCount }] } = await queryPool.query(`
    SELECT COUNT(*) FROM dev_records dr
    JOIN tasks t ON t.id::text = dr.task_id::text
    WHERE dr.merged_at > NOW() - INTERVAL '24 hours'
      AND (t.payload->'anchor'->>'step_id' IS NULL
           OR t.payload->>'anchor' IS NULL)
      AND t.created_at >= $1::date
      AND NOT (t.task_type = ANY($2))
      AND NOT (COALESCE(t.payload->>'action','') = ANY($3))
  `, [
    ANCHOR_LEGACY_CUTOFF_DAY,
    [...ANCHOR_EXEMPT_TASK_TYPES],
    [...ANCHOR_EXEMPT_ACTIONS],
  ]);
  const unanchored = parseInt(unanchoredCount, 10);
  results.push({
    key: 'zero_unanchored_merges',
    label: '无锚 merge PR 数',
    ok: unanchored === 0,
    detail: unanchored === 0 ? '0 个无锚 merge（符合 S2 要求）' : `${unanchored} 个无锚 merge（S2 漏拦，已过豁免期且非豁免类型）`,
  });

  // ── A3: 账本引用完整性 ────────────────────────────────────
  // 底座件 = 家③横切件池 / 家②共享前置（journey_features.kind 枚举里没有 'base'——
  // 用 kind='base' 是永远查空的纸门，07-17 验火修正）
  const { rows: baseFeaturesNoLinks } = await queryPool.query(`
    SELECT jf.id, jf.name FROM journey_features jf
    WHERE jf."group" IN ('家③横切件池','家②共享前置')
      AND NOT EXISTS (
        SELECT 1 FROM journey_step_links jsl WHERE jsl.feature_id = jf.id
      )
  `);
  // promise 缺失只查承诺地图域（home/domain 非空）——全库存量步骤走豁免（判定点④同源）
  const { rows: stepsNoPromise } = await queryPool.query(`
    SELECT js.id, js.name FROM journey_steps js
    JOIN journeys j ON j.id = js.journey_id
    WHERE js.promise IS NULL
      AND (j.home IS NOT NULL OR j.domain IS NOT NULL)
    LIMIT 10
  `);

  const a3Issues = [];
  if (baseFeaturesNoLinks.length > 0) {
    a3Issues.push(`${baseFeaturesNoLinks.length} 个底座件无链接（blast-radius 空）`);
  }
  if (stepsNoPromise.length > 0) {
    a3Issues.push(`${stepsNoPromise.length} 个步骤无 promise`);
  }
  results.push({
    key: 'ledger_integrity',
    label: '账本引用完整性',
    ok: a3Issues.length === 0,
    detail: a3Issues.length === 0 ? '底座件+步骤 promise 完整' : a3Issues.join('；'),
  });

  // ── A4: 三闸心跳 ──────────────────────────────────────────
  const missingGates = GATE_FILES.filter(f => !existsSync(f));
  results.push({
    key: 'gate_heartbeat',
    label: '三闸心跳',
    ok: missingGates.length === 0,
    detail: missingGates.length === 0
      ? `3 个闸文件均存在（S1/S2/S3）`
      : `${missingGates.length} 个闸文件缺失：${missingGates.map(f => f.split('/').pop()).join(', ')}`,
  });

  return results;
}

/**
 * 入口函数，供 scheduler-jobs.js 调用。
 *
 * @param {Date} [now]
 */
export async function runPromiseMapNightly(now = new Date()) {
  // 时间窗口 gate
  if (now.getUTCHours() !== NIGHTLY_HOUR_UTC) {
    return { skipped: true, reason: 'outside_window' };
  }

  // 哨兵去重
  const { rows: [sentinel] } = await pool.query(
    `SELECT value_json FROM working_memory WHERE key = $1`,
    [SENTINEL_KEY],
  );
  if (sentinel) {
    const lastRun = new Date(sentinel.value_json.last_run_at);
    if ((now.getTime() - lastRun.getTime()) < DEDUP_WINDOW_MS) {
      return { skipped: true, reason: 'already_ran_today' };
    }
  }

  // 运行断言
  const results = await buildNightlyAssertions(pool);
  const failures = results.filter(r => !r.ok);

  // 写哨兵
  await pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [SENTINEL_KEY, JSON.stringify({ last_run_at: now.toISOString(), results })],
  );

  // Bark 告警
  if (failures.length > 0) {
    const body = failures.map(f => `• ${f.label}: ${f.detail}`).join('\n');
    await sendBark('🔴 承诺地图保鲜对账失败', body).catch(() => {});
  }

  console.log(`[promise-map-nightly] ran: ${results.length} assertions, ${failures.length} failures`);
  return { ran: true, total: results.length, failures: failures.length, results };
}
