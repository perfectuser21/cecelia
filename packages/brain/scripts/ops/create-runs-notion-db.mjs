#!/usr/bin/env node
/**
 * create-runs-notion-db.mjs — 在目录投影配置的父页下建 Notion「最近执行」库（9 列，schema = RUNS_DB_PROPS），
 * 并把迁移 532 登记的 runs 占位行转正（notion_db_id=新库 id、direction='push'、status='active'）。
 *
 * 默认 dry-run：只读库里的配置与登记行，打印将建的库，不发 Notion 请求、不写库。
 * --apply：POST /databases 建库，再 UPDATE notion_projection_map。已存在 active 的 runs 行则拒绝重复建库（退出码 1）。
 * 用法：DATABASE_URL=postgresql://.../cecelia NOTION_API_KEY=... node scripts/ops/create-runs-notion-db.mjs [--apply]
 *
 * 可 import 不执行：单测只 import buildCreateDbBody / planCreate；main() 仅在直接执行时运行。
 */
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { RUNS_DB_PROPS } from '../../src/runs-notion-projection.js';
import { getToken, notionReq } from '../../src/recurring-notion-sync.js';
import { DIRECTORY_TARGET } from '../../src/projection/directory-projector.js';

export const RUNS_DB_TITLE = '最近执行';

/** 建库请求体（纯函数） */
export function buildCreateDbBody(parentPageId) {
  if (!parentPageId) throw new Error('缺少 parent_page_id（目录投影配置里没有父页）');
  return {
    parent: { page_id: parentPageId },
    title: [{ type: 'text', text: { content: RUNS_DB_TITLE } }],
    properties: RUNS_DB_PROPS,
  };
}

/** 建库前置判断（纯函数）：已有 active 行拒绝重复建；无占位行（迁移 532 未跑）或无父页也拒绝 */
export function planCreate({ mapRows, parentPageId }) {
  if (mapRows.some(r => r.status === 'active')) return { ok: false, reason: 'runs 已存在 active 的投影登记行，拒绝重复建库' };
  if (!mapRows.length) return { ok: false, reason: 'notion_projection_map 里没有 runs 占位行（迁移 532 未跑？）' };
  if (!parentPageId) return { ok: false, reason: '目录投影配置里没有 parent_page_id' };
  return { ok: true };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const apply = argv.includes('--apply');
  if (!env.DATABASE_URL) { console.error('DATABASE_URL 未设置'); return 1; }
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 });
  try {
    const mapRows = (await pool.query(`SELECT notion_db_id, status FROM notion_projection_map WHERE brain_table='runs'`)).rows;
    const config = (await pool.query('SELECT config FROM projection_targets WHERE target=$1', [DIRECTORY_TARGET])).rows[0]?.config;
    const parentPageId = config?.parent_page_id;
    const plan = planCreate({ mapRows, parentPageId });
    if (!plan.ok) { console.error(`拒绝：${plan.reason}`); return 1; }
    const body = buildCreateDbBody(parentPageId);
    console.log(`将在父页 ${parentPageId} 下建库「${RUNS_DB_TITLE}」，${Object.keys(body.properties).length} 列：${Object.keys(body.properties).join('、')}`);
    if (!apply) { console.log('（dry-run：未发 Notion 请求、未写库。确认后加 --apply 执行）'); return 0; }

    const created = await notionReq(getToken(), '/databases', 'POST', body);
    console.log(`Notion 库已建：${created.id}`);
    try {
      const res = await pool.query(
        `UPDATE notion_projection_map SET notion_db_id=$1, direction='push', status='active', title=$2
          WHERE brain_table='runs' AND status<>'active'`, [created.id, RUNS_DB_TITLE]);
      console.log(`notion_projection_map 已转正 ${res.rowCount} 行`);
    } catch (e) {
      console.error(`库已建（${created.id}）但登记更新失败，需按此 id 补登记：${e.message}`);
      return 2;
    }
    return 0;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => process.exit(code), err => { console.error(err.message); process.exit(1); });
}
