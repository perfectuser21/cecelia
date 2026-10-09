/** 迁移 531（决策 ff2019e2）：执行记录 = runs（每次流程运行一行）+ spans（运行内明细）+ 汇总视图。只读 SQL 文本断言形状。 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/531_runs_table.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/531_runs_table.down.sql', import.meta.url));

describe('migration 531 runs table', () => {
  const sql = readFileSync(up, 'utf8');
  const at = text => sql.indexOf(text);

  it('建 runs：run_id 唯一（与 spans.run_id 同一把键），挂流程/闹钟总账/任务，结果与触发来源受约束，时长自动算', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS runs/);
    expect(sql).toMatch(/run_id\s+text NOT NULL UNIQUE/);
    expect(sql).toMatch(/workflow_id\s+uuid REFERENCES workflows\(id\) ON DELETE SET NULL/);
    expect(sql).toMatch(/schedule_entry_id\s+bigint REFERENCES ops_schedule_entries\(id\) ON DELETE SET NULL/);
    expect(sql).toMatch(/task_run_id\s+uuid REFERENCES task_runs\(id\) ON DELETE SET NULL/);
    expect(sql).toMatch(/trigger_kind[^,]*CHECK \(trigger_kind IN \('schedule', 'task', 'manual', 'external'\)\)/);
    expect(sql).toMatch(/outcome[^,]*CHECK \(outcome IN \('running', 'pass', 'fail', 'timeout', 'skipped', 'unknown'\)\)/);
    expect(sql).toMatch(/header_source[^,]*CHECK \(header_source IN \('owner', 'spans'\)\)/);
    expect(sql).toMatch(/duration_ms\s+integer GENERATED ALWAYS AS/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_runs_workflow_started ON runs \(workflow_id, started_at DESC\)/);
  });

  it('spans 加上级记录（自关联）与自动算出的层级列', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS parent_span_id uuid REFERENCES spans\(id\) ON DELETE SET NULL/);
    // 最深的一层优先：物件调用 > Step > Activity
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS span_level text GENERATED ALWAYS AS[\s\S]*enabler_id IS NOT NULL THEN 'enabler'[\s\S]*step_id IS NOT NULL THEN 'step'[\s\S]*ELSE 'activity'/);
  });

  it('先按已有 spans 回填运行总记录，再加 spans.run_id → runs.run_id 外键（级联删）', () => {
    expect(at('INSERT INTO runs')).toBeGreaterThan(-1);
    expect(at('INSERT INTO runs')).toBeLessThan(at('spans_run_id_fkey'));
    expect(sql).toMatch(/FOREIGN KEY \(run_id\) REFERENCES runs\(run_id\) ON DELETE CASCADE/);
  });

  it('spans 入库前保证运行总记录存在，入库后加总（只对真插入的行）', () => {
    expect(sql).toMatch(/CREATE TRIGGER spans_ensure_run BEFORE INSERT ON spans/);
    expect(sql).toMatch(/CREATE TRIGGER spans_rollup_run AFTER INSERT ON spans/);
  });

  it('流程级与 Activity 级汇总视图（24h/7d/30d）', () => {
    expect(sql).toMatch(/CREATE OR REPLACE VIEW v_workflow_run_stats/);
    expect(sql).toMatch(/CREATE OR REPLACE VIEW v_activity_span_stats/);
    expect(sql).toMatch(/percentile_cont\(0\.95\)/);
    for (const w of ['24h', '7d', '30d']) expect(sql).toContain(`'${w}'`);
  });

  it('写 schema_version 531，事务包裹，有回滚脚本', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'531'/);
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(existsSync(down)).toBe(true);
    const rollback = readFileSync(down, 'utf8');
    expect(rollback).toMatch(/DROP TABLE IF EXISTS runs/);
    expect(rollback).toMatch(/DROP COLUMN IF EXISTS parent_span_id/);
    expect(rollback).toMatch(/DELETE FROM schema_version WHERE version = '531'/);
  });
});
