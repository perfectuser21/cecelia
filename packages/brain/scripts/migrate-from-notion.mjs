#!/usr/bin/env node
/**
 * Notion → PostgreSQL 迁移脚本（一次性，幂等）
 *
 * 把 Notion 中 Alex 的个人数据库导入 cecelia PostgreSQL：
 *   - Areas       → areas 表
 *   - XX_Ideas    → ideas 表
 *   - Knowledge_Operational → knowledge 表
 *
 * 用法：
 *   node packages/brain/scripts/migrate-from-notion.mjs
 *   node packages/brain/scripts/migrate-from-notion.mjs --dry-run  # 只打印，不写入
 *
 * 幂等：通过 notion_id 做 upsert，重复跑安全。
 */

import pg from 'pg';
import { DB_DEFAULTS } from '../src/db-config.js';

const DRY_RUN = process.argv.includes('--dry-run');

// Notion 数据库 ID
const NOTION_DB_IDS = {
  areas:     '691fb781-f278-40d8-8400-0cafb73e3990',
  ideas:     '2a153f41-3ec5-808b-a7c1-000bbfdd3f89',
  knowledge: '4c441c0a-64b2-4f57-9809-0a49ccd9f70f',
};

const NOTION_API_KEY = process.env.NOTION_API_KEY;
if (!NOTION_API_KEY) {
  console.error('❌ 缺少 NOTION_API_KEY 环境变量');
  console.error('   请先运行: source ~/.credentials/notion.env');
  process.exit(1);
}

// ============================================================
// Notion API 工具函数
// ============================================================

