#!/usr/bin/env node
/**
 * distill-learnings.js
 *
 * 扫描 docs/learnings/*.md，提取每个文件中 "### 下次预防" 章节的 checklist 条目，
 * 每条条目写入 Brain knowledge 表（type='learning_rule'），幂等执行。
 *
 * 用法：node packages/brain/scripts/distill-learnings.js [--dry-run]
 *
 * 幂等保证：ON CONFLICT (type, sub_area) DO NOTHING
 * 因为每个文件只生成一条 learning_rule（合并所有 checklist 项），
 * (type='learning_rule', sub_area=filename) 唯一。
 */

import { readFileSync, readdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const LEARNINGS_DIR = join(REPO_ROOT, 'docs', 'learnings');

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * 从 markdown 内容中提取 "### 下次预防" 章节的 checklist 条目
 * @param {string} content
 * @returns {string[]} checklist 条目文本列表（去除 "- [ ] " 前缀）
 */
function extractPreventionItems(content) {
  // 找到 ### 下次预防 章节
  const sectionMatch = content.match(/###\s*下次预防\s*\n([\s\S]*?)(?=\n###|\n##|\n#|$)/);
  if (!sectionMatch) return [];

  const sectionContent = sectionMatch[1];
  const items = [];

  for (const line of sectionContent.split('\n')) {
    // 匹配 "- [ ] ..." 或 "- [x] ..." 格式
    const itemMatch = line.match(/^-\s*\[[ xX]\]\s*(.+)/);
    if (itemMatch) {
      const text = itemMatch[1].trim();
      if (text) items.push(text);
    }
  }

  return items;
}

/**
 * 从文件名推断 tags
 * @param {string} filename
 * @returns {string[]}
 */
function inferTags(filename, items) {
  const tags = new Set();

  // 从文件名推断
  if (filename.includes('ci')) tags.add('ci');
  if (filename.includes('migration')) tags.add('migration');
  if (filename.includes('test')) tags.add('test');
  if (filename.includes('hook')) tags.add('hook');
  if (filename.includes('brain')) tags.add('brain');
  if (filename.includes('engine')) tags.add('engine');
  if (filename.includes('dod')) tags.add('dod');
  if (filename.includes('learning')) tags.add('learning');
  if (filename.includes('version')) tags.add('version');
  if (filename.includes('fix')) tags.add('fix');
  if (filename.includes('deploy')) tags.add('deploy');

  // 从 items 内容推断
  const itemsText = items.join(' ').toLowerCase();
  if (itemsText.includes('ci') || itemsText.includes('github action')) tags.add('ci');
  if (itemsText.includes('migration') || itemsText.includes('数据库')) tags.add('migration');
  if (itemsText.includes('test') || itemsText.includes('测试')) tags.add('test');
  if (itemsText.includes('hook') || itemsText.includes('钩子')) tags.add('hook');
  if (itemsText.includes('commit') || itemsText.includes('push')) tags.add('git');
  if (itemsText.includes('dod') || itemsText.includes('验收')) tags.add('dod');

  return Array.from(tags);
}

async function main() {
  // 读取 docs/learnings/ 目录
  let files;
  try {
    files = readdirSync(LEARNINGS_DIR).filter(f => f.endsWith('.md'));
  } catch (err) {
    console.error(`❌ 无法读取目录 ${LEARNINGS_DIR}: ${err.message}`);
    process.exit(1);
  }

  console.log(`📂 扫描 ${files.length} 个 learning 文件...`);

  // 提取所有规则
  const rules = [];
  for (const file of files) {
    const filePath = join(LEARNINGS_DIR, file);
    let content;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch (err) {
      console.warn(`  ⚠️  跳过 ${file}: ${err.message}`);
      continue;
    }

    const items = extractPreventionItems(content);
    if (items.length === 0) continue;

    // 每个文件生成一条 learning_rule，name 用第一条条目，content 存全部
    const tags = inferTags(file.toLowerCase(), items);
    rules.push({
      source: file,
      name: items[0].slice(0, 200), // name 最多 200 字符
      sub_area: file,               // 文件名作为 sub_area（唯一标识）
      content: JSON.stringify({
        source: `docs/learnings/${file}`,
        items,
        tags,
      }),
      tags,
    });
  }

  console.log(`✅ 提炼出 ${rules.length} 条 learning_rule`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] 将写入以下规则（不实际插入）：');
    for (const r of rules.slice(0, 5)) {
      console.log(`  - ${r.source}: ${r.name.slice(0, 60)}...`);
    }
    if (rules.length > 5) console.log(`  ... 还有 ${rules.length - 5} 条`);
    return;
  }

  // 写入数据库
  const pool = new Pool({
    database: process.env.PGDATABASE || 'cecelia',
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || undefined,
  });

  let inserted = 0;
  let skipped = 0;

  try {
    for (const rule of rules) {
      const result = await pool.query(
        `INSERT INTO knowledge (name, type, status, sub_area, content)
         VALUES ($1, 'learning_rule', 'Active', $2, $3)
         ON CONFLICT (type, sub_area)
         WHERE type IS NOT NULL AND sub_area IS NOT NULL
         DO NOTHING`,
        [rule.name, rule.sub_area, rule.content]
      );

      if (result.rowCount > 0) {
        inserted++;
      } else {
        skipped++;
      }
    }
  } finally {
    await pool.end();
  }

  console.log(`\n📊 写入结果：`);
  console.log(`   新增：${inserted} 条`);
  console.log(`   已存在（跳过）：${skipped} 条`);
  console.log(`   总计 learning_rule：${inserted + skipped} 条`);

  if (inserted + skipped < 25) {
    console.error(`❌ 规则数量不足 25 条（实际：${inserted + skipped}），请检查 docs/learnings/ 文件格式`);
    process.exit(1);
  }

  console.log(`✅ distill-learnings 完成`);
}

main().catch(err => {
  console.error('❌ 执行失败:', err.message);
  process.exit(1);
});
