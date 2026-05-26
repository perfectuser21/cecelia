#!/usr/bin/env node
'use strict';
/**
 * sync-journey-steps.js
 *
 * AI Step Registry DB (35ec40c2-ba63-8170-872a-c19cc55b63b3) 未被共享给集成，
 * 无法直接 query。改用「遍历所有 journey 页面的 Steps relation」抓取各 step page。
 */
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

async function notionGet(url, apiKey) {
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
    },
  });
  if (!r.ok) throw new Error(`Notion GET error: ${r.status} ${await r.text()}`);
  return r.json();
}

function extractText(prop) {
  if (!prop) return null;
  if (prop.type === 'title') return prop.title?.map(t => t.plain_text).join('') || null;
  if (prop.type === 'rich_text') return prop.rich_text?.map(t => t.plain_text).join('') || null;
  if (prop.type === 'select') return prop.select?.name || null;
  if (prop.type === 'number') return prop.number;
  return null;
}

async function main() {
  const apiKey = loadNotionKey();

  // 从 DB 获取所有已同步的 journeys（含 notion_id）
  const { rows: journeys } = await pool.query(
    'SELECT id, notion_id, name FROM journeys WHERE notion_id IS NOT NULL',
  );
  console.log(`找到 ${journeys.length} 个 journey，开始遍历 Steps relation…`);

  let total = 0;
  const seen = new Set(); // 避免同一 step 从多个 journey 重复插入

  try {
    for (const journey of journeys) {
      // 获取 journey 页面，拿 Steps relation 中的 step page IDs
      let journeyPage;
      try {
        journeyPage = await notionGet(
          `https://api.notion.com/v1/pages/${journey.notion_id}`,
          apiKey,
        );
      } catch (e) {
        console.warn(`跳过 journey "${journey.name}"：${e.message}`);
        continue;
      }

      const stepsRelation = journeyPage.properties?.Steps?.relation || [];
      if (stepsRelation.length === 0) continue;

      for (const stepRef of stepsRelation) {
        const stepPageId = stepRef.id;
        if (seen.has(stepPageId)) continue;
        seen.add(stepPageId);

        let stepPage;
        try {
          stepPage = await notionGet(
            `https://api.notion.com/v1/pages/${stepPageId}`,
            apiKey,
          );
        } catch (e) {
          console.warn(`跳过 step ${stepPageId}：${e.message}`);
          continue;
        }

        const props = stepPage.properties;
        const name = extractText(props['Name']);
        if (!name) continue;

        const stepNumber = extractText(props['Step Number']) ?? 0;
        const description = extractText(props['Description']);
        const status = extractText(props['Status']) || 'planned';

        await pool.query(
          `INSERT INTO journey_steps (notion_id, journey_id, name, description, step_number, status, notion_synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW())
           ON CONFLICT (notion_id) DO UPDATE
             SET journey_id=$2, name=$3, description=$4, step_number=$5, status=$6,
                 notion_synced_at=NOW(), updated_at=NOW()`,
          [stepPageId, journey.id, name, description, stepNumber, status],
        );
        total++;
      }
    }

    console.log(`journey_steps 同步完成，共 ${total} 条`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
