#!/usr/bin/env node
/**
 * create-probe-notion-dbs.js — 在「数据落脚总台账」索引页下建验证层两库（链 bf5088a3 棒4-2，决策 10a68212）：
 *   「探针」    ← step_probes（notion-probe-projection.pushStepProbes）
 *   「判定回执」← journey_assertion_receipts 业务探针行（notion-probe-projection.pushProbeReceipts）
 * 幂等：先 POST /search 按 title 找已有库，找到即复用并补缺列（Notion 无 database upsert，重跑禁建平行库）。
 * 建好的 id 登记进 notion_projection_map（迁移 478 种子；换库时只改登记行）。
 * 用法（宿主）：
 *   source ~/.credentials/notion.env && node scripts/ops/create-probe-notion-dbs.js
 */
import { PROBE_DB_PROPS, diffMissingProps } from '../../packages/brain/src/ops-notion-schema.js';

const NOTION = 'https://api.notion.com/v1';
const TOKEN = process.env.NOTION_API_KEY;
// 数据落脚总台账（~/AI-CHARTER.md 总索引页）
const PARENT_PAGE = process.env.PROBE_DBS_PARENT_PAGE || '3dbc40c2-ba63-810e-b96f-f7523838b411';
const TITLES = { probes_db: '探针', receipts_db: '判定回执' };

if (!TOKEN) { console.error('NOTION_API_KEY 未设置'); process.exit(1); }

async function notion(path, method = 'GET', body = null) {
  const res = await fetch(`${NOTION}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${data.message || JSON.stringify(data).slice(0, 300)}`);
  return data;
}

async function findDbByTitle(title) {
  const r = await notion('/search', 'POST', { query: title, filter: { property: 'object', value: 'database' } });
  return r.results.find((d) => (d.title?.[0]?.plain_text || '') === title)?.id || null;
}

async function ensureProps(dbId, wanted, label) {
  const db = await notion(`/databases/${dbId}`);
  const missing = diffMissingProps(db.properties, wanted);
  const names = Object.keys(missing);
  if (names.length === 0) { console.log(`✅ ${label} 列齐全，跳过`); return; }
  await notion(`/databases/${dbId}`, 'PATCH', { properties: missing });
  console.log(`✅ ${label} 已补 ${names.length} 列: ${names.join(', ')}`);
}

async function ensureDb(title, properties) {
  const existing = await findDbByTitle(title);
  if (existing) { console.log(`✅ 已存在复用: ${title} → ${existing}`); return existing; }
  const db = await notion('/databases', 'POST', {
    parent: { type: 'page_id', page_id: PARENT_PAGE },
    title: [{ type: 'text', text: { content: title } }],
    properties,
  });
  console.log(`✅ 已创建: ${title} → ${db.id}`);
  return db.id;
}

const main = async () => {
  await notion(`/pages/${PARENT_PAGE}`); // 父页可达性先验
  const probes_db = await ensureDb(TITLES.probes_db, PROBE_DB_PROPS.step_probes);
  await ensureProps(probes_db, PROBE_DB_PROPS.step_probes, TITLES.probes_db);
  const receipts_db = await ensureDb(TITLES.receipts_db, PROBE_DB_PROPS.probe_receipts);
  await ensureProps(receipts_db, PROBE_DB_PROPS.probe_receipts, TITLES.receipts_db);
  console.log(JSON.stringify({ probes_db, receipts_db }));
  console.log('登记：notion_projection_map(step_probes → probes_db, journey_assertion_receipts → receipts_db)，见迁移 478');
};

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
