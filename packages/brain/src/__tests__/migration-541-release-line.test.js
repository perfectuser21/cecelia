/** 迁移 541（决策 de6dff5d 第 3 步 发布线）：只读 SQL 文本断言形状。 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = readFileSync(fileURLToPath(new URL('../../migrations/541_release_line.sql', import.meta.url)), 'utf8');
const downPath = fileURLToPath(new URL('../../migrations/rollback/541_release_line.down.sql', import.meta.url));

describe('migration 541 release line', () => {
  it('版本层按内容去重，构建层不加列（下游 SELECT * 读者零影响）', () => {
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS activity_versions/);
    expect(up).toMatch(/UNIQUE \(activity_id, content_md5\)/);
    expect(up).toMatch(/UNIQUE \(activity_id, version_no\)/);
    expect(up).toMatch(/md5\(\(payload - 'implementation_bindings'\)::text\)/);
    expect(up).not.toMatch(/ALTER TABLE activity_definition_versions/);
    expect(up).not.toMatch(/ALTER TABLE activities\b/);
  });
  it('生产指针独立表；事件/配方/版本/映射只追加', () => {
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS activity_release_state/);
    for (const t of ['activity_versions', 'activity_version_builds', 'activity_release_events', 'workflow_production_recipes'])
      expect(up).toMatch(new RegExp(`CREATE TRIGGER ${t}_append_only BEFORE UPDATE OR DELETE ON ${t}`));
  });
  it('初始生产版取 current_definition_version_id；consumer_evidence 不进发布线；裁判表放行 promotion_gate', () => {
    expect(up).toMatch(/m\.build_id = a\.current_definition_version_id/);
    expect(up).toMatch(/initial_migration_current_definition/);
    expect(up).toMatch(/<> 'consumer_evidence'/);
    expect(up).toMatch(/trigger_kind IN \('auto', 'manual', 'promotion_gate'\)/);
  });
  it('写 schema_version 541，事务包裹，有回滚脚本', () => {
    expect(up).toMatch(/INSERT INTO schema_version[\s\S]*'541'/);
    expect(up).toMatch(/^BEGIN;/m);
    expect(up.trim().endsWith('COMMIT;')).toBe(true);
    expect(existsSync(downPath)).toBe(true);
    const down = readFileSync(downPath, 'utf8');
    expect(down).toMatch(/DROP TABLE IF EXISTS activity_versions/);
    expect(down).toMatch(/DELETE FROM schema_version WHERE version = '541'/);
  });
});
