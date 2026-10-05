/**
 * 迁移 520 结构断言（框架标准 v2.0 表名对齐，决策 61143c32，任务 b90c0f9a）第一段：
 * 价值流/能力拆两张真表（继承，journeys 留空壳父表 + 分流触发器）、journey_steps→activities、
 * journey_step_links→activity_cells、enablers→warehouse_items 八货架 + activity_items/item_deps、
 * 50 个挂价值流的 Activity 归位、旧名全部留兼容视图、改前原值进备份表、回滚可逆。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/520_tree_tables_align_standard.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/520_tree_tables_align_standard.down.sql', import.meta.url));
const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';
const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';

const SHELVES = ['platform_action', 'generic_action', 'data', 'service', 'ui', 'infrastructure', 'external_dependency', 'account_secret'];
const MIXED_REF_TABLES = ['design_docs', 'issues', 'conversations', 'golden_paths', 'captures', 'advancement_items', 'journey_features'];
const NEW_WORKFLOWS = ['harness_relay_pipeline', 'video_editing_pipeline', 'line_health_patrol', 'customer_onboarding', 'shopify_store_ops'];
const NEW_CAPS = ['c0de0520-0000-4000-8000-000000000001', 'c0de0520-0000-4000-8000-000000000002'];
const REHOME = [
  ['dddb0a71-3cda-4153-b38c-2c3a29164b1c', '3cb652ee-2756-4bff-8fa2-27ef94da1555'], // 翻拍 → 翻拍流水线
  ['636a918c-8b23-4df5-baec-b1eb3308fffb', 'b5e6287e-2597-41a9-b26f-8dba2cc18db0'], // ZJ 运营中枢 → Line 健康度
  ['e6270293-7ca3-4261-b01d-4de4c66e0352', 'c0de0520-0000-4000-8000-000000000002'], // ZJ 客户管理 → 客户开通与绑定
  ['bb4f2154-d5d3-4836-af11-aeeaa3c2e8c8', '24504f18-bea5-4c36-a663-4c94c9baeee2'], // 视频剪辑 → 视频剪辑流水线
];

describe('migration 520 — 表名对齐标准：两张真表 / activities / activity_cells / warehouse_items', () => {
  it('文件存在（含回滚脚本），两端都在事务里', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
    expect(sql).toMatch(/\nBEGIN;/);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(downSql.trim().endsWith('COMMIT;')).toBe(true);
  });

  it('价值流与能力是两张继承 journeys 的真表：根/有父 CHECK、各自主键、能力外键指价值流；旧视图先删', () => {
    expect(sql).toMatch(/DROP VIEW IF EXISTS capabilities;\s*DROP VIEW IF EXISTS value_streams;/);
    expect(sql).toMatch(/CREATE TABLE value_streams \([\s\S]*?PRIMARY KEY \(id\)[\s\S]*?CHECK \(parent_journey_id IS NULL\)[\s\S]*?\) INHERITS \(journeys\)/);
    expect(sql).toMatch(/CREATE TABLE capabilities \([\s\S]*?PRIMARY KEY \(id\)[\s\S]*?CHECK \(parent_journey_id IS NOT NULL\)[\s\S]*?REFERENCES value_streams\(id\)[\s\S]*?\) INHERITS \(journeys\)/);
    expect(sql).toMatch(/INSERT INTO value_streams[\s\S]*?FROM ONLY journeys WHERE parent_journey_id IS NULL/);
    expect(sql).toMatch(/INSERT INTO capabilities[\s\S]*?FROM ONLY journeys WHERE parent_journey_id IS NOT NULL/);
    expect(sql).toMatch(/DELETE FROM ONLY journeys;/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX idx_capabilities_capability_code ON capabilities \(capability_code\) WHERE capability_code IS NOT NULL/);
  });

  it('INSERT INTO journeys 由 AFTER INSERT 触发器按 parent_journey_id 分流到子表并从父表删掉；身份互换被锁', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION journeys_route_insert\(\)[\s\S]*?IF NEW\.parent_journey_id IS NULL THEN[\s\S]*?INSERT INTO value_streams[\s\S]*?ELSE[\s\S]*?INSERT INTO capabilities[\s\S]*?DELETE FROM ONLY journeys WHERE id = NEW\.id;[\s\S]*?RETURN NULL;/);
    expect(sql).toMatch(/CREATE TRIGGER trg_journeys_route_insert AFTER INSERT ON journeys FOR EACH ROW/);
    expect(sql).toMatch(/CREATE TRIGGER trg_value_streams_kind_locked BEFORE UPDATE OF parent_journey_id ON value_streams/);
    expect(sql).toMatch(/CREATE TRIGGER trg_capabilities_kind_locked\s+BEFORE UPDATE OF parent_journey_id ON capabilities/);
  });

  it('只指能力的外键改指 capabilities 并撤掉旧守卫触发器；混指两种的 8 张表 + Activity/格子 改为触发器守卫；删除级联照原语义', () => {
    expect(sql).toMatch(/ALTER TABLE workflows ADD CONSTRAINT workflows_capability_id_fkey\s+FOREIGN KEY \(capability_id\) REFERENCES capabilities\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_workflows_capability_guard ON workflows;\s*DROP FUNCTION IF EXISTS workflows_capability_guard\(\);/);
    expect(sql).toMatch(/ALTER TABLE ops_schedule_entries ADD CONSTRAINT ops_schedule_entries_journey_id_fkey\s+FOREIGN KEY \(journey_id\) REFERENCES capabilities\(id\) ON DELETE SET NULL/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION journey_ref_guard\(\)[\s\S]*?NOT EXISTS \(SELECT 1 FROM journeys WHERE id = v\)[\s\S]*?ERRCODE = 'foreign_key_violation'/);
    for (const t of [...MIXED_REF_TABLES, 'activities', 'activity_cells']) {
      expect(sql, t).toMatch(new RegExp(`CREATE TRIGGER trg_journey_ref_${t}\\s+BEFORE INSERT OR UPDATE OF (journey_id|ref_journey_id)\\s+ON ${t}\\s+FOR EACH ROW EXECUTE FUNCTION journey_ref_guard\\('(journey_id|ref_journey_id)'\\)`));
    }
    // ability_groups 是没有迁移建表的孤儿表：所有触碰必须条件化，CI/scratch 空库才能过
    for (const stmt of [...sql.matchAll(/^[^\n-]*ability_groups[^\n]*$/gm)].map((m) => m[0])) {
      expect(stmt, stmt).toMatch(/to_regclass\('public\.ability_groups'\)|EXECUTE|RAISE EXCEPTION|仍被/);
    }
    expect(sql).toMatch(/IF to_regclass\('public\.ability_groups'\) IS NOT NULL THEN\s+EXECUTE \$t\$CREATE TRIGGER trg_journey_ref_ability_groups/);
    expect(sql).toMatch(/CREATE TRIGGER trg_value_streams_after_delete AFTER DELETE ON value_streams/);
    expect(sql).toMatch(/CREATE TRIGGER trg_capabilities_after_delete\s+AFTER DELETE ON capabilities/);
    expect(sql).toMatch(/DELETE FROM activity_cells WHERE journey_id = OLD\.id;\s*DELETE FROM activities WHERE journey_id = OLD\.id;/);
    for (const t of ['design_docs', 'issues', 'advancement_items', 'journey_features']) expect(sql, t).toMatch(new RegExp(`UPDATE ${t} SET journey_id = NULL WHERE journey_id = OLD\\.id`));
    expect(sql).toMatch(/UPDATE captures SET ref_journey_id = NULL WHERE ref_journey_id = OLD\.id/);
  });

  it('Activity / 格子 改名并留自动可更新的兼容视图（旧名 SELECT * FROM 新名）', () => {
    expect(sql).toMatch(/ALTER TABLE journey_steps RENAME TO activities;\s*ALTER TABLE journey_step_links RENAME TO activity_cells;/);
    expect(sql).toMatch(/CREATE VIEW journey_steps AS SELECT \* FROM activities;/);
    expect(sql).toMatch(/CREATE VIEW journey_step_links AS SELECT \* FROM activity_cells;/);
    // 改名必须先于守卫触发器建立（触发器挂在新名上）
    expect(sql.indexOf('RENAME TO activities')).toBeLessThan(sql.indexOf('trg_journey_ref_activities'));
  });

  it('50 个挂在价值流上的 Activity 归位到能力：新建 2 个能力、5 条流程，映射齐全，Harness 编号 +100，格子跟随，归位后仍挂价值流的只告警', () => {
    for (const id of NEW_CAPS) expect(sql, id).toContain(`'${id}'`);
    expect(sql).toMatch(/INSERT INTO capabilities \(id, name, description, parent_journey_id, status, area_id, biz_area\)[\s\S]*?JOIN value_streams p ON p\.id = v\.parent::uuid[\s\S]*?ON CONFLICT \(id\) DO NOTHING/);
    const wfInsert = sql.match(/INSERT INTO workflows \(capability_id, key, name, channel, form, status\)[\s\S]*?ON CONFLICT \(key\) DO NOTHING;/)?.[0] || '';
    for (const key of NEW_WORKFLOWS) expect(wfInsert, key).toContain(`'${key}'`);
    expect(wfInsert).toMatch(/WHERE EXISTS \(SELECT 1 FROM capabilities c WHERE c\.id = v\.capability_id::uuid\)/);
    for (const [vs, cap] of REHOME) {
      const row = sql.split('\n').find((l) => l.includes(vs) && l.includes(cap));
      expect(row, `${vs} → ${cap}`).toBeTruthy();
    }
    expect(sql).toMatch(/a\.name = '商品上架\(草稿创建\)'[\s\S]{0,200}6bd7e841-14bf-4630-b667-418c39a64918|6bd7e841-14bf-4630-b667-418c39a64918[\s\S]{0,300}a\.name = '商品上架\(草稿创建\)'/);
    expect(sql).toMatch(/a\.journey_id = 'afa6abca-53c0-4815-8594-b7fb81ca547f'/);
    expect(sql).toMatch(/SET journey_id = 'a1000000-0000-4000-8000-000000000001'/);
    expect(sql).toMatch(/step_number = a\.step_number \+ 100[\s\S]*?WHERE name = 'Cecelia Harness Pipeline'/);
    expect(sql).toMatch(/UPDATE activity_cells c SET journey_id = a\.journey_id[\s\S]*?WHERE a\.id = c\.step_id AND c\.journey_id IS DISTINCT FROM a\.journey_id/);
    expect(sql).toMatch(/FROM activities a JOIN value_streams v ON v\.id = a\.journey_id;[\s\S]*?RAISE WARNING/);
  });

  it('仓库：enablers → warehouse_items，shelf 八货架 NOT NULL + CHECK，旧 3 行与新 19 行全部上架，enablers 留兼容视图', () => {
    expect(sql).toMatch(/ALTER TABLE enablers RENAME TO warehouse_items;/);
    expect(sql).toMatch(/ALTER TABLE warehouse_items ALTER COLUMN shelf SET NOT NULL;/);
    const check = sql.match(/warehouse_items_shelf_check\s+CHECK \(shelf IN \(([^)]*)\)\)/)?.[1] || '';
    for (const s of SHELVES) expect(check, s).toContain(`'${s}'`);
    expect(check.split(',').length).toBe(8);
    for (const key of ['return_to_results', 'device_lock', 'account_selfcheck']) expect(sql).toMatch(new RegExp(`UPDATE warehouse_items SET shelf = '[a-z_]+'\\s+WHERE key = '${key}'`));
    const items = sql.match(/INSERT INTO warehouse_items \(key, name, kind, shelf, impl_ref, description, legacy_feature_id\)[\s\S]*?ON CONFLICT \(key\) DO NOTHING;/)?.[0] || '';
    const rows = [...items.matchAll(/^\s*\('([a-z_]+)',\s*'[^']+',\s*'([a-z]+)',\s*'([a-z_]+)'/gm)];
    expect(rows.length).toBe(19);
    for (const [, key, , shelf] of rows) expect(SHELVES, `${key} 的货架 ${shelf}`).toContain(shelf);
    expect(items).toContain('legacy_name');
    expect(sql).toMatch(/CREATE VIEW enablers AS\s+SELECT id, key, name, kind, impl_ref, owner, description, active, created_at, updated_at FROM warehouse_items;/);
  });

  it('连线表：activity_items（Activity→物件，唯一）与 item_deps（物件→物件，禁自指）；底座类格子复制成连线、本段不删（blast-radius 还在读）', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS activity_items \([\s\S]*?activity_id\s+uuid NOT NULL REFERENCES activities\(id\) ON DELETE CASCADE[\s\S]*?item_id\s+uuid NOT NULL REFERENCES warehouse_items\(id\) ON DELETE CASCADE[\s\S]*?UNIQUE \(activity_id, item_id\)/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS item_deps \([\s\S]*?PRIMARY KEY \(item_id, depends_on_item_id\),\s*CHECK \(item_id <> depends_on_item_id\)/);
    expect(sql).toMatch(/FROM enabler_calls ec\s+WHERE ec\.caller_type = 'activity'/);
    expect(sql).toMatch(/FROM activities a WHERE a\.enabler_id IS NOT NULL/);
    expect(sql).toMatch(/WHERE c\.cell_level = 'enabler' AND c\.enabler_id IS NOT NULL/);
    expect(sql).toMatch(/\('CRM 表底座','crm_table_base'\)[\s\S]*?WHERE c\.cell_kind = 'base_ref'/);
    // 第一段不删格子行：blast-radius 端点仍按 feature_id 读 base_ref 格子；原行已备份，第二段切换后再删
    expect(sql).not.toMatch(/DELETE FROM activity_cells WHERE cell_kind/);
    expect(sql).toContain("'journey_step_links.deleted'");
    // 旧树 enabler/界面类 只标不删
    expect(sql).not.toMatch(/DELETE FROM journey_features/);
    expect(sql).toMatch(/UPDATE journey_features f SET status = 'deprecated', workflow_ref = 'item:' \|\| w\.key/);
  });

  it('备份覆盖 四类原值；回滚按备份还原、并回 journeys、复原 13 条外键 + 旧守卫 + 两个旧视图、删备份表与 520 版本', () => {
    for (const t of ['journey_steps', 'journey_step_links.rehome', 'journey_step_links.deleted', 'journey_features']) {
      expect(sql, t).toMatch(new RegExp(`INSERT INTO migration_520_backup[\\s\\S]*?'${t.replace('.', '\\.')}'`));
    }
    expect(downSql).toMatch(/DROP TABLE IF EXISTS item_deps;\s*DROP TABLE IF EXISTS activity_items;\s*DROP VIEW IF EXISTS enablers;/);
    expect(downSql).toMatch(/ALTER TABLE warehouse_items RENAME TO enablers;/);
    expect(downSql).toMatch(/ALTER TABLE activities RENAME TO journey_steps;\s*ALTER TABLE activity_cells RENAME TO journey_step_links;/);
    expect(downSql).toMatch(/jsonb_populate_record\(NULL::journey_step_links, b\.payload\)/);
    expect(downSql).toMatch(/DROP TRIGGER IF EXISTS trg_journeys_route_insert ON journeys;/);
    expect(downSql).toMatch(/INSERT INTO journeys[\s\S]*?FROM value_streams;[\s\S]*?INSERT INTO journeys[\s\S]*?FROM capabilities;\s*DROP TABLE capabilities;\s*DROP TABLE value_streams;/);
    for (const c of ['journeys_parent_journey_id_fkey', 'workflows_capability_id_fkey', 'ops_schedule_entries_journey_id_fkey', 'journey_steps_journey_id_fkey',
      'journey_step_links_journey_id_fkey', 'design_docs_journey_id_fkey', 'issues_journey_id_fkey', 'conversations_journey_id_fkey', 'golden_paths_journey_id_fkey',
      'captures_ref_journey_id_fkey', 'advancement_items_journey_id_fkey', 'ability_groups_journey_id_fkey', 'journey_features_journey_id_fkey']) {
      expect(downSql, c).toMatch(new RegExp(`ADD CONSTRAINT ${c} FOREIGN KEY`));
    }
    expect(downSql).toMatch(/CREATE TRIGGER trg_workflows_capability_guard BEFORE INSERT OR UPDATE OF capability_id ON workflows/);
    expect(downSql).toMatch(/CREATE VIEW value_streams AS SELECT \* FROM journeys WHERE kind = 'value_stream';\s*CREATE VIEW capabilities\s+AS SELECT \* FROM journeys WHERE kind = 'capability';/);
    expect(downSql).toMatch(/DROP TABLE IF EXISTS migration_520_backup;/);
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'520'/);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '520'/);
  });
});
