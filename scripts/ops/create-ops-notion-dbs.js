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
  Type: { rich_text: {} },
  Schedule: { rich_text: {} },       // 空=常驻/按需；有值=定时
  Repeat: { checkbox: {} }, NextRun: { date: {} }, LastSeen: { date: {} },
  Status: { select: {} },
  // Suspicious（死排程）列暂不设：其唯一数据源 brain_recurring 因 notion_page_id 占用不推本库，
  // 恒 false 会误导；死排程识别在 /agent-ops/graph API 层保留供 Dashboard 消费。
};

const main = async () => {
  const journeyDb = await notion(`/databases/${JOURNEY_DB}`);
  const parentPageId = journeyDb.parent?.page_id;
  if (!parentPageId) throw new Error('取不到 AI Hub parent page id（JOURNEY_DB.parent 非 page）');
  const graph_db = await ensureDb('Ops 运行图谱', GRAPH_PROPS, parentPageId);

  // 同库 relation 自关联必须建库后单独 PATCH（建库时无法引用尚不存在的自己）。
  // dual_property：CanCall(它能召唤谁) ↔ CalledBy(谁能召唤它) 双向自动同步。
  // 注意：这是**召唤权限**（allowAgents），不是业务 workflow——后者在 Ops Workflows 库。
  const db = await notion(`/databases/${graph_db}`);
  if (!db.properties?.CanCall) {
    await notion(`/databases/${graph_db}`, 'PATCH', {
      properties: {
        CanCall: { relation: { database_id: graph_db, type: 'dual_property',
          dual_property: { synced_property_name: 'CalledBy' } } },
      },
    });
    console.log('✅ 已加同库 relation: CanCall(可召唤) ↔ CalledBy(被谁召唤)');
  } else {
    console.log('✅ CanCall relation 已存在，跳过');
  }

  // 业务流程库（刀4）：workflow 是业务流程（智能获客8阶段），与图谱库的 agent（执行资源）分开。
  const workflows_db = await ensureDb('Ops Workflows', {
    Name: { title: {} }, Source: { select: {} }, Active: { checkbox: {} },
    Stages: { number: {} },        // 业务阶段数
    Flow: { rich_text: {} },       // 阶段序列：手机预检 → 视频发现 → …
    Nodes: { number: {} }, WfId: { rich_text: {} },
  }, parentPageId);

  // 跨库 relation：workflow → 它用到的 agent（指向图谱库），反向自动生成 Workflows 列
  const wdb = await notion(`/databases/${workflows_db}`);
  if (!wdb.properties?.Agents) {
    await notion(`/databases/${workflows_db}`, 'PATCH', {
      properties: {
        Agents: { relation: { database_id: graph_db, type: 'dual_property',
          dual_property: { synced_property_name: 'Workflows' } } },
      },
    });
    console.log('✅ 已加跨库 relation: Workflows.Agents ↔ 图谱库.Workflows');
  } else {
    console.log('✅ Agents relation 已存在，跳过');
  }


  // run 记录库（刀6）：只存业务流程的每次执行（通道类只在流程行看汇总）
  const runs_db = await ensureDb('Ops Runs', {
    Name: { title: {} }, Status: { select: {} }, Machine: { select: {} },
    Mode: { select: {} }, Minutes: { number: {} }, StartedAt: { date: {} },
    RunId: { rich_text: {} },
  }, parentPageId);
  const rdb = await notion(`/databases/${runs_db}`);
  if (!rdb.properties?.Workflow) {
    await notion(`/databases/${runs_db}`, 'PATCH', {
      properties: { Workflow: { relation: { database_id: workflows_db, type: 'dual_property',
        dual_property: { synced_property_name: 'Runs明细' } } } },
    });
    console.log('✅ 已加跨库 relation: Runs.Workflow ↔ Workflows.Runs明细');
  }

  const kv = await fetch(`${BRAIN}/api/brain/kv/ops_notion_dbs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graph_db, workflows_db, runs_db }),
  }).then((r) => r.json());
  if (!kv.ok) throw new Error(`kv 写入失败: ${JSON.stringify(kv)}`);
  console.log('✅ kv ops_notion_dbs={graph_db} 已写入，下一轮 notion-push 自动推合并库（旧两库停推，数据保留待手删）');
};

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
