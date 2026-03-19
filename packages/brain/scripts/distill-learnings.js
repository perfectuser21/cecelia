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
 * 使用 psql CLI 写入，无需 npm install pg。
 */

import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const LEARNINGS_DIR = join(REPO_ROOT, 'docs', 'learnings');

const DRY_RUN = process.argv.includes('--dry-run');
const PGDATABASE = process.env.PGDATABASE || 'cecelia';

/**
 * 从 markdown 内容中提取 "### 下次预防" 章节的 checklist 条目
 * @param {string} content
 * @returns {string[]} checklist 条目文本列表（去除 "- [ ] " 前缀）
 */
function extractPreventionItems(content) {
  const sectionMatch = content.match(/###\s*下次预防\s*\n([\s\S]*?)(?=\n###|\n##|\n#|$)/);
  if (!sectionMatch) return [];

  const sectionContent = sectionMatch[1];
  const items = [];

  for (const line of sectionContent.split('\n')) {
    const itemMatch = line.match(/^-\s*\[[ xX]\]\s*(.+)/);
    if (itemMatch) {
      const text = itemMatch[1].trim();
      if (text) items.push(text);
    }
  }

  return items;
}

/**
 * 从文件名和条目内容推断 tags
 */
function inferTags(filename, items) {
  const tags = new Set();
  const keywords = {
    ci: ['ci', 'github action'],
    migration: ['migration', '数据库'],
    test: ['test', '测试'],
    hook: ['hook', '钩子'],
    brain: ['brain'],
    engine: ['engine'],
    dod: ['dod', '验收'],
    learning: ['learning'],
    version: ['version'],
    fix: ['fix'],
    git: ['commit', 'push'],
  };

  const combined = (filename + ' ' + items.join(' ')).toLowerCase();
  for (const [tag, words] of Object.entries(keywords)) {
    if (words.some(w => combined.includes(w))) tags.add(tag);
  }

  return Array.from(tags);
}

/**
 * 转义 SQL 字符串（单引号加倍）
 */
function sqlEscape(str) {
  return str.replace(/'/g, "''");
}

/**
 * 用 psql 执行 SQL 文件
 */
function psqlRun(sql) {
  const tmpFile = join(REPO_ROOT, '.distill-learnings-tmp.sql');
  try {
    writeFileSync(tmpFile, sql, 'utf8');
    const result = execSync(`psql "${PGDATABASE}" -f "${tmpFile}" -t -A 2>&1`, {
      encoding: 'utf8',
    });
    return result.trim();
  } finally {
    try { unlinkSync(tmpFile); } catch (_) { /* ignore */ }
  }
}

function main() {
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

    const tags = inferTags(file.toLowerCase(), items);
    rules.push({
      source: file,
      name: items[0].slice(0, 200),
      sub_area: file,
      content: JSON.stringify({ source: `docs/learnings/${file}`, items, tags }),
    });
  }

  console.log(`✅ 提炼出 ${rules.length} 条 learning_rule`);

  if (DRY_RUN) {
    console.log(`[DRY RUN] 将写入 ${rules.length} 条 learning_rule（不实际插入）`);
    rules.slice(0, 3).forEach(r => console.log(`  - ${r.source}: ${r.name.slice(0, 60)}...`));
    if (rules.length > 3) console.log(`  ... 还有 ${rules.length - 3} 条`);
    if (rules.length < 25) {
      console.error(`❌ 规则数不足 25 条（实际 ${rules.length}），请检查 docs/learnings/ 文件格式`);
      process.exit(1);
    }
    console.log(`✅ 验证通过：${rules.length} 条 ≥ 25`);
    return;
  }

  // 构建批量 INSERT SQL（幂等：ON CONFLICT DO NOTHING）
  const valueLines = rules.map(r =>
    `  ('${sqlEscape(r.name)}', 'learning_rule', 'Active', '${sqlEscape(r.sub_area)}', '${sqlEscape(r.content)}')`
  );

  const sql = `
INSERT INTO knowledge (name, type, status, sub_area, content)
VALUES
${valueLines.join(',\n')}
ON CONFLICT (type, sub_area)
WHERE type IS NOT NULL AND sub_area IS NOT NULL
DO NOTHING;

SELECT COUNT(*) FROM knowledge WHERE type = 'learning_rule';
`;

  let output;
  try {
    output = psqlRun(sql);
  } catch (err) {
    console.error(`❌ psql 执行失败: ${err.message}`);
    process.exit(1);
  }

  // 解析最后一行（COUNT）
  const lines = output.split('\n').filter(l => l.trim());
  const total = parseInt(lines[lines.length - 1], 10);

  console.log(`\n📊 写入结果：`);
  console.log(`   knowledge 表 learning_rule 总计：${total} 条`);

  if (total < 25) {
    console.error(`❌ 规则数量不足 25 条（实际：${total}），请检查 docs/learnings/ 文件格式`);
    process.exit(1);
  }

  // ── 同步写入 learnings 表（learning-retriever.js 从此表读取） ──
  console.log(`\n🔄 同步写入 learnings 表...`);

  // 逐条 INSERT，用 WHERE NOT EXISTS 按 content_hash 去重（learnings 表无唯一约束）
  const learningsInserts = rules.map(r => {
    const contentHash = createHash('sha256').update(r.name).digest('hex').slice(0, 64);
    const contentObj = JSON.parse(r.content);
    // 从 source 字段提取分支名（格式: docs/learnings/cp-MMDDHHNN-branch-name.md）
    const sourceFile = contentObj.source || '';
    const branchMatch = sourceFile.match(/cp-\d{8}-(.+)\.md$/);
    const sourceBranch = branchMatch ? `cp-${branchMatch[1]}` : '';
    const metadata = JSON.stringify({ source_file: r.sub_area, tags: contentObj.tags || [] });

    return `INSERT INTO learnings (title, category, content, learning_type, metadata, is_latest, source_branch, content_hash)
SELECT '${sqlEscape(r.name)}', 'process_improvement', '${sqlEscape(r.content)}', 'best_practice', '${sqlEscape(metadata)}'::jsonb, true, '${sqlEscape(sourceBranch)}', '${contentHash}'
WHERE NOT EXISTS (SELECT 1 FROM learnings WHERE content_hash = '${contentHash}');`;
  });

  const learningsSql = `
${learningsInserts.join('\n')}

SELECT COUNT(*) FROM learnings WHERE learning_type = 'best_practice';
`;

  let learningsOutput;
  try {
    learningsOutput = psqlRun(learningsSql);
  } catch (err) {
    console.error(`⚠️  learnings 表写入失败（不影响 knowledge 表结果）: ${err.message}`);
    learningsOutput = '';
  }

  if (learningsOutput) {
    const lLines = learningsOutput.split('\n').filter(l => l.trim());
    const lTotal = parseInt(lLines[lLines.length - 1], 10);
    console.log(`   learnings 表 best_practice 总计：${lTotal} 条`);
  }

  console.log(`✅ distill-learnings 完成`);
}

main();
