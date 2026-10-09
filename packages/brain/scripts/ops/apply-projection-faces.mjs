#!/usr/bin/env node
/**
 * apply-projection-faces.mjs — 按注册表给 Notion 编制库贴面图标（🔒镜子 / ✍️入口 / 📚真身）。
 * 三面模型定稿（决策 297ffee5）：打开任何库，图标就告诉你能不能写。
 * 幂等：图标已对则跳过；archived 的登记不动。只改库的 icon，不碰行数据。
 * 用法：DATABASE_URL=postgresql://.../cecelia NOTION_API_KEY=... node scripts/ops/apply-projection-faces.mjs [--dry-run]
 */
import pg from 'pg';
import { FACE_ICON, loadProjectionMap } from '../../src/lib/notion-projection-registry.js';

const TOKEN = process.env.NOTION_API_KEY;
const DRY = process.argv.includes('--dry-run');
if (!TOKEN) { console.error('NOTION_API_KEY 未设置'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL 未设置'); process.exit(1); }

async function notion(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 160)}`);
  return json;
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const { rows } = await loadProjectionMap(pool);
await pool.end();

let changed = 0, same = 0, skipped = 0, failed = 0;
for (const r of rows) {
  if (r.status === 'archived') { skipped++; continue; }
  const want = FACE_ICON[r.face];
  try {
    const db = await notion(`/databases/${r.notion_db_id}`);
    const cur = db.icon?.type === 'emoji' ? db.icon.emoji : null;
    if (cur === want) { same++; continue; }
    if (!DRY) await notion(`/databases/${r.notion_db_id}`, 'PATCH', { icon: { type: 'emoji', emoji: want } });
    changed++;
    console.log(`${DRY ? '[dry] ' : ''}${cur ?? '∅'} → ${want}  ${r.title}`);
  } catch (e) {
    failed++;
    console.warn(`跳过 ${r.title}: ${e.message}`);
  }
}
console.log(`\n贴面完成：改 ${changed} · 已对 ${same} · archived 跳过 ${skipped} · 失败 ${failed}`);
process.exit(failed ? 2 : 0);
