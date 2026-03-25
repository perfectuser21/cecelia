#!/usr/bin/env node
/**
 * backfill-decisions.js
 *
 * 从 CLAUDE.md 文件提取架构决策，批量写入 decisions 表。
 * 支持全局 ~/.claude/CLAUDE.md 和项目 .claude/CLAUDE.md。
 *
 * 用法：
 *   node packages/brain/src/scripts/backfill-decisions.js [--dry-run]
 */

/* global process, console */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import pg from 'pg';

const { Pool } = pg;

const DRY_RUN = process.argv.includes('--dry-run');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia',
});

/**
 * 从 CLAUDE.md 提取决策条目
 * @param {string} content - 文件内容
 * @param {string} source - 来源标识（'global' | 'project'）
 * @returns {{ category: string, topic: string, decision: string, reason: string }[]}
 */
function extractDecisions(content, source) {
  const decisions = [];

  // 按二级标题分段
  const sections = content.split(/\n## /).filter(Boolean);

  for (const section of sections) {
    const lines = section.trim().split('\n');
    const sectionTitle = lines[0].replace(/^#+\s*/, '').trim();

    if (!sectionTitle) continue;

    // 跳过纯目录/结构章节
    const skipSections = ['仓库结构', '加载策略', '目录', 'Table of Contents'];
    if (skipSections.some(s => sectionTitle.includes(s))) continue;

    // 确定 category
    let category = 'architecture';
    if (sectionTitle.includes('禁止') || sectionTitle.includes('规则') || sectionTitle.includes('边界')) {
      category = 'process';
    } else if (sectionTitle.includes('版本') || sectionTitle.includes('semver')) {
      category = 'process';
    }

    // 提取列表项（每个 - 开头的条目）
    const listItems = lines.filter(l => l.trim().startsWith('- ') && l.trim().length > 5);
    for (const item of listItems) {
      const text = item.trim().replace(/^- /, '').trim();
      if (text.length < 10) continue;

      decisions.push({
        category,
        topic: `[${source}] ${sectionTitle}: ${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`,
        decision: text,
        reason: `来源：CLAUDE.md §${sectionTitle}（${source}）`,
      });
    }

    // 如果没有列表项，用整段内容作为一条决策
    if (listItems.length === 0) {
      const body = lines.slice(1).join('\n').trim();
      if (body.length < 20) continue;

      decisions.push({
        category,
        topic: `[${source}] ${sectionTitle}`,
        decision: body.slice(0, 500),
        reason: `来源：CLAUDE.md §${sectionTitle}（${source}）`,
      });
    }
  }

  return decisions;
}

async function backfill() {
  console.log('[backfill-decisions] 开始回填，dry_run=' + DRY_RUN);

  const claudeMdPaths = [
    { path: join(homedir(), '.claude', 'CLAUDE.md'), source: 'global' },
    { path: join(process.cwd(), '.claude', 'CLAUDE.md'), source: 'project' },
  ];

  let allDecisions = [];
  for (const { path, source } of claudeMdPaths) {
    if (!existsSync(path)) {
      console.log(`[backfill-decisions] 跳过（文件不存在）: ${path}`);
      continue;
    }
    const content = readFileSync(path, 'utf8');
    const decisions = extractDecisions(content, source);
    console.log(`[backfill-decisions] 从 ${source} 提取 ${decisions.length} 条决策`);
    allDecisions = allDecisions.concat(decisions);
  }

  console.log(`[backfill-decisions] 总计 ${allDecisions.length} 条待写入`);

  if (DRY_RUN) {
    for (const d of allDecisions) {
      console.log(`  [DRY] category=${d.category} topic=${d.topic.slice(0, 60)}`);
    }
    await pool.end();
    return;
  }

  let inserted = 0;
  let skipped = 0;

  for (const d of allDecisions) {
    try {
      // 按 topic 去重
      const existing = await pool.query(
        'SELECT id FROM decisions WHERE topic = $1 LIMIT 1',
        [d.topic]
      );
      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      await pool.query(
        `INSERT INTO decisions (category, topic, decision, reason, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [d.category, d.topic, d.decision, d.reason]
      );
      inserted++;
    } catch (err) {
      console.warn(`[backfill-decisions] 写入失败: ${err.message}`);
    }
  }

  console.log(`[backfill-decisions] 完成: 新增 ${inserted} 条，跳过 ${skipped} 条（已存在）`);

  // 验证结果
  const { rows } = await pool.query(
    "SELECT count(*) FROM decisions WHERE category IS NOT NULL AND category != ''"
  );
  console.log(`[backfill-decisions] decisions 有 category 总计: ${rows[0].count} 条`);

  await pool.end();
}

backfill().catch(err => {
  console.error('[backfill-decisions] 未预期错误:', err);
  process.exit(1);
});
