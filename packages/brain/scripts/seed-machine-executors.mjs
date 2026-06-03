/**
 * 种子脚本：为现有机器的 system_registry.metadata 写 executors 数组（只列已部署组合）。
 *
 * 真相源 = system_registry (type=machine)。resolveExecutor 据此路由。
 * 幂等：mergeExecutorsMetadata 覆盖 executors（不追加），保留 metadata 其它字段。
 * 重跑结果不漂移。机器不存在则跳过（不创建 — 注册新机器走 POST /api/brain/machines）。
 *
 * Spec: docs/superpowers/specs/2026-06-03-machine-executor-routing-design.md §单元1
 *
 * 运行：node packages/brain/scripts/seed-machine-executors.mjs
 */

import pg from 'pg';
import { DB_DEFAULTS } from '../src/db-config.js';

const { Pool } = pg;

// 只列已部署的（机器, 执行器）组合（spec §单元1）。
// xian-m1 按实际部署暂不列（未确认 codex daemon），不在表里 = 不被 seed。
export const SEED_TARGETS = [
  {
    name: 'mac-mini-m4-us',
    executors: [
      { executor: 'claude', url: 'http://localhost:3457', default: true },
    ],
  },
  {
    name: 'xian-m4',
    executors: [
      { executor: 'codex', url: 'http://host.docker.internal:13458', default: true },
    ],
  },
];

/**
 * 把 executors 写进机器 metadata（幂等：覆盖 executors，保留其它字段）。
 * @param {Object|null} existing  现有 metadata
 * @param {Array} executors       要写入的 executors 数组
 * @returns {Object} 新 metadata
 */
export function mergeExecutorsMetadata(existing, executors) {
  return { ...(existing || {}), executors };
}

async function main() {
  const pool = new Pool(DB_DEFAULTS);
  let updated = 0;
  let skipped = 0;
  try {
    for (const target of SEED_TARGETS) {
      const { rows } = await pool.query(
        `SELECT id, metadata FROM system_registry WHERE type = 'machine' AND name = $1`,
        [target.name],
      );
      if (rows.length === 0) {
        console.warn(`[seed-machine-executors] 跳过：机器 '${target.name}' 不存在（注册走 POST /api/brain/machines）`);
        skipped++;
        continue;
      }
      const merged = mergeExecutorsMetadata(rows[0].metadata, target.executors);
      await pool.query(
        `UPDATE system_registry SET metadata = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(merged), rows[0].id],
      );
      console.log(`[seed-machine-executors] ✓ ${target.name} executors 已写入 (${target.executors.map(e => e.executor).join(',')})`);
      updated++;
    }
    console.log(`[seed-machine-executors] 完成：updated=${updated} skipped=${skipped}`);
  } finally {
    await pool.end();
  }
}

// 仅在直接执行时跑 main（import 时只暴露纯函数 + 常量，供测试）
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[seed-machine-executors] 失败:', err);
    process.exit(1);
  });
}
