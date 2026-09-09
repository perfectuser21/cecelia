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

function archiveRule(rule) {
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  // 按规则名命名（同一表可有多条规则，如 memory_stream 的 expired 与 selfmodel_history，按表名会互相覆盖）
  const out = path.join(ARCHIVE_DIR, `${rule.name}.csv.gz`);
  const copySql = `COPY (SELECT * FROM ${rule.table} WHERE ${rule.archiveWhere.replace(/\n/g, ' ')}) TO STDOUT WITH CSV HEADER`;
  execSync(`psql "${DB_URL}" -c ${JSON.stringify(copySql)} | gzip > ${JSON.stringify(out)}`, {
    stdio: ['ignore', 'ignore', 'inherit'], shell: '/bin/bash',
  });
  if (!existsSync(out) || statSync(out).size === 0) {
    throw new Error(`归档文件为空: ${out}`);
  }
  return out;
}

async function batchDelete(pool, rule) {
  let total = 0;
  for (;;) {
    const { rowCount } = await pool.query(
      `DELETE FROM ${rule.table} WHERE ctid IN (
         SELECT ctid FROM ${rule.table} WHERE ${rule.deleteWhere} LIMIT ${BATCH})`
    );
    total += rowCount;
    if (rowCount === 0) break;
    console.log(`    ${rule.table}: 已删 ${total} 行...`);
  }
  return total;
}

async function apply(pool) {
  console.log(`[db-slim] apply — 归档目录: ${ARCHIVE_DIR}`);

  // 阶段 1: 全量归档（任何删除发生前）。此时所有 archiveWhere 都能看到完整数据，
  // 不能按规则交叉"归档→删除"串行推进——否则后面规则的 archiveWhere 可能因为
  // 前序规则已删除的行而失真（见 ckpt 组：checkpoints_old 删完后，
  // checkpoint_writes_orphan/checkpoint_blobs_orphan 的 archiveWhere 命中归零，
  // 但 deleteWhere 的孤儿谓词此时才成立，会导致孤儿行不归档直接删）。
  console.log('  --- 阶段 1: 归档 ---');
  const hits = new Map();
  for (const rule of SLIM_RULES) {
    const { rows } = await pool.query(`SELECT count(*)::bigint AS n FROM ${rule.table} WHERE ${rule.archiveWhere}`);
    const hit = Number(rows[0].n);
    hits.set(rule.name, hit);
    console.log(`  ${rule.name}: 命中 ${hit} 行`);
    if (rule.preAssert) {
      const a = await pool.query(rule.preAssert.sql);
      if (a.rows[0].n !== 0) throw new Error(`${rule.name} preAssert 失败: ${a.rows[0].n} ≠ 0`);
    }
    if (hit > 0) {
      const f = archiveRule(rule);
      console.log(`    已归档 → ${f}`);
    } else {
      console.log('    跳过归档（0 行）');
    }
  }

  // 阶段 2: 统一分批删除（deleteWhere 不变）。txGroup 内孤儿谓词只有在前序
  // 规则删除完成后才成立，所以这里一律跑 batchDelete；0 行删除无害。
  console.log('  --- 阶段 2: 删除 ---');
  for (const rule of SLIM_RULES) {
    const deleted = await batchDelete(pool, rule);
    console.log(`  ${rule.name}: 已删除 ${deleted} 行`);
  }

  // 阶段 3: VACUUM
  if (!NO_VACUUM) {
    console.log('  --- 阶段 3: VACUUM ---');
    const tables = [...new Set(SLIM_RULES.map((r) => r.table))];
    for (const t of tables) {
      console.log(`  VACUUM (FULL, ANALYZE) ${t} ...`);
      await pool.query(`VACUUM (FULL, ANALYZE) ${t}`);
    }
  }
  console.log(`[db-slim] 完成。库大小: ${(await dbSizeGb(pool)).toFixed(2)} GB`);
}

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
