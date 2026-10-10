/** 迁移 538（决策 de6dff5d 五块模型·裁判）：activity_judgments 裁判结果只追加表。只读 SQL 文本断言形状。 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/538_activity_judgments.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/538_activity_judgments.down.sql', import.meta.url));

describe('migration 538 activity_judgments', () => {
  const sql = readFileSync(up, 'utf8');
  it('建表：Activity、定义版本外键、裁决受约束、连续绿/要求绿、报告 jsonb、裁判时间', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS activity_judgments/);
    expect(sql).toMatch(/activity_id\s+uuid NOT NULL/);
    expect(sql).toMatch(/activity_definition_version_id\s+uuid REFERENCES activity_definition_versions\(id\)/);
    expect(sql).toMatch(/verdict[^,]*CHECK \(verdict IN \('converged', 'converging', 'diverged', 'no_data'\)\)/);
    expect(sql).toMatch(/consecutive_green\s+integer NOT NULL/);
    expect(sql).toMatch(/required_green\s+integer NOT NULL/);
    expect(sql).toMatch(/trigger_kind[^,]*CHECK \(trigger_kind IN \('auto', 'manual'\)\)/);
    expect(sql).toMatch(/report\s+jsonb NOT NULL/);
    expect(sql).toMatch(/judged_at\s+timestamptz NOT NULL DEFAULT now\(\)/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_activity_judgments_activity_judged ON activity_judgments \(activity_id, judged_at DESC\)/);
  });
  it('只追加：UPDATE/DELETE 由触发器拒绝', () => {
    expect(sql).toMatch(/CREATE TRIGGER activity_judgments_append_only BEFORE UPDATE OR DELETE ON activity_judgments/);
  });
  it('Activity 不加外键（Activity 被删时裁判史保留、不阻塞删除）', () => {
    expect(sql).not.toMatch(/activity_id\s+uuid NOT NULL REFERENCES/);
  });
  it('写 schema_version 538，事务包裹，有回滚脚本', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'538'/);
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(existsSync(down)).toBe(true);
    const rollback = readFileSync(down, 'utf8');
    expect(rollback).toMatch(/DROP TABLE IF EXISTS activity_judgments/);
    expect(rollback).toMatch(/DELETE FROM schema_version WHERE version = '538'/);
  });
});
