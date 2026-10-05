/**
 * 迁移 522 结构断言（树+仓库 v3.0 第 2 刀 a 段，任务 6112bbcc）：
 * 三张物理表换成标准名 activities / activity_cells / warehouse_items，旧名 journey_steps / journey_step_links / enablers 降为自动可更新视图；
 * 主键/唯一/CHECK 约束随名；引用旧名的函数改指新名；回滚完全可逆。代码仍走旧名视图（切名在 b 段）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/522_physical_rename_standard_names.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/522_physical_rename_standard_names.down.sql', import.meta.url));
const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';
const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';

const PAIRS = [['journey_steps', 'activities'], ['journey_step_links', 'activity_cells'], ['enablers', 'warehouse_items']];

describe('migration 522 — 物理换名：标准名成为真表，旧名降为视图', () => {
  it('文件存在（含回滚脚本），两端都在事务里', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
    expect(sql).toMatch(/\nBEGIN;/);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(downSql.trim().endsWith('COMMIT;')).toBe(true);
  });

  it('先删 521 的三个标准名视图，再把三张物理表改成标准名，最后用旧名建 SELECT * 视图', () => {
    expect(sql).toMatch(/DROP VIEW IF EXISTS activities;\s*DROP VIEW IF EXISTS activity_cells;\s*DROP VIEW IF EXISTS warehouse_items;/);
    for (const [oldName, newName] of PAIRS) {
      expect(sql, newName).toMatch(new RegExp(`ALTER TABLE ${oldName} RENAME TO ${newName};`));
      expect(sql, oldName).toMatch(new RegExp(`CREATE VIEW ${oldName} AS SELECT \\* FROM ${newName};`));
    }
    expect(sql.indexOf('DROP VIEW IF EXISTS activities')).toBeLessThan(sql.indexOf('ALTER TABLE journey_steps RENAME TO activities'));
    expect(sql.indexOf('ALTER TABLE journey_steps RENAME TO activities')).toBeLessThan(sql.indexOf('CREATE VIEW journey_steps AS'));
  });

  it('主键/唯一/CHECK 约束名随表改成标准前缀（只改旧前缀开头且新名不存在的）', () => {
    expect(sql).toMatch(/pg_constraint[\s\S]*?contype IN \('p', 'u', 'c'\)/);
    for (const [oldName, newName] of PAIRS) expect(sql, oldName).toContain(`('${oldName}', '${newName}')`);
    expect(sql).toMatch(/ALTER TABLE %I RENAME CONSTRAINT %I TO %I/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM pg_constraint[\s\S]*?conname = new_name/);
  });

  it('引用旧名的两个函数改指新名（journeys_child_after_delete / enforce_harness_gap_transition），回滚改回', () => {
    expect(sql).toMatch(/replace\(pg_get_functiondef\('enforce_harness_gap_transition'::regproc\), 'journey_step_links AS link', 'activity_cells AS link'\)/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION journeys_child_after_delete\(\)[\s\S]*?DELETE FROM activity_cells WHERE journey_id = OLD\.id;\s*DELETE FROM activities WHERE journey_id = OLD\.id;/);
    expect(downSql).toMatch(/replace\(pg_get_functiondef\('enforce_harness_gap_transition'::regproc\), 'activity_cells AS link', 'journey_step_links AS link'\)/);
    expect(downSql).toMatch(/DELETE FROM journey_step_links WHERE journey_id = OLD\.id;\s*DELETE FROM journey_steps WHERE journey_id = OLD\.id;/);
  });

  it('投影注册表不动：旧名视图仍有 notion_id 列、已有登记行有效；521 的 unmapped 占位行因标准名成真表而保留', () => {
    expect(sql).not.toMatch(/DELETE FROM notion_projection_map/);
    expect(sql).not.toMatch(/UPDATE notion_projection_map/);
  });

  it('回滚：删旧名视图 → 表改回旧名 → 重建三个标准名视图 → 约束名改回 → 删 522 版本', () => {
    expect(downSql).toMatch(/DROP VIEW IF EXISTS journey_steps;\s*DROP VIEW IF EXISTS journey_step_links;\s*DROP VIEW IF EXISTS enablers;/);
    for (const [oldName, newName] of PAIRS) {
      expect(downSql, newName).toMatch(new RegExp(`ALTER TABLE ${newName} RENAME TO ${oldName};`));
      expect(downSql, newName).toMatch(new RegExp(`CREATE VIEW ${newName} AS SELECT \\* FROM ${oldName};`));
    }
    expect(downSql).toMatch(/ALTER TABLE %I RENAME CONSTRAINT %I TO %I/);
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'522'/);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '522'/);
  });
});
