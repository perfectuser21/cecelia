#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const pg = require('pg');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });

function loadNotionKey() {
  const credPath = path.join(process.env.HOME, '.credentials', 'notion.env');
  const env = {};
  fs.readFileSync(credPath, 'utf8').split('\n')
    .forEach(l => { const m = l.match(/^([^=]+)=(.+)/); if (m) env[m[1]] = m[2]; });
  if (!env.NOTION_API_KEY) throw new Error('NOTION_API_KEY not found in ~/.credentials/notion.env');
  return env.NOTION_API_KEY;
}

async function notionQuery(dbId, apiKey, cursor) {
  const body = { page_size: 100 };
  if (cursor) body.start_cursor = cursor;
  const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Notion API error: ${r.status} ${await r.text()}`);
  return r.json();
}

function extractText(prop) {
  if (!prop) return null;
  if (prop.type === 'title') return prop.title?.map(t => t.plain_text).join('') || null;
  if (prop.type === 'rich_text') return prop.rich_text?.map(t => t.plain_text).join('') || null;
  if (prop.type === 'select') return prop.select?.name || null;
  if (prop.type === 'url') return prop.url || null;
  return null;
}

// issues.status 为自由文本，与 Notion status 值对齐（不加 CHECK 约束，因 Notion status 可扩展）
const ISSUES_DB = 'a17c40c2-ba63-82fb-9888-8152cefe29ec';
const VALID_PRIORITY = new Set(['P0', 'P1', 'P2', 'P3']);

// Sub Area relation page ID → sub_area 名称映射
const SUB_AREA_IDS = {
  '5c0c40c2-ba63-8347-9334-01a0129a015a': 'brain',
  '64bc40c2-ba63-8212-ab62-012912749a71': 'engine',
  '7e7c40c2-ba63-839d-b0bc-017f1cc7d49d': 'cecelia',
  '8acc40c2-ba63-8373-8281-0151470389d1': 'multi-agent',
  'cf5c40c2-ba63-82c8-a00a-015c593f6268': 'zenithjoy',
  'a17c40c2-ba63-83e2-b922-8197b09af030': 'dashboard',
};

async function main() {
  const apiKey = loadNotionKey();
  let cursor = null;
  let total = 0;

  try {
    do {
      const data = await notionQuery(ISSUES_DB, apiKey, cursor);
      for (const page of data.results || []) {
        const props = page.properties;
        const title = extractText(props['Issue']);
        if (!title) continue;

        const rawPriority = extractText(props['Priority']) || 'P2';
        const priority = VALID_PRIORITY.has(rawPriority) ? rawPriority : 'P2';
        const status = extractText(props['Status']) || 'In progress';

        const subAreaRelation = props['Sub Area']?.relation || [];
        const subAreaId = subAreaRelation[0]?.id || null;
        const subArea = subAreaId ? (SUB_AREA_IDS[subAreaId] || null) : null;

        await pool.query(
          `INSERT INTO issues (notion_id, title, priority, status, sub_area, notion_synced_at)
           VALUES ($1,$2,$3,$4,$5,NOW())
           ON CONFLICT (notion_id) DO UPDATE
             SET title=$2, priority=$3, status=$4, sub_area=$5,
                 notion_synced_at=NOW(), updated_at=NOW()`,
          [page.id, title, priority, status, subArea],
        );
        total++;
      }
      cursor = data.next_cursor;
    } while (cursor);

    console.log(`issues 同步完成，共 ${total} 条`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
