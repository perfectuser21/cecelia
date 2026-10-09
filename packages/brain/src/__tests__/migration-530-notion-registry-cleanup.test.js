/** 迁移 530（v3.0 第 6 刀后清理）：Notion 注册表清掉同表已有现行登记的 4 行旧库登记（先备份），旧树 Feature 镜像停推。只读 SQL 文本断言形状。 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/530_notion_registry_cleanup.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/530_notion_registry_cleanup.down.sql', import.meta.url));

describe('migration 530 notion registry cleanup', () => {
  const sql = readFileSync(up, 'utf8');
  const at = text => sql.indexOf(text);

  it('先备份，再删；只删「同表已有非 archived 登记」的 archived 旧库行（registry_coverage 每表至少留一行）', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS migration_530_notion_map_backup/);
    expect(at('migration_530_notion_map_backup')).toBeLessThan(at('DELETE FROM notion_projection_map'));
    expect(sql).toMatch(/DELETE FROM notion_projection_map[\s\S]*status = 'archived'[\s\S]*brain_table IN \('activities', 'activity_cells', 'okr_projects', 'tasks'\)[\s\S]*EXISTS \(SELECT 1 FROM notion_projection_map[\s\S]*status <> 'archived'/);
    expect(sql).not.toMatch(/DELETE FROM notion_projection_map[^;]*unmapped:/);
    expect(sql).not.toMatch(/DELETE FROM notion_projection_map[^;]*brain_table = 'journeys'/);
  });

  it('旧树 Feature 镜像改 archived 停推（保留这一行：journey_features 带 notion_id 列，需要登记）', () => {
    expect(sql).toMatch(/UPDATE notion_projection_map[\s\S]*status = 'archived'[\s\S]*direction = 'none'[\s\S]*brain_table = 'journey_features'/);
    expect(sql).not.toMatch(/DELETE FROM notion_projection_map[^;]*journey_features/);
  });

  it('不碰 journey_features 表本身与其记账列', () => {
    expect(sql).not.toMatch(/UPDATE journey_features\s/);
    expect(sql).not.toMatch(/DROP TABLE|ALTER TABLE journey_features/);
  });

  it('写 schema_version 530，事务包裹，回滚按备份还原并恢复旧树镜像为 active push', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'530'/);
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(existsSync(down)).toBe(true);
    const rollback = readFileSync(down, 'utf8');
    expect(rollback).toMatch(/INSERT INTO notion_projection_map[\s\S]*migration_530_notion_map_backup/);
    expect(rollback).toMatch(/UPDATE notion_projection_map[\s\S]*status = 'active'[\s\S]*direction = 'push'[\s\S]*journey_features/);
  });
});
