#!/usr/bin/env node
/**
 * notion-mirror-labels.mjs — 手动跑一次「镜子库只读说明由注册表生成」（任务 a7a6b8b4，交接单第 5 步）。
 * 平时由 Brain scheduler job notion-mirror-labels 每天跑一次；本脚本用于首跑/排障。
 * 读 notion_projection_map（只读），写 Notion 库 description（不改标题）。幂等：已是同样说明零写。
 * 用法（宿主，生产库经 ssh 隧道）：
 *   ssh -fN -L 15432:localhost:5432 us-vps
 *   set -a; source ~/.credentials/notion.env; set +a
 *   DB_HOST=localhost DB_PORT=15432 DB_NAME=cecelia DB_USER=cecelia DB_PASSWORD=... \
 *     node scripts/ops/notion-mirror-labels.mjs [--dry-run]
 */
import pg from 'pg';
import { syncMirrorLabels } from '../../packages/brain/src/notion-mirror-labels.js';

const dryRun = process.argv.includes('--dry-run');
const token = process.env.NOTION_API_KEY;
if (!token) { console.error('NOTION_API_KEY 未设置'); process.exit(1); }

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'cecelia',
  user: process.env.DB_USER || 'cecelia',
  password: process.env.DB_PASSWORD,
  max: 1,
});
try {
  const r = await syncMirrorLabels(pool, { token, dryRun });
  console.log(JSON.stringify({ dryRun, ...r }, null, 2));
  console.log(`${dryRun ? '[dry-run] 将' : ''}更新 ${r.updated.length} 个库，不变 ${r.unchanged.length}，跳过 ${r.skipped.length}，失败 ${r.failed.length}`);
  if (r.failed.length) process.exitCode = 2;
} finally {
  await pool.end();
}
