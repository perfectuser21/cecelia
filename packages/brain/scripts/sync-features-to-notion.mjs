#!/usr/bin/env node
/**
 * sync-features-to-notion.mjs
 * 将 Brain feature registry 同步到 Notion Cecelia Feature Registry 数据库。
 * 用法: node sync-features-to-notion.mjs [--dry-run]
 */

import fs from 'fs';
import path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';
const NOTION_VERSION = '2022-06-28';
const NOTION_DB_ID = '352c40c2-ba63-810c-bb52-ced1cfb6fea1';

// 凭据
const credsPath = path.join(process.env.HOME, '.credentials', 'notion.env');
const creds = {};
fs.readFileSync(credsPath, 'utf8').split('\n').forEach(l => {
  const m = l.match(/^([^=]+)=(.+)/);
  if (m) creds[m[1]] = m[2].trim();
});
const NOTION_KEY = creds.NOTION_API_KEY;
if (!NOTION_KEY) throw new Error('NOTION_API_KEY not found in notion.env');

// ── Areas DB 真实 Page ID（ZenithJoy workspace）────────────────────────────
const AREA_IDS = {
  // 主 Area
  CECELIA:    '9c1c40c2-ba63-82f6-8d1a-01a143f43dea',  // Cecilia（含 Sub-items）
  ZENITHJOY:  '504c40c2-ba63-83ed-b27d-81d503b4acad',  // ZenithJoy（含 Sub-items）

  // Sub Area — Cecelia
  ENGINE:     'b78c40c2-ba63-8244-81dd-01f65cd9e0c9',
  BRAIN:      '164c40c2-ba63-8241-88e5-812d1e9b21e2',
  MEMORIES:   '106c40c2-ba63-82eb-be4f-81bc3fd755f7',  // Memories & concionsness
  MULTIAGENT: '0d4c40c2-ba63-83b7-a326-817a7edaabe8',
  DASHBOARD:  'b33c40c2-ba63-824e-8f44-81258c7c38bb',

  // Sub Area — ZenithJoy
  CREATOR:    '99bc40c2-ba63-836f-afb1-814c016c6909',  // AI Content Creator & Operation
};

// ── Domain → Area + Sub Area IDs ──────────────────────────────────────────
const DOMAIN_MAP = {
  // Cecelia / Engine — tick loop、调度、运维、健康、配置
  tick:          { area: AREA_IDS.CECELIA,   subArea: AREA_IDS.ENGINE },
  schedule:      { area: AREA_IDS.CECELIA,   subArea: AREA_IDS.ENGINE },
  operation:     { area: AREA_IDS.CECELIA,   subArea: AREA_IDS.ENGINE },
  health:        { area: AREA_IDS.CECELIA,   subArea: AREA_IDS.ENGINE },
  admin:         { area: AREA_IDS.CECELIA,   subArea: AREA_IDS.ENGINE },

  // Cecelia / Brain — 任务、规划、提案、保护
  task:          { area: AREA_IDS.CECELIA,   subArea: AREA_IDS.BRAIN },
  planning:      { area: AREA_IDS.CECELIA,   subArea: AREA_IDS.BRAIN },
  proposal:      { area: AREA_IDS.CECELIA,   subArea: AREA_IDS.BRAIN },
  immune:        { area: AREA_IDS.CECELIA,   subArea: AREA_IDS.BRAIN },
  quarantine:    { area: AREA_IDS.CECELIA,   subArea: AREA_IDS.BRAIN },

  // Cecelia / Memories & Consciousness — 记忆、认知、目标、欲望、警觉
  cortex:        { area: AREA_IDS.CECELIA,   subArea: AREA_IDS.MEMORIES },
  memory:        { area: AREA_IDS.CECELIA,   subArea: AREA_IDS.MEMORIES },
  goal:          { area: AREA_IDS.CECELIA,   subArea: AREA_IDS.MEMORIES },
  desire:        { area: AREA_IDS.CECELIA,   subArea: AREA_IDS.MEMORIES },
  alertness:     { area: AREA_IDS.CECELIA,   subArea: AREA_IDS.MEMORIES },

  // Cecelia / Multi-Agent — 协作、Agent 执行
  agent:         { area: AREA_IDS.CECELIA,   subArea: AREA_IDS.MULTIAGENT },
  collaboration: { area: AREA_IDS.CECELIA,   subArea: AREA_IDS.MULTIAGENT },

  // Cecelia / Dashboard — UI 面板
  dashboard:     { area: AREA_IDS.CECELIA,   subArea: AREA_IDS.DASHBOARD },

  // ZenithJoy / AI Content Creator — 内容流水线、数据分析
  content:         { area: AREA_IDS.ZENITHJOY, subArea: AREA_IDS.CREATOR },
  analytics:       { area: AREA_IDS.ZENITHJOY, subArea: AREA_IDS.CREATOR },
  media:           { area: AREA_IDS.ZENITHJOY, subArea: AREA_IDS.CREATOR },
  creator:         { area: AREA_IDS.ZENITHJOY, subArea: AREA_IDS.CREATOR },
  scraping:        { area: AREA_IDS.ZENITHJOY, subArea: AREA_IDS.CREATOR },
  'ai-gen':        { area: AREA_IDS.ZENITHJOY, subArea: AREA_IDS.CREATOR },
  research:        { area: AREA_IDS.ZENITHJOY, subArea: AREA_IDS.CREATOR },
  'platform-auth': { area: AREA_IDS.ZENITHJOY, subArea: AREA_IDS.CREATOR },
  label:           { area: AREA_IDS.ZENITHJOY, subArea: AREA_IDS.CREATOR },
};

