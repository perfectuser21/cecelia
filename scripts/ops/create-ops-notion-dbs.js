#!/usr/bin/env node
/**
 * create-ops-notion-dbs.js — 一次性创建运行舱 Notion 两库并把 id 写入 Brain kv。
 * 幂等：先 POST /search 按 title 找已有库，找到即复用（Notion 无 database upsert，重跑禁建平行库）。
 * 用法（宿主）：
 *   source ~/.credentials/1password.env && export OP_SERVICE_ACCOUNT_TOKEN
 *   NOTION_API_KEY=$(op item get "Notion" --vault CS --fields credential --reveal | tr -d '"') \
 *     node scripts/ops/create-ops-notion-dbs.js
 */
const NOTION = 'https://api.notion.com/v1';
const BRAIN = process.env.BRAIN_URL || 'http://localhost:5221';
const TOKEN = process.env.NOTION_API_KEY;
const JOURNEY_DB = '358c40c2-ba63-8148-bde7-e313d789931a'; // 现有库，用于取 AI Hub parent page

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

async function ensureDb(title, properties, parentPageId) {
  const existing = await findDbByTitle(title);
  if (existing) { console.log(`✅ 已存在复用: ${title} → ${existing}`); return existing; }
  const db = await notion('/databases', 'POST', {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: title } }],
    properties,
  });
  console.log(`✅ 已创建: ${title} → ${db.id}`);
  return db.id;
}

// 合并单库「Ops 运行图谱」：一行=一个运行单元（agent 或排程），调度/编排都是属性。
const GRAPH_PROPS = {
  Name: { title: {} }, Source: { select: {} }, Machine: { select: {} },
  Role: { select: {} },              // orchestrator / member / solo / scheduled
  Workflow: { rich_text: {} },       // 编排它的父（图，可多父，逗号分隔）
  Type: { rich_text: {} }, Kind: { select: {} },
  Schedule: { rich_text: {} },       // 空=常驻/按需；有值=定时
  Repeat: { checkbox: {} }, NextRun: { date: {} }, LastSeen: { date: {} },
  Status: { select: {} }, Suspicious: { checkbox: {} },
};

const main = async () => {
  const journeyDb = await notion(`/databases/${JOURNEY_DB}`);
  const parentPageId = journeyDb.parent?.page_id;
  if (!parentPageId) throw new Error('取不到 AI Hub parent page id（JOURNEY_DB.parent 非 page）');
  const graph_db = await ensureDb('Ops 运行图谱', GRAPH_PROPS, parentPageId);
  const kv = await fetch(`${BRAIN}/api/brain/kv/ops_notion_dbs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graph_db }),
  }).then((r) => r.json());
  if (!kv.ok) throw new Error(`kv 写入失败: ${JSON.stringify(kv)}`);
  console.log('✅ kv ops_notion_dbs={graph_db} 已写入，下一轮 notion-push 自动推合并库（旧两库停推，数据保留待手删）');
};

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
