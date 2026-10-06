/** 迁移 528（v3.0 第 5 刀③）：删 Activity 旧直挂列。只读 SQL 文本断言形状；行为由全量集成测试在已删列的库上兜底。 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/528_drop_activity_legacy_columns.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/528_drop_activity_legacy_columns.down.sql', import.meta.url));

describe('migration 528 drop activity legacy columns', () => {
  const sql = readFileSync(up, 'utf8');
  const at = text => sql.indexOf(text);

  it('先处理依赖（别名视图、指标视图、级联函数、守卫触发器），再备份，最后删三列', () => {
    expect(sql).toMatch(/DROP VIEW IF EXISTS backbone_activities/);
    expect(sql).toMatch(/CREATE OR REPLACE VIEW activity_flow_metrics[\s\S]*activity_placement/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION journeys_child_after_delete[\s\S]*DELETE FROM activity_cells WHERE journey_id = OLD\.id/);
    expect(sql).not.toMatch(/DELETE FROM activities WHERE journey_id/);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_journey_ref_journey_steps ON activities/);
    expect(at('CREATE TABLE IF NOT EXISTS migration_528_activity_columns_backup')).toBeLessThan(at('ALTER TABLE activities DROP COLUMN'));
    expect(sql).toMatch(/DROP COLUMN journey_id, DROP COLUMN step_number, DROP COLUMN enabler_id/);
  });

  it('身份键 capability_key / activity_key 与 workflow_id 保留（定义版本和合同同步靠它认人）', () => {
    expect(sql).not.toMatch(/DROP COLUMN[^;]*(capability_key|activity_key|workflow_id)/);
  });

  it('写 schema_version 528，事务包裹，回滚按备份还原', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'528'/);
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(existsSync(down)).toBe(true);
    expect(readFileSync(down, 'utf8')).toMatch(/UPDATE activities a SET journey_id = b\.journey_id[\s\S]*migration_528_activity_columns_backup/);
  });
});
