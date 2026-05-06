/**
 * Migration 267 — DB schema drift recovery
 * 兜底 264_fix_progress_ledger_unique（漏 apply）+ 创建 task_execution_metrics 表
 *
 * 不依赖 DB（避免 CI flaky），通过读取 SQL 文件验证关键内容。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('Migration 267 — schema drift recovery', () => {
  const sqlPath = new URL('../../migrations/267_db_schema_drift_recovery.sql', import.meta.url).pathname;
  const sql = readFileSync(sqlPath, 'utf8');

  it('Part 1 添加 progress_ledger UNIQUE 约束', () => {
    expect(sql).toMatch(/ADD\s+CONSTRAINT\s+uk_progress_ledger_step/i);
    expect(sql).toMatch(/UNIQUE\s*\(\s*task_id\s*,\s*run_id\s*,\s*step_sequence\s*\)/i);
  });

  it('Part 1 必须 idempotent（DO $$ EXCEPTION 块）', () => {
    expect(sql).toMatch(/DO\s+\$\$/);
    expect(sql).toMatch(/EXCEPTION/i);
    expect(sql).toMatch(/duplicate_object/);
  });

  it('Part 2 创建 task_execution_metrics 表 IF NOT EXISTS', () => {
    expect(sql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+task_execution_metrics/i);
  });

  it('task_execution_metrics 必有 INSERT 期望的 5 个字段', () => {
    // routes/execution.js:458 INSERT INTO task_execution_metrics
    //   (task_id, account_id, duration_ms, est_requests, status)
    const tableDef = sql.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+task_execution_metrics[\s\S]+?\)\s*;/i);
    expect(tableDef, 'task_execution_metrics CREATE TABLE 块').not.toBeNull();
    const block = tableDef[0];
    expect(block).toMatch(/task_id\s+UUID/i);
    expect(block).toMatch(/account_id\s+TEXT/i);
    expect(block).toMatch(/duration_ms\s+INTEGER/i);
    expect(block).toMatch(/est_requests\s+NUMERIC/i);
    expect(block).toMatch(/status\s+TEXT/i);
  });

  it('task_execution_metrics task_id FK 到 tasks(id) ON DELETE CASCADE', () => {
    expect(sql).toMatch(/REFERENCES\s+tasks\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i);
  });

  it('task_execution_metrics 必有 task_id + created_at 索引', () => {
    expect(sql).toMatch(/idx_task_execution_metrics_task/);
    expect(sql).toMatch(/idx_task_execution_metrics_created/);
  });

  it('SQL 含背景注释解释为什么需要这次修复', () => {
    expect(sql).toMatch(/264.*没\s*apply|alphabetical|schema_version|drift/);
  });
});