// ── Type 推断 ─────────────────────────────────────────────────────────────
const API_KEYWORDS = ['创建', '更新', '查询', '列表', '详情', '删除', '修改',
                      '批量', '提交', '申请', '获取', '搜索', '统计'];
const MODULE_DOMAINS = new Set(['health', 'tick', 'immune', 'dashboard', 'cortex', 'admin']);

function inferType(feature) {
  const id    = feature.id || '';
  const name  = feature.name || '';
  const domain = feature.domain || '';
  if (domain === 'schedule' || name.includes('Cron')) return 'cron';
  if (MODULE_DOMAINS.has(domain)) return 'module';
  if (API_KEYWORDS.some(k => name.includes(k))) return 'api';
  return 'module';
}

// ── Notion helpers ────────────────────────────────────────────────────────
async function notionFetch(endpoint, method = 'GET', body = null) {
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (data.object === 'error') throw new Error(`Notion: ${data.message}`);
  return data;
}

async function getAllNotionPages() {
  const pages = {};
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const data = await notionFetch(`/databases/${NOTION_DB_ID}/query`, 'POST', body);
    for (const page of data.results) {
      const fid = page.properties['Feature ID']?.rich_text?.[0]?.plain_text;
      if (fid) pages[fid] = page.id;
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return pages;
}

async function getBrainFeatures() {
  const res = await fetch(`${BRAIN_URL}/api/brain/features?limit=500`);
  const data = await res.json();
  return data.features || [];
}

function buildProperties(feature) {
  const mapping = DOMAIN_MAP[feature.domain] || { area: AREA_IDS.CECELIA, subArea: AREA_IDS.BRAIN };
  const type = inferType(feature);

  const props = {
    'Name':       { title: [{ text: { content: feature.name || feature.id } }] },
    'Feature ID': { rich_text: [{ text: { content: feature.id } }] },
    'Area':       { relation: [{ id: mapping.area }] },
    'Sub Area':   { relation: [{ id: mapping.subArea }] },
    'Type':       { select: { name: type } },
    'Status':     { select: { name: feature.status || 'active' } },
  };

  if (feature.priority) {
    const pri = String(feature.priority).startsWith('P') ? feature.priority : `P${feature.priority}`;
    props['Priority'] = { select: { name: pri } };
  }
  if (feature.smoke_status) {
    const valid = ['passing', 'failing', 'unknown'];
    props['Smoke Status'] = { select: { name: valid.includes(feature.smoke_status) ? feature.smoke_status : 'unknown' } };
  }
  if (feature.smoke_cmd) {
    const cmd = feature.smoke_cmd.length > 2000 ? feature.smoke_cmd.slice(0, 2000) : feature.smoke_cmd;
    props['Smoke Command'] = { rich_text: [{ text: { content: cmd } }] };
  }
  if (feature.smoke_last_run) {
    try {
      const d = new Date(feature.smoke_last_run);
      if (!isNaN(d)) props['Smoke Last Run'] = { date: { start: d.toISOString() } };
    } catch (_) {}
  }

  return props;
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`🔄 Syncing Brain features → Notion (dry-run: ${DRY_RUN})`);

  const [features, existingPages] = await Promise.all([
    getBrainFeatures(),
    getAllNotionPages(),
  ]);

  console.log(`📦 Brain: ${features.length} features | Notion: ${Object.keys(existingPages).length} pages`);

  // 统计分布（用名字展示，不用 ID）
  const areaNames = {
    [AREA_IDS.CECELIA]: 'Cecelia', [AREA_IDS.ZENITHJOY]: 'ZenithJoy',
    [AREA_IDS.ENGINE]: 'Engine', [AREA_IDS.BRAIN]: 'Brain',
    [AREA_IDS.MEMORIES]: 'Memories & Consciousness', [AREA_IDS.MULTIAGENT]: 'Multi-Agent',
    [AREA_IDS.DASHBOARD]: 'Dashboard', [AREA_IDS.CREATOR]: 'AI Content Creator',
  };
  const dist = {};
  for (const f of features) {
    const m = DOMAIN_MAP[f.domain] || { area: AREA_IDS.CECELIA, subArea: AREA_IDS.BRAIN };
    const key = `${areaNames[m.area]} / ${areaNames[m.subArea]}`;
    dist[key] = (dist[key] || 0) + 1;
  }
  console.log('\n📊 分布:');
  for (const [k, v] of Object.entries(dist).sort()) console.log(`  ${k}: ${v}`);

  if (DRY_RUN) { console.log('\n[dry-run] 跳过写入'); return; }

  let created = 0, updated = 0, errors = 0;
  for (const feature of features) {
    const props = buildProperties(feature);
    const existingId = existingPages[feature.id];
    try {
      if (existingId) {
        await notionFetch(`/pages/${existingId}`, 'PATCH', { properties: props });
        updated++;
      } else {
        await notionFetch('/pages', 'POST', { parent: { database_id: NOTION_DB_ID }, properties: props });
        created++;
      }
    } catch (err) {
      console.error(`  ❌ ${feature.id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n✅ 完成 — 新建: ${created}, 更新: ${updated}, 错误: ${errors}`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
