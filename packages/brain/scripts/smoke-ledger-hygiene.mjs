#!/usr/bin/env node
// 账本保鲜守卫 smoke：真连 DB 跑一遍 5 指标 SQL 输出分数（只读不写库、不走窗口 gate）。
// Usage: DATABASE_URL=postgres://... node packages/brain/scripts/smoke-ledger-hygiene.mjs
// 不设 DATABASE_URL 时 fallback 到 db-config.js 的默认连接（.env / DB_* 环境变量）。
import pg from 'pg';
import { DB_DEFAULTS } from '../src/db-config.js';
import { computeMetrics, renderHygieneMarkdown } from '../src/ledger-hygiene.js';

const { Pool } = pg;

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool(DB_DEFAULTS);

try {
  const metrics = await computeMetrics(pool);
  const today = new Date().toISOString().slice(0, 10);
  console.log(renderHygieneMarkdown(today, metrics, []));
  const disabled = Object.values(metrics).filter((m) => !m.enabled).map((m) => m.name);
  if (disabled.length > 0) console.log(`未启用指标（等上游 Task 上线自激活）：${disabled.join('、')}`);
} finally {
  await pool.end();
}
