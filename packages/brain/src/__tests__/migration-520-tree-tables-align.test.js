/**
 * 迁移 520 结构断言（框架标准 v2.0 表名对齐，决策 61143c32，任务 b90c0f9a）第一段：
 * 价值流/能力拆两张真表（继承，journeys 留空壳父表 + 分流触发器）、activities / activity_cells / warehouse_items
 * 标准名先以视图立起来（物理表不改名，几十个测试与旧迁移重放按旧名查索引/约束/LIKE）、enablers 八货架 +
 * activity_items/item_deps、50 个挂价值流的 Activity 归位、改前原值进备份表、回滚可逆。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/520_tree_tables_align_standard.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/520_tree_tables_align_standard.down.sql', import.meta.url));
const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';
const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';

const SHELVES = ['platform_action', 'generic_action', 'data', 'service', 'ui', 'infrastructure', 'external_dependency', 'account_secret'];
const GUARDED = ['ops_schedule_entries', 'journey_steps', 'journey_step_links', 'design_docs', 'issues', 'conversations', 'golden_paths', 'captures', 'advancement_items', 'journey_features'];
const NEW_WORKFLOWS = ['harness_relay_pipeline', 'video_editing_pipeline', 'line_health_patrol', 'customer_onboarding', 'shopify_store_ops'];
const NEW_CAPS = ['c0de0520-0000-4000-8000-000000000001', 'c0de0520-0000-4000-8000-000000000002'];
const REHOME = [
  ['dddb0a71-3cda-4153-b38c-2c3a29164b1c', '3cb652ee-2756-4bff-8fa2-27ef94da1555'], // 翻拍 → 翻拍流水线
  ['636a918c-8b23-4df5-baec-b1eb3308fffb', 'b5e6287e-2597-41a9-b26f-8dba2cc18db0'], // ZJ 运营中枢 → Line 健康度
  ['e6270293-7ca3-4261-b01d-4de4c66e0352', 'c0de0520-0000-4000-8000-000000000002'], // ZJ 客户管理 → 客户开通与绑定
  ['bb4f2154-d5d3-4836-af11-aeeaa3c2e8c8', '24504f18-bea5-4c36-a663-4c94c9baeee2'], // 视频剪辑 → 视频剪辑流水线
];

describe('migration 520 — 表名对齐标准第一段：两张真表 + 标准名视图 + 八货架', () => {
  it('文件存在（含回滚脚本），两端都在事务里', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
    expect(sql).toMatch(/\nBEGIN;/);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(downSql.trim().endsWith('COMMIT;')).toBe(true);
  });

  it('价值流与能力是两张继承 journeys 的真表：根/有父 CHECK、各自主键（避开遗留 capabilities_pkey）、能力外键指价值流；旧视图先删', () => {
    expect(sql).toMatch(/DROP VIEW IF EXISTS capabilities;\s*DROP VIEW IF EXISTS value_streams;/);
    expect(sql).toMatch(/CREATE TABLE value_streams \([\s\S]*?CONSTRAINT value_streams_pk PRIMARY KEY \(id\)[\s\S]*?CHECK \(parent_journey_id IS NULL\)[\s\S]*?\) INHERITS \(journeys\)/);
    expect(sql).toMatch(/CREATE TABLE capabilities \([\s\S]*?CONSTRAINT capabilities_pk PRIMARY KEY \(id\)[\s\S]*?CHECK \(parent_journey_id IS NOT NULL\)[\s\S]*?REFERENCES value_streams\(id\)[\s\S]*?\) INHERITS \(journeys\)/);
    expect(sql).not.toMatch(/CONSTRAINT capabilities_pkey/);
    expect(sql).toMatch(/INSERT INTO value_streams[\s\S]*?FROM ONLY journeys WHERE parent_journey_id IS NULL/);
    expect(sql).toMatch(/INSERT INTO capabilities[\s\S]*?FROM ONLY journeys WHERE parent_journey_id IS NOT NULL/);
    expect(sql).toMatch(/DELETE FROM ONLY journeys;/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX idx_capabilities_capability_code ON capabilities \(capability_code\) WHERE capability_code IS NOT NULL/);
  });

  it('INSERT INTO journeys 由 AFTER INSERT 触发器分流到子表；子表已有同 id 按 DO NOTHING 跳过（旧种子重放靶这里）；身份互换被锁', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION journeys_route_insert\(\)[\s\S]*?IF EXISTS \(SELECT 1 FROM value_streams WHERE id = NEW\.id\) OR EXISTS \(SELECT 1 FROM capabilities WHERE id = NEW\.id\) THEN\s+DELETE FROM ONLY journeys WHERE id = NEW\.id;\s+RETURN NULL;/);
    expect(sql).toMatch(/IF NEW\.parent_journey_id IS NULL THEN[\s\S]*?INSERT INTO value_streams[\s\S]*?ELSE[\s\S]*?INSERT INTO capabilities[\s\S]*?DELETE FROM ONLY journeys WHERE id = NEW\.id;[\s\S]*?RETURN NULL;/);
    expect(sql).toMatch(/CREATE TRIGGER trg_journeys_route_insert AFTER INSERT ON journeys FOR EACH ROW/);
    expect(sql).toMatch(/CREATE TRIGGER trg_value_streams_kind_locked BEFORE UPDATE OF parent_journey_id ON value_streams/);
    expect(sql).toMatch(/CREATE TRIGGER trg_capabilities_kind_locked\s+BEFORE UPDATE OF parent_journey_id ON capabilities/);
  });

  it('workflows 外键改指 capabilities 并撤掉旧守卫；其余 10 张引用表改触发器守卫（闹钟总账也走守卫，不卡挂价值流的测试数据）；删除级联照原语义', () => {
    expect(sql).toMatch(/ALTER TABLE workflows ADD CONSTRAINT workflows_capability_id_fkey\s+FOREIGN KEY \(capability_id\) REFERENCES capabilities\(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_workflows_capability_guard ON workflows;\s*DROP FUNCTION IF EXISTS workflows_capability_guard\(\);/);
    expect(sql).not.toMatch(/ops_schedule_entries ADD CONSTRAINT/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION journey_ref_guard\(\)[\s\S]*?NOT EXISTS \(SELECT 1 FROM journeys WHERE id = v\)[\s\S]*?ERRCODE = 'foreign_key_violation'/);
    for (const t of GUARDED) {
      expect(sql, t).toMatch(new RegExp(`CREATE TRIGGER trg_journey_ref_${t}\\s+BEFORE INSERT OR UPDATE OF (journey_id|ref_journey_id)\\s+ON ${t}\\s+FOR EACH ROW EXECUTE FUNCTION journey_ref_guard\\('(journey_id|ref_journey_id)'\\)`));
    }
    // ability_groups 是没有迁移建表的孤儿表：所有触碰必须条件化，CI/scratch 空库才能过
    for (const stmt of [...sql.matchAll(/^[^\n-]*ability_groups[^\n]*$/gm)].map((m) => m[0])) {
      expect(stmt, stmt).toMatch(/to_regclass\('public\.ability_groups'\)|EXECUTE|RAISE EXCEPTION|仍被/);
    }
    expect(sql).toMatch(/IF to_regclass\('public\.ability_groups'\) IS NOT NULL THEN\s+EXECUTE \$t\$CREATE TRIGGER trg_journey_ref_ability_groups/);
    expect(sql).toMatch(/CREATE TRIGGER trg_value_streams_after_delete AFTER DELETE ON value_streams/);
    expect(sql).toMatch(/CREATE TRIGGER trg_capabilities_after_delete\s+AFTER DELETE ON capabilities/);
    expect(sql).toMatch(/DELETE FROM journey_step_links WHERE journey_id = OLD\.id;\s*DELETE FROM journey_steps WHERE journey_id = OLD\.id;/);
    for (const t of ['ops_schedule_entries', 'design_docs', 'issues', 'advancement_items', 'journey_features']) expect(sql, t).toMatch(new RegExp(`UPDATE ${t} SET journey_id = NULL WHERE journey_id = OLD\\.id`));
    expect(sql).toMatch(/UPDATE captures SET ref_journey_id = NULL WHERE ref_journey_id = OLD\.id/);
  });

  it('activities / activity_cells / warehouse_items 以自动可更新视图立名，物理表本段不改名（无 RENAME）', () => {
    expect(sql).toMatch(/CREATE VIEW activities AS SELECT \* FROM journey_steps;/);
    expect(sql).toMatch(/CREATE VIEW activity_cells AS SELECT \* FROM journey_step_links;/);
    expect(sql).toMatch(/CREATE VIEW warehouse_items AS SELECT \* FROM enablers;/);
    expect(sql).not.toMatch(/RENAME TO/);
    expect(sql).toMatch(/INSERT INTO notion_projection_map[\s\S]*?'unmapped:activities'[\s\S]*?'unmapped:activity_cells'[\s\S]*?WHERE NOT EXISTS \(SELECT 1 FROM notion_projection_map m WHERE m\.notion_db_id = v\.db_id\)/);
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
    expect(sql).toMatch(/UPDATE journey_step_links c SET journey_id = a\.journey_id[\s\S]*?WHERE a\.id = c\.step_id AND c\.journey_id IS DISTINCT FROM a\.journey_id/);
    expect(sql).toMatch(/FROM journey_steps a JOIN value_streams v ON v\.id = a\.journey_id;[\s\S]*?RAISE WARNING/);
  });

  it('仓库：enablers 加 shelf 八货架 NOT NULL + CHECK，旧 3 行与新 19 行全部上架且带旧树溯源', () => {
    expect(sql).toMatch(/ALTER TABLE enablers ALTER COLUMN shelf SET NOT NULL;/);
    const check = sql.match(/enablers_shelf_check\s+CHECK \(shelf IN \(([^)]*)\)\)/)?.[1] || '';
    for (const s of SHELVES) expect(check, s).toContain(`'${s}'`);
    expect(check.split(',').length).toBe(8);
    for (const key of ['return_to_results', 'device_lock', 'account_selfcheck']) expect(sql).toMatch(new RegExp(`UPDATE enablers SET shelf = '[a-z_]+'\\s+WHERE key = '${key}'`));
    const items = sql.match(/INSERT INTO enablers \(key, name, kind, shelf, impl_ref, description, legacy_feature_id\)[\s\S]*?ON CONFLICT \(key\) DO NOTHING;/)?.[0] || '';
    const rows = [...items.matchAll(/^\s*\('([a-z_]+)',\s*'[^']+',\s*'([a-z]+)',\s*'([a-z_]+)'/gm)];
    expect(rows.length).toBe(19);
    for (const [, key, , shelf] of rows) expect(SHELVES, `${key} 的货架 ${shelf}`).toContain(shelf);
    expect(items).toMatch(/COALESCE\(\(SELECT f\.id FROM journey_features f WHERE f\.name = v\.legacy_name[\s\S]*?\(SELECT c\.feature_id FROM journey_step_links c WHERE c\.cell_kind = 'base_ref' AND c\.cell_key = v\.cell_key/);
  });

  it('连线表：activity_items（Activity→物件，唯一）与 item_deps（物件→物件，禁自指）；底座类格子复制成连线、本段不删（blast-radius 还在读）', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS activity_items \([\s\S]*?activity_id\s+uuid NOT NULL REFERENCES journey_steps\(id\) ON DELETE CASCADE[\s\S]*?item_id\s+uuid NOT NULL REFERENCES enablers\(id\) ON DELETE CASCADE[\s\S]*?UNIQUE \(activity_id, item_id\)/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS item_deps \([\s\S]*?PRIMARY KEY \(item_id, depends_on_item_id\),\s*CHECK \(item_id <> depends_on_item_id\)/);
    expect(sql).toMatch(/FROM enabler_calls ec\s+WHERE ec\.caller_type = 'activity'/);
    expect(sql).toMatch(/FROM journey_steps a WHERE a\.enabler_id IS NOT NULL/);
    expect(sql).toMatch(/WHERE c\.cell_level = 'enabler' AND c\.enabler_id IS NOT NULL/);
    expect(sql).toMatch(/\('CRM 表底座','crm_table_base'\)[\s\S]*?WHERE c\.cell_kind = 'base_ref'/);
    expect(sql).not.toMatch(/DELETE FROM journey_step_links WHERE cell_kind/);
    expect(sql).not.toMatch(/DELETE FROM journey_features/);
    // 被格子引用的底座件不改 workflow_ref：journey_features 触发器会把它同步成格子 assertion_ref，'item:' 会被 373 数据刀判成不认识的断言
    expect(sql).toMatch(/UPDATE journey_features f SET status = 'deprecated',\s+workflow_ref = CASE WHEN EXISTS \(SELECT 1 FROM journey_step_links l WHERE l\.feature_id = f\.id\) THEN f\.workflow_ref ELSE 'item:' \|\| w\.key END/);
  });

  it('备份覆盖三类原值；回滚按备份还原、并回 journeys、复原 13 条外键 + 旧守卫 + 两个旧视图、删备份表与 520 版本', () => {
    for (const t of ['journey_steps', 'journey_step_links.rehome', 'journey_features']) {
      expect(sql, t).toMatch(new RegExp(`INSERT INTO migration_520_backup[\\s\\S]*?'${t.replace('.', '\\.')}'`));
    }
    expect(downSql).toMatch(/DROP TABLE IF EXISTS item_deps;\s*DROP TABLE IF EXISTS activity_items;\s*DROP VIEW IF EXISTS warehouse_items;/);
    expect(downSql).toMatch(/DROP VIEW IF EXISTS activities;\s*DROP VIEW IF EXISTS activity_cells;/);
    expect(downSql).toMatch(/DELETE FROM notion_projection_map WHERE notion_db_id IN \('unmapped:activities','unmapped:activity_cells'\)/);
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
