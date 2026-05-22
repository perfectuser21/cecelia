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

const FEATURES_DB = '358c40c2-ba63-81e3-96c5-d762b3d34dff';
const VALID_THICKNESS = new Set(['thin', 'medium', 'thick', 'mature']);
const VALID_STATUS = new Set(['planned', 'building', 'done', 'deprecated']);

async function main() {
  const apiKey = loadNotionKey();
  let cursor = null;
  let total = 0;

  try {
    do {
      const data = await notionQuery(FEATURES_DB, apiKey, cursor);
      for (const page of data.results || []) {
        const props = page.properties;
        const name = extractText(props['Name']);
        if (!name) continue;

        const rawThickness = extractText(props['Thickness']) || 'thin';
        const thickness = VALID_THICKNESS.has(rawThickness) ? rawThickness : 'thin';
        const rawStatus = extractText(props['Status']) || 'planned';
        const status = VALID_STATUS.has(rawStatus) ? rawStatus : 'planned';
        const unitTestPath = extractText(props['Unit Test Path']);
        const version = extractText(props['Version']);

        const journeyRelation = props['Journey']?.relation || [];
        const stepRelation = props['Step']?.relation || [];
        const journeyNotionId = journeyRelation[0]?.id || null;
        const stepNotionId = stepRelation[0]?.id || null;

        let journeyId = null, stepId = null;
        if (journeyNotionId) {
          const { rows } = await pool.query('SELECT id FROM journeys WHERE notion_id=$1', [journeyNotionId]);
          journeyId = rows[0]?.id || null;
          if (!journeyId) {
            console.warn(`  ⚠ feature "${name}" 的关联 journey (${journeyNotionId}) 在 DB 中未找到，journey_id 设为 null`);
          }
        }
        if (stepNotionId) {
          const { rows } = await pool.query('SELECT id FROM journey_steps WHERE notion_id=$1', [stepNotionId]);
          stepId = rows[0]?.id || null;
        }

        await pool.query(
          `INSERT INTO journey_features
             (notion_id, journey_id, step_id, name, thickness, status, unit_test_path, version, notion_synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
           ON CONFLICT (notion_id) DO UPDATE
             SET journey_id=$2, step_id=$3, name=$4, thickness=$5, status=$6,
                 unit_test_path=$7, version=$8, notion_synced_at=NOW(), updated_at=NOW()`,
          [page.id, journeyId, stepId, name, thickness, status, unitTestPath, version],
        );
        total++;
      }
      cursor = data.next_cursor;
    } while (cursor);

    console.log(`journey_features 同步完成，共 ${total} 条`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
