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
  return null;
}

const JOURNEY_DB = '358c40c2-ba63-8148-bde7-e313d789931a';

const VALID_JOURNEY_TYPES = new Set(['user_facing', 'autonomous', 'dev_pipeline', 'agent_remote']);
const VALID_MATURITIES = new Set(['not_started', 'skeleton', 'mvp', 'production', 'mature']);

async function main() {
  const apiKey = loadNotionKey();
  let cursor = null;
  let total = 0;

  try {
    do {
      const data = await notionQuery(JOURNEY_DB, apiKey, cursor);
      for (const page of data.results || []) {
        const props = page.properties;
        const name = extractText(props['Name']);
        if (!name) continue;

        // 规范化枚举值，避免 CHECK 约束失败
        const rawType = extractText(props['Journey Type']) || 'user_facing';
        const journeyType = VALID_JOURNEY_TYPES.has(rawType) ? rawType : 'user_facing';
        const rawMaturity = extractText(props['Maturity']) || 'not_started';
        const maturity = VALID_MATURITIES.has(rawMaturity) ? rawMaturity : 'not_started';
        const status = extractText(props['Status']) || 'active';
        const description = extractText(props['Description']);
        const e2eTestPath = extractText(props['E2E Test Path']);

        await pool.query(
          `INSERT INTO journeys (notion_id, name, description, journey_type, maturity, status, e2e_test_path, notion_synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
           ON CONFLICT (notion_id) DO UPDATE
             SET name=$2, description=$3, journey_type=$4, maturity=$5, status=$6,
                 e2e_test_path=$7, notion_synced_at=NOW(), updated_at=NOW()`,
          [page.id, name, description, journeyType, maturity, status, e2eTestPath],
        );
        total++;
      }
      cursor = data.next_cursor;
    } while (cursor);

    console.log(`journeys 同步完成，共 ${total} 条`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