async function notionQuery(databaseId, startCursor = null) {
  const body = { page_size: 100 };
  if (startCursor) body.start_cursor = startCursor;

  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion API 错误 ${res.status}: ${err}`);
  }
  return res.json();
}

async function fetchAllPages(databaseId) {
  const pages = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    const data = await notionQuery(databaseId, cursor);
    pages.push(...data.results);
    hasMore = data.has_more;
    cursor = data.next_cursor;
  }

  return pages;
}

function getProp(page, propName, type) {
  const prop = page.properties[propName];
  if (!prop) return null;

  switch (type) {
    case 'title':
      return prop.title?.map(t => t.plain_text).join('') || null;
    case 'select':
      return prop.select?.name || null;
    case 'status':
      return prop.status?.name || null;
    case 'checkbox':
      return prop.checkbox ?? null;
    case 'rich_text':
      return prop.rich_text?.map(t => t.plain_text).join('') || null;
    default:
      return null;
  }
}

function pageId(page) {
  return page.id.replace(/-/g, '');
}

// ============================================================
// 迁移函数
// ============================================================

async function migrateAreas(client) {
  console.log('\n📂 迁移 Areas...');
  const pages = await fetchAllPages(NOTION_DB_IDS.areas);
  console.log(`   找到 ${pages.length} 条记录`);

  let inserted = 0, updated = 0;

  for (const page of pages) {
    const name = getProp(page, 'Name', 'title');
    if (!name) continue;

    const row = {
      notion_id: pageId(page),
      name,
      domain: getProp(page, 'Domain', 'select'),
      archived: getProp(page, 'Archive', 'checkbox') || false,
    };

    if (DRY_RUN) {
      console.log('   [DRY] areas upsert:', row);
      continue;
    }

    const res = await client.query(`
      INSERT INTO areas (notion_id, name, domain, archived, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (notion_id) DO UPDATE SET
        name     = EXCLUDED.name,
        domain   = EXCLUDED.domain,
        archived = EXCLUDED.archived,
        updated_at = NOW()
      RETURNING (xmax = 0) AS is_insert
    `, [row.notion_id, row.name, row.domain, row.archived]);

    if (res.rows[0]?.is_insert) inserted++; else updated++;
  }

  console.log(`   ✅ 新增 ${inserted}，更新 ${updated}`);
}

async function migrateIdeas(client) {
  console.log('\n💡 迁移 XX_Ideas...');
  const pages = await fetchAllPages(NOTION_DB_IDS.ideas);
  console.log(`   找到 ${pages.length} 条记录`);

  let inserted = 0, updated = 0;

  for (const page of pages) {
    const title = getProp(page, 'Ideas', 'title');
    if (!title) continue;

    const row = {
      notion_id:   pageId(page),
      title,
      intent_type: getProp(page, 'Intent Type', 'select'),
      status:      getProp(page, 'Status', 'status') || 'Capture',
    };

    if (DRY_RUN) {
      console.log('   [DRY] ideas upsert:', row);
      continue;
    }

    const res = await client.query(`
      INSERT INTO ideas (notion_id, title, intent_type, status, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (notion_id) DO UPDATE SET
        title       = EXCLUDED.title,
        intent_type = EXCLUDED.intent_type,
        status      = EXCLUDED.status,
        updated_at  = NOW()
      RETURNING (xmax = 0) AS is_insert
    `, [row.notion_id, row.title, row.intent_type, row.status]);

    if (res.rows[0]?.is_insert) inserted++; else updated++;
  }

  console.log(`   ✅ 新增 ${inserted}，更新 ${updated}`);
}

async function migrateKnowledge(client) {
  console.log('\n📚 迁移 Knowledge_Operational...');
  const pages = await fetchAllPages(NOTION_DB_IDS.knowledge);
  console.log(`   找到 ${pages.length} 条记录`);

  let inserted = 0, updated = 0;

  for (const page of pages) {
    const name = getProp(page, 'Name', 'title');
    if (!name) continue;

    const row = {
      notion_id: pageId(page),
      name,
      type:      getProp(page, 'Type', 'select'),
      status:    getProp(page, 'Status', 'status') || 'Draft',
      sub_area:  getProp(page, 'Sub-Areas', 'select'),
      version:   getProp(page, 'Version', 'rich_text'),
      changelog: getProp(page, 'Changelog', 'rich_text'),
    };

    if (DRY_RUN) {
      console.log('   [DRY] knowledge upsert:', { notion_id: row.notion_id, name: row.name, type: row.type });
      continue;
    }

    const res = await client.query(`
      INSERT INTO knowledge (notion_id, name, type, status, sub_area, version, changelog, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (notion_id) DO UPDATE SET
        name      = EXCLUDED.name,
        type      = EXCLUDED.type,
        status    = EXCLUDED.status,
        sub_area  = EXCLUDED.sub_area,
        version   = EXCLUDED.version,
        changelog = EXCLUDED.changelog,
        updated_at = NOW()
      RETURNING (xmax = 0) AS is_insert
    `, [row.notion_id, row.name, row.type, row.status, row.sub_area, row.version, row.changelog]);

    if (res.rows[0]?.is_insert) inserted++; else updated++;
  }

  console.log(`   ✅ 新增 ${inserted}，更新 ${updated}`);
}

// ============================================================
// 主程序
// ============================================================

async function main() {
  if (DRY_RUN) {
    console.log('🔍 DRY RUN 模式 — 只打印，不写入数据库\n');
  } else {
    console.log('🚀 开始 Notion → PostgreSQL 迁移\n');
  }

  const pool = new pg.Pool(DB_DEFAULTS);
  const client = await pool.connect();

  try {
    await migrateAreas(client);
    await migrateIdeas(client);
    await migrateKnowledge(client);

    console.log('\n✅ 迁移完成！');

    if (!DRY_RUN) {
      // 打印汇总
      const counts = await client.query(`
        SELECT 'areas' AS tbl, COUNT(*) AS cnt FROM areas
        UNION ALL SELECT 'ideas', COUNT(*) FROM ideas
        UNION ALL SELECT 'knowledge', COUNT(*) FROM knowledge
      `);
      console.log('\n📊 数据库统计：');
      for (const row of counts.rows) {
        console.log(`   ${row.tbl}: ${row.cnt} 条`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('❌ 迁移失败:', err.message);
  process.exit(1);
});
