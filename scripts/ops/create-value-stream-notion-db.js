#!/usr/bin/env node
/**
 * create-value-stream-notion-db.js — 在「数据落脚总台账」索引页下建「价值流 Value Streams」只读镜子库
 * （决策 e00d9cc3 / 9d5fce74：价值流以 Brain 结构地图 map_projection_nodes 为准）。
 * 同时把 09-26 Notion AI 手建的旧「Value Streams」库 902b…（7 行是产品方向，不是价值流）改名为
 * 「产品方向（人工维护）」——只改标题/描述，不动行和属性。
 * 幂等：先扫父页 child_database 子块按 title 找已有库，找到即复用并补缺列（Notion 无 database upsert，重跑禁建平行库）。
 * 建好的 id 登记进 notion_projection_map（见迁移 487）；推送方 notion-map-value-streams.pushMapValueStreams。
 * 用法（宿主）：
 *   set -a; source ~/.credentials/notion.env; set +a; node scripts/ops/create-value-stream-notion-db.js
 */
import { VALUE_STREAM_DB_PROPS, diffMissingProps } from '../../packages/brain/src/ops-notion-schema.js';

const NOTION = 'https://api.notion.com/v1';
const TOKEN = process.env.NOTION_API_KEY;
const PARENT_PAGE = process.env.VS_DB_PARENT_PAGE || '3dbc40c2-ba63-810e-b96f-f7523838b411';
const TITLE = '价值流 Value Streams';
const DESCRIPTION = '只读镜子：由 Brain 结构地图推送，改结构请改 manifest，不要在 Notion 手改';
const PRODUCT_DB = '902b85550fb54ae0bdf89b0d7a23a3f2';
const PRODUCT_TITLE = '产品方向（人工维护）';
const PRODUCT_DESC = '产品方向（人工维护，非价值流）：2026-09-26 Notion AI 手建，原名 Value Streams。'
  + '价值流以 Brain 结构地图为准，见「价值流 Value Streams」镜子库（决策 e00d9cc3）。';

if (!TOKEN) { console.error('NOTION_API_KEY 未设置'); process.exit(1); }

const text = (content) => [{ type: 'text', text: { content } }];
const plain = (arr) => (arr || []).map((t) => t.plain_text).join('');

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

/**
 * 按父页子块找同名库：/search 有索引滞后（09-29 实测刚建的库 10 秒内搜不到，重跑建出平行库），
 * 父页 children 是强一致的，child_database 块 id 即库 id。
 */
async function findDbByTitle(title) {
  let cursor;
  do {
    const q = cursor ? `?start_cursor=${cursor}&page_size=100` : '?page_size=100';
    const r = await notion(`/blocks/${PARENT_PAGE}/children${q}`);
    const hit = r.results.find((b) => b.type === 'child_database' && !b.archived && b.child_database?.title === title);
    if (hit) return hit.id;
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return null;
}

async function ensureDb() {
  const existing = await findDbByTitle(TITLE);
  if (existing) { console.log(`✅ 已存在复用: ${TITLE} → ${existing}`); return existing; }
  const db = await notion('/databases', 'POST', {
    parent: { type: 'page_id', page_id: PARENT_PAGE },
    title: text(TITLE),
    description: text(DESCRIPTION),
    properties: VALUE_STREAM_DB_PROPS,
  });
  console.log(`✅ 已创建: ${TITLE} → ${db.id}`);
  return db.id;
}

async function ensurePropsAndDesc(dbId) {
  const db = await notion(`/databases/${dbId}`);
  const missing = diffMissingProps(db.properties, VALUE_STREAM_DB_PROPS);
  const patch = {};
  if (Object.keys(missing).length) patch.properties = missing;
  if (plain(db.description) !== DESCRIPTION) patch.description = text(DESCRIPTION);
  if (!Object.keys(patch).length) { console.log('✅ 列与描述齐全，跳过'); return; }
  await notion(`/databases/${dbId}`, 'PATCH', patch);
  console.log(`✅ 已补: ${Object.keys(missing).join(', ') || '(无列)'}${patch.description ? ' + 描述' : ''}`);
}

/** 旧库只改标题/描述：不发 properties，不碰任何行。 */
async function renameProductDb() {
  const db = await notion(`/databases/${PRODUCT_DB}`);
  const titleNow = plain(db.title);
  if (titleNow === PRODUCT_TITLE && plain(db.description) === PRODUCT_DESC) {
    console.log(`✅ ${PRODUCT_TITLE} 已改名，跳过`);
    return;
  }
  await notion(`/databases/${PRODUCT_DB}`, 'PATCH', { title: text(PRODUCT_TITLE), description: text(PRODUCT_DESC) });
  console.log(`✅ 902b 库改名: ${titleNow} → ${PRODUCT_TITLE}`);
}

const main = async () => {
  await notion(`/pages/${PARENT_PAGE}`); // 父页可达性先验
  await renameProductDb();
  const dbId = await ensureDb();
  await ensurePropsAndDesc(dbId);
  console.log(JSON.stringify({ value_streams_db: dbId, product_directions_db: PRODUCT_DB }));
};

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
