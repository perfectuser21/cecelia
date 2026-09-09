#!/usr/bin/env node
// packages/brain/scripts/db-slim.mjs
/**
 * Cecelia 库瘦身执行器。设计: docs/superpowers/specs/2026-09-09-db-slim-design.md
 * 模式:
 *   --dry-run           (默认) 逐规则报告命中行数/表体积, 不写库
 *   --apply             归档→断言→分批删除→VACUUM FULL+ANALYZE
 *   --check             守卫: 库超 --max-db-gb (默认4) 退出码 1
 *   --no-vacuum         apply 时跳过 VACUUM FULL
 *   --archive-dir <dir> 默认 ~/cecelia-backups/db-slim-<YYYYMMDD>/
 * 中断后重跑即可（规则幂等）; graph 组中断必须重跑至完成, 否则扫描器会撞
 * GRAPH_SNAPSHOT_IMMUTABILITY_VIOLATION。
 */
import pg from 'pg';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { SLIM_RULES } from '../src/db-slim-rules.js';

const { Pool } = pg;
const DB_URL = process.env.DATABASE_URL || 'postgres:///cecelia';
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const CHECK = args.includes('--check');
const NO_VACUUM = args.includes('--no-vacuum');
const BATCH = 50000;

function argValue(flag, dflt) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}

const MAX_DB_GB = Number(argValue('--max-db-gb', '4'));
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const ARCHIVE_DIR = argValue('--archive-dir', path.join(homedir(), 'cecelia-backups', `db-slim-${stamp}`));

async function dbSizeGb(pool) {
  const { rows } = await pool.query("SELECT pg_database_size(current_database())::bigint AS b");
  return Number(rows[0].b) / 1024 ** 3;
}

async function dryRun(pool) {
  console.log('[db-slim] dry-run（不写库）');
  for (const rule of SLIM_RULES) {
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM ${rule.table} WHERE ${rule.archiveWhere}) AS hit,
              pg_size_pretty(pg_total_relation_size('${rule.table}')) AS size`
    );
    console.log(`  ${rule.name}: 命中 ${rows[0].hit} 行（表 ${rows[0].size}）`);
    if (rule.preAssert) {
      const a = await pool.query(rule.preAssert.sql);
      const n = a.rows[0].n;
      console.log(`    断言 ${n === 0 ? '✅' : '❌'} preAssert=${n}（要求 0）`);
    }
  }
  console.log(`[db-slim] 当前库大小: ${(await dbSizeGb(pool)).toFixed(2)} GB`);
}

async function check(pool) {
  const gb = await dbSizeGb(pool);
  if (gb > MAX_DB_GB) {
    console.error(`[db-slim] ❌ 库 ${gb.toFixed(2)} GB 超过阈值 ${MAX_DB_GB} GB — 该跑 db-slim --apply 了`);
    process.exit(1);
  }
  console.log(`[db-slim] ✅ 库 ${gb.toFixed(2)} GB ≤ ${MAX_DB_GB} GB`);
}

async function apply() { throw new Error('apply 未实现'); }

async function main() {
  const pool = new Pool({ connectionString: DB_URL });
  try {
    if (CHECK) return await check(pool);
    if (!APPLY) return await dryRun(pool);
    await apply(pool);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error('[db-slim] 失败:', e.message); process.exit(1); });
