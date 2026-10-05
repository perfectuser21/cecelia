/** 迁移 525（v3.0 第 2 刀 c 段）：底座引用格子并入用料后删除（先备份），旧名兼容视图下线。只读 SQL 文本断言形状。 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/525_drop_legacy_views_retire_base_ref.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/525_drop_legacy_views_retire_base_ref.down.sql', import.meta.url));

describe('migration 525 drop legacy views / retire base_ref cells', () => {
  const sql = readFileSync(up, 'utf8');
  const at = text => sql.indexOf(text);

  it('先备份、再补用料、最后删格子（顺序不能反）', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS migration_525_base_ref_cells_backup AS\s+SELECT \* FROM activity_cells WHERE cell_kind = 'base_ref'/);
    expect(sql).toMatch(/INSERT INTO activity_uses[\s\S]*legacy_feature_id = c\.feature_id[\s\S]*ON CONFLICT \(activity_id, item_id\) DO NOTHING/);
    expect(at('CREATE TABLE IF NOT EXISTS migration_525')).toBeLessThan(at('INSERT INTO activity_uses'));
    expect(at('INSERT INTO activity_uses')).toBeLessThan(at("DELETE FROM activity_cells WHERE cell_kind = 'base_ref'"));
  });

  it('三个旧名视图下线（只删视图，不 CASCADE），旧名注册表占位同删', () => {
    for (const v of ['journey_steps', 'journey_step_links', 'enablers']) expect(sql).toContain(`DROP VIEW IF EXISTS ${v};`);
    expect(sql).not.toMatch(/DROP VIEW[^;]*CASCADE/i);
    expect(sql).toMatch(/DELETE FROM notion_projection_map[\s\S]*'unmapped:journey_steps', 'unmapped:journey_step_links', 'unmapped:enablers'/);
  });

  it('写 schema_version 525，事务包裹，回滚能重建视图并还原格子', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'525'/);
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(existsSync(down)).toBe(true);
    const rollback = readFileSync(down, 'utf8');
    expect(rollback).toMatch(/CREATE VIEW journey_steps AS SELECT \* FROM activities/);
    expect(rollback).toMatch(/INSERT INTO activity_cells\s+SELECT b\.\* FROM migration_525_base_ref_cells_backup/);
  });
});
