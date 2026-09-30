/**
 * 迁移 493 结构断言（价值流建模②，任务 ef3aeffa，决策 3e867cad 第 1-3 张表 / 词表 f425e3fd）。
 * 真库行为（kind 派生 / 视图过滤 / 旧表腾名不丢行 / areas 自引用）见
 * integration/migration-493-vs-model.pg.integration.test.js。
 * 本文件还守住"代码引用已改到 capabilities_legacy"这条接线——否则生产启动后 scanner / analytics 会读到视图炸掉。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/493_vs_model_areas_kind.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/493_vs_model_areas_kind.down.sql', import.meta.url));
const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';
const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('migration 493 价值流建模②：areas 树 + journeys.kind + 视图 + 旧 capabilities 腾名', () => {
  it('文件存在（含回滚）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  it('areas 加自引用 parent_area_id（IF NOT EXISTS）+ 禁止自己当自己父亲', () => {
    expect(sql).toMatch(/ALTER TABLE areas ADD COLUMN IF NOT EXISTS parent_area_id uuid[^;]*REFERENCES areas\(id\)/);
    expect(sql).toMatch(/areas_parent_not_self CHECK \(parent_area_id IS NULL OR parent_area_id <> id\)/);
  });

  it('journeys.kind 是由 parent_journey_id 派生的生成列（无父 value_stream / 有父 capability），不靠回填', () => {
    expect(sql).toMatch(/ALTER TABLE journeys ADD COLUMN IF NOT EXISTS kind text[\s\S]*GENERATED ALWAYS AS \(CASE WHEN parent_journey_id IS NULL THEN 'value_stream' ELSE 'capability' END\) STORED/);
  });

  it('旧 capabilities 表只在它还是表时才腾名为 capabilities_legacy（幂等），不 DROP 不搬行', () => {
    expect(sql).toMatch(/relname = 'capabilities' AND c\.relkind = 'r'/);
    expect(sql).toMatch(/ALTER TABLE capabilities RENAME TO capabilities_legacy/);
    expect(sql).not.toMatch(/DROP TABLE[^;]*capabilities/);
    expect(sql).not.toMatch(/INSERT INTO system_capabilities/);
  });

  it('value_streams 只出 value_stream，新建 capabilities 视图只出有父的 journey', () => {
    expect(sql).toMatch(/CREATE VIEW value_streams AS SELECT \* FROM journeys WHERE kind = 'value_stream'/);
    expect(sql).toMatch(/CREATE VIEW capabilities AS SELECT \* FROM journeys WHERE kind = 'capability'/);
  });

  it('新视图透出 notion_id → 照 453/487 形状在 notion_projection_map 登记占位行（守夜对账不报红）', () => {
    expect(sql).toMatch(/INSERT INTO notion_projection_map[\s\S]*'unmapped:capabilities'[\s\S]*'capabilities'[\s\S]*'archived'/);
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/);
  });

  it('登记 schema_version 493；回滚还原视图、还原旧表名、删列、删注册表占位行', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'493'/);
    const d = existsSync(down) ? readFileSync(down, 'utf8') : '';
    expect(d).toMatch(/DELETE FROM notion_projection_map WHERE notion_db_id = 'unmapped:capabilities'/);
    expect(d).toMatch(/DROP VIEW IF EXISTS capabilities;/);
    expect(d).toMatch(/ALTER TABLE capabilities_legacy RENAME TO capabilities/);
    expect(d).toMatch(/DROP COLUMN IF EXISTS kind/);
    expect(d).toMatch(/CREATE OR REPLACE VIEW value_streams AS SELECT \* FROM journeys;/);
    expect(d).toMatch(/DROP COLUMN IF EXISTS parent_area_id/);
    expect(d).toMatch(/DELETE FROM schema_version WHERE version = '493'/);
  });

  it('接线：brain 代码里读写旧表的 SQL 全部改到 capabilities_legacy（视图 capabilities 没有 current_stage 列）', () => {
    const files = [
      '../capability-scanner.js',
      '../similarity.js',
      '../generate-capability-embeddings.mjs',
      '../routes/analytics.js',
    ];
    for (const f of files) {
      const text = src(f);
      const stale = text.match(/\b(FROM|INTO|UPDATE)\s+capabilities\b(?!_legacy)/g) || [];
      expect(stale, `${f} 仍引用旧表名: ${stale.join(' | ')}`).toEqual([]);
      expect(text).toMatch(/capabilities_legacy/);
    }
  });
});
