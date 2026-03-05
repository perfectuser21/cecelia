#!/usr/bin/env node
/**
 * 执行 goal_id 回填迁移并触发 KR 进度更新
 *
 * Usage: node scripts/run-migration-backfill-goal-id.mjs
 */

import pool from '../src/db.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  console.log('📋 执行迁移：回填 task goal_id');

  const migrationFile = join(__dirname, '../migrations/20260305_backfill_task_goal_id.sql');
  console.log(`   迁移文件: ${migrationFile}`);
  console.log('');

  // 读取 SQL 文件
  const sql = readFileSync(migrationFile, 'utf-8');

  try {
    // 执行迁移
    console.log('🔄 执行 SQL 迁移...');
    const result = await pool.query(sql);
    console.log('✅ 迁移执行成功');
    console.log(`   受影响的行数: ${result.rowCount || 0}`);

    // 查询回填后的统计
    const nullCountResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM tasks
      WHERE goal_id IS NULL AND status = 'completed'
    `);
    console.log(`   剩余 goal_id 为 null 的已完成任务: ${nullCountResult.rows[0].count}`);

    // 查询受影响的 KR
    const affectedKRs = await pool.query(`
      SELECT DISTINCT pkl.kr_id, g.title AS kr_title
      FROM tasks t
      JOIN projects initiative ON initiative.id = t.project_id AND initiative.type = 'initiative'
      JOIN projects project ON project.id = initiative.parent_id AND project.type = 'project'
      JOIN project_kr_links pkl ON pkl.project_id = project.id
      JOIN goals g ON g.id = pkl.kr_id
      WHERE t.goal_id IS NOT NULL
        AND t.status = 'completed'
        AND t.updated_at >= NOW() - INTERVAL '1 minute'
    `);

    console.log('');
    console.log('🔄 受影响的 KR:');
    affectedKRs.rows.forEach(kr => {
      console.log(`   - ${kr.kr_title} (${kr.kr_id})`);
    });

    // 触发 KR 进度更新
    console.log('');
    console.log('🔄 触发 KR 进度更新...');

    const { updateKrProgress } = await import('../src/kr-progress.js');

    for (const kr of affectedKRs.rows) {
      const result = await updateKrProgress(pool, kr.kr_id);
      console.log(`   ✅ ${kr.kr_title}: ${result.completed}/${result.total} = ${result.progress}%`);
    }

    console.log('');
    console.log('✅ 迁移完成');
  } catch (error) {
    console.error('❌ 迁移执行失败:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

runMigration().catch(error => {
  console.error(error);
  process.exit(1);
});
