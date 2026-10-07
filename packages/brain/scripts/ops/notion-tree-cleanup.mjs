#!/usr/bin/env node
/**
 * notion-tree-cleanup.mjs — 按「每列要么来自 Brain、要么是登记过的人工列」清理 Notion 六层目录库（部门/价值流/能力/流程/Activity/Step）。
 * 计划由 src/projection/directory-cleanup.js 算（列合同 = directory-schema.js），可重复执行：清干净后再跑是零动作。
 *
 * 默认 dry-run：只读，打印每库删哪些列、归档哪些页、保留哪些列及来源。
 * --apply：先把被删列的逐页原值 + 被归档页全部属性写进本地 JSON 备份，再删列（PATCH database 属性置 null，公式→汇总→其余分批）、
 *          再归档页（archived:true，30 天可恢复），最后读回核对。新投影器的列还没建出（新代码没上线）时拒绝执行。
 * 用法：NOTION_API_KEY=... node scripts/ops/notion-tree-cleanup.mjs [--apply] [--backup-dir DIR] [--json FILE] [--dbs '{"areas":"..."}']
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { planDirectoryCleanup, dropBatches, buildCleanupBackup, assertReadyToApply } from '../../src/projection/directory-cleanup.js';

const DEFAULT_DBS = {
  areas: '300c40c2-ba63-82d5-9ec1-81990d181950', value_streams: '3eac40c2-ba63-817f-a964-f071c78cb711',
  capabilities: '3edc40c2-ba63-813b-8862-ceacd3c60c4d', workflows: '3d9c40c2-ba63-8145-bfa8-f4c0c006e0af',
  activities: 'c213e387-b2ae-45a4-98c0-4a66fe3408be', steps: '3d9c40c2-ba63-8195-a41b-f529056a4aa8',
};
const NAMES = { areas: '部门', value_streams: '价值流', capabilities: '能力', workflows: '流程', activities: 'Activity', steps: 'Step' };
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const APPLY = args.includes('--apply');
const TOKEN = process.env.NOTION_API_KEY;
if (!TOKEN) { console.error('NOTION_API_KEY 未设置'); process.exit(1); }
const dbs = flag('--dbs') ? JSON.parse(flag('--dbs')) : DEFAULT_DBS;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function notion(path, method = 'GET', body = null) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      method, headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000),
    });
    if (res.status === 429 && attempt < 5) { await sleep(Number(res.headers.get('retry-after') || 1) * 1000); continue; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    return json;
  }
}
async function snapshot() {
  const databases = {}, pages = {};
  for (const [layer, id] of Object.entries(dbs)) {
    databases[layer] = await notion(`/databases/${id}`);
    pages[layer] = [];
    let cursor;
    do {
      const r = await notion(`/databases/${id}/query`, 'POST', { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      pages[layer].push(...r.results); cursor = r.has_more ? r.next_cursor : null;
    } while (cursor);
  }
  return { databases, pages };
}
function report(plan) {
  for (const [layer, p] of Object.entries(plan)) {
    console.log(`\n== ${NAMES[layer]}（${layer}，${p.rows} 行）列 ${p.before} → ${p.after}`);
    console.log(`  删 ${p.drop.length} 列：${p.drop.map(c => `${c.name}[${c.type},${c.filled}/${p.rows}]`).join('、') || '无'}`);
    console.log(`  留 ${p.keep.length} 列：${p.keep.map(c => `${c.name}（${c.source}）`).join('、')}`);
    if (p.missing.length) console.log(`  待投影器新建 ${p.missing.length} 列：${p.missing.join('、')}`);
    if (p.archive.length) console.log(`  归档 ${p.archive.length} 页（无 Brain ID）：${p.archive.map(a => a.title || a.id).join('、')}`);
    if (p.pending.length) console.log(`  待拍板 ${p.pending.length} 页（无 Brain ID，不自动归档）：${p.pending.map(a => a.title || a.id).join('、')}`);
  }
}

const world = await snapshot();
const plan = planDirectoryCleanup(world);
report(plan);
if (flag('--json')) { writeFileSync(flag('--json'), JSON.stringify(plan, null, 2)); console.log(`\n计划已写入 ${flag('--json')}`); }
if (!APPLY) { console.log('\n（dry-run：未改动 Notion。确认新代码已上线且目录投影跑过一轮后，加 --apply 执行）'); process.exit(0); }

assertReadyToApply(plan);
const dir = flag('--backup-dir') || join(homedir(), 'notion-tree-cleanup-backup');
mkdirSync(dir, { recursive: true });
const backupFile = join(dir, `notion-tree-cleanup-${new Date().toISOString().replaceAll(':', '-')}.json`);
writeFileSync(backupFile, JSON.stringify({ taken_at: new Date().toISOString(), dbs, backup: buildCleanupBackup(plan, world.pages) }, null, 2));
console.log(`\n备份已写入 ${backupFile}`);
for (const [layer, p] of Object.entries(plan)) {
  for (const batch of dropBatches(p.drop)) {
    await notion(`/databases/${p.database_id}`, 'PATCH', { properties: Object.fromEntries(batch.map(name => [name, null])) });
    console.log(`  ${NAMES[layer]} 删列：${batch.join('、')}`);
  }
  for (const page of p.archive) { await notion(`/pages/${page.id}`, 'PATCH', { archived: true }); await sleep(350); }
  if (p.archive.length) console.log(`  ${NAMES[layer]} 归档 ${p.archive.length} 页`);
}
const after = planDirectoryCleanup(await snapshot());
const left = Object.entries(after).filter(([, p]) => p.drop.length || p.archive.length);
if (left.length) { console.error(`读回仍有残留：${left.map(([l, p]) => `${l} 列[${p.drop.map(c => c.name)}] 页[${p.archive.length}]`).join('；')}`); process.exit(1); }
console.log('读回核对通过：六库只剩 Brain 列与登记人工列，无 Brain ID 的页已归档。');
