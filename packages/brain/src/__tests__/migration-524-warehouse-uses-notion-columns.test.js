/** 迁移 524（v3.0 第 3 刀 c 段）：仓库物件/用料补 Notion 记账列与 updated_at 触发器。只读 SQL 文本断言形状。 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/524_warehouse_uses_notion_columns.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/524_warehouse_uses_notion_columns.down.sql', import.meta.url));

describe('migration 524 warehouse/uses notion columns', () => {
  const sql = readFileSync(up, 'utf8');
  it('两表补 notion_id/notion_synced_at/notion_digest，用料补 updated_at，全部幂等', () => {
    for (const table of ['warehouse_items', 'activity_uses']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${table}[\\s\\S]*ADD COLUMN IF NOT EXISTS notion_id varchar[\\s\\S]*notion_synced_at timestamptz[\\s\\S]*notion_digest text`));
    }
    expect(sql).toMatch(/ALTER TABLE activity_uses[\s\S]*ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now\(\)/);
  });
  it('触发器只在业务列变化时抬 updated_at（记账列回写不抬）', () => {
    expect(sql).toMatch(/- 'notion_id' - 'notion_synced_at' - 'notion_digest' - 'updated_at'/);
    expect(sql).toMatch(/CREATE TRIGGER trg_touch_warehouse_items_updated_at/);
    expect(sql).toMatch(/CREATE TRIGGER trg_touch_activity_uses_updated_at/);
  });
  it('旧名视图 enablers 重建带新列；写 schema_version 524；事务包裹；有回滚', () => {
    expect(sql).toMatch(/CREATE OR REPLACE VIEW enablers AS SELECT \* FROM warehouse_items/);
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'524'/);
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(existsSync(down)).toBe(true);
    expect(readFileSync(down, 'utf8')).toMatch(/DROP VIEW IF EXISTS enablers;[\s\S]*DROP COLUMN IF EXISTS notion_id/);
  });
});
