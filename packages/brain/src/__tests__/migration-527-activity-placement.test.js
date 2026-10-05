/** 迁移 527（v3.0 第 5 刀②）：activity_placement 视图 + 放开旧直挂列的约束 + 按 (capability_key, activity_key) 唯一。只读 SQL 文本断言形状。 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/527_activity_placement_relax_legacy_columns.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/527_activity_placement_relax_legacy_columns.down.sql', import.meta.url));

describe('migration 527 activity placement', () => {
  const sql = readFileSync(up, 'utf8');
  it('视图每个 Activity 只出一行，归属引用（source_ref 为空）优先，只看生效引用', () => {
    expect(sql).toMatch(/CREATE VIEW activity_placement AS\s+SELECT DISTINCT ON \(r\.activity_id\)/);
    expect(sql).toMatch(/w\.capability_id/);
    expect(sql).toMatch(/r\.sequence_no AS step_number/);
    expect(sql).toMatch(/\(r\.source_ref IS NULL\) AS is_owner/);
    expect(sql).toMatch(/WHERE r\.active/);
    expect(sql).toMatch(/ORDER BY r\.activity_id, \(r\.source_ref IS NULL\) DESC/);
  });
  it('journey_id / step_number 放开非空、去掉按它们唯一的约束；Activity 身份改按 (capability_key, activity_key) 唯一', () => {
    expect(sql).toMatch(/ALTER COLUMN journey_id DROP NOT NULL/);
    expect(sql).toMatch(/ALTER COLUMN step_number DROP NOT NULL/);
    expect(sql).toMatch(/DROP INDEX IF EXISTS uq_journey_steps_activity/);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS activities_journey_id_step_number_key/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_activities_capability_activity ON activities \(capability_key, activity_key\) WHERE activity_key IS NOT NULL/);
  });
  it('写 schema_version 527，事务包裹，有回滚', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'527'/);
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(existsSync(down)).toBe(true);
    expect(readFileSync(down, 'utf8')).toMatch(/DROP VIEW IF EXISTS activity_placement/);
  });
});
