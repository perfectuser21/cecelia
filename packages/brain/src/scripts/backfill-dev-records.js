#!/usr/bin/env node
/**
 * backfill-dev-records.js
 *
 * 从 GitHub 获取合并 PR 列表，批量写入 dev_records 表。
 * 每条记录包含：pr_title, pr_url, branch, merged_at, learning_summary（如有）
 *
 * 用法：
 *   node packages/brain/src/scripts/backfill-dev-records.js [--limit 200]
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import pg from 'pg';

const { Pool } = pg;

const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '200', 10);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia',
});

function extractLearningSummary(branchName) {
  const learningPaths = [
    join(process.cwd(), 'docs', 'learnings', `${branchName}.md`),
    join(process.cwd(), 'docs', 'learnings', `${branchName.replace(/^cp-\d{8}-/, '')}.md`),
  ];

  for (const p of learningPaths) {
    if (!existsSync(p)) continue;
    const content = readFileSync(p, 'utf8');
    // 提取 ### 根本原因 章节
    const match = content.match(/###\s*根本原因\s*\n+([\s\S]+?)(?=###|\n---|\n##|$)/);
    if (match) {
      return match[1].trim().slice(0, 500);
    }
    // fallback：提取 ## 完成内容 后的第一段
    const completedMatch = content.match(/##\s*完成内容\s*\n+([\s\S]+?)(?=##|$)/);
    if (completedMatch) {
      return completedMatch[1].trim().slice(0, 300);
    }
  }
  return null;
}

async function backfill() {
  console.log(`[backfill-dev-records] 开始回填，limit=${LIMIT}`);

  // 1. 从 GitHub 获取合并 PR
  let prs;
  try {
    const raw = execSync(
      `gh pr list --state merged --limit ${LIMIT} --json number,title,headRefName,mergedAt,url`,
      { encoding: 'utf8', cwd: process.cwd() }
    );
    prs = JSON.parse(raw);
  } catch (err) {
    console.error('[backfill-dev-records] gh pr list 失败:', err.message);
    process.exit(1);
  }

  console.log(`[backfill-dev-records] 获取到 ${prs.length} 个合并 PR`);

  // 2. 批量写入
  let inserted = 0;
  let skipped = 0;

  for (const pr of prs) {
    const { title, headRefName: branch, mergedAt, url: prUrl } = pr;
    const learningSummary = extractLearningSummary(branch);

    try {
      const result = await pool.query(
        `INSERT INTO dev_records (task_id, pr_title, pr_url, branch, merged_at, learning_summary)
         VALUES (NULL, $1, $2, $3, $4, $5)
         ON CONFLICT (pr_url) DO NOTHING`,
        [title, prUrl, branch, mergedAt, learningSummary]
      );
      if (result.rowCount > 0) {
        inserted++;
      } else {
        skipped++;
      }
    } catch (err) {
      // 如果 ON CONFLICT (pr_url) 失败（无 unique 约束），改用 pr_url 检查
      if (err.message.includes('there is no unique or exclusion constraint')) {
        // 先查再插
        const existing = await pool.query(
          'SELECT id FROM dev_records WHERE pr_url = $1 LIMIT 1',
          [prUrl]
        );
        if (existing.rows.length === 0) {
          await pool.query(
            `INSERT INTO dev_records (task_id, pr_title, pr_url, branch, merged_at, learning_summary)
             VALUES (NULL, $1, $2, $3, $4, $5)`,
            [title, prUrl, branch, mergedAt, learningSummary]
          );
          inserted++;
        } else {
          skipped++;
        }
      } else {
        console.warn(`[backfill-dev-records] 插入失败 PR #${pr.number}: ${err.message}`);
      }
    }
  }

  console.log(`[backfill-dev-records] 完成: 新增 ${inserted} 条，跳过 ${skipped} 条（已存在）`);

  // 3. 验证结果
  const { rows } = await pool.query('SELECT count(*) FROM dev_records');
  console.log(`[backfill-dev-records] dev_records 总计: ${rows[0].count} 条`);

  await pool.end();
}

backfill().catch(err => {
  console.error('[backfill-dev-records] 未预期错误:', err);
  process.exit(1);
});
