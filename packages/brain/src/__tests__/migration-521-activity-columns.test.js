/**
 * 迁移 521 结构断言（树+仓库定稿 v3.0，任务 dd66b90e）：第二段第 1 刀——
 * Activity 15 列（从 contract JSON 拆出 inputs/outputs/preconditions/invariants/nfr/failure/readback，新增 judgment/adversarial/shelf_life_days）、
 * Step 8 列（name/action/inputs/outputs/on_fail）、activity_items→activity_uses、8 格固定（每个未退役 Activity 恰好有 8 个标准格，
 * 旧格子名映射，其余格子标为某一标准格的子项）、顺序归 workflow_activity_refs、标准名视图重建、备份可回滚。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/521_activity_step_columns_eight_cells.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/521_activity_step_columns_eight_cells.down.sql', import.meta.url));
const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';
const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';

const ACTIVITY_COLS = ['inputs', 'outputs', 'preconditions', 'invariants', 'nfr', 'failure', 'readback', 'judgment', 'adversarial', 'shelf_life_days'];
const STEP_COLS = ['name', 'action', 'inputs', 'outputs', 'on_fail'];
const EIGHT = ['promise', 'nfr', 'judgment', 'invariants', 'failure', 'readback', 'adversarial', 'shelf_life'];
const RENAMES = [['FR', 'promise'], ['NFR', 'nfr'], ['判定点', 'judgment'], ['不变量', 'invariants'], ['失败语义', 'failure'], ['效果确认', 'readback'], ['对抗面', 'adversarial'], ['保质期', 'shelf_life']];

describe('migration 521 — Activity/Step 列整形 + 8 格固定 + 顺序归关系表 + activity_uses', () => {
  it('文件存在（含回滚脚本），两端都在事务里', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
    expect(sql).toMatch(/\nBEGIN;/);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(downSql.trim().endsWith('COMMIT;')).toBe(true);
  });

  it('Activity 加 10 列并从 contract JSON 拆填（只填空值）；shelf_life_days 给默认', () => {
    for (const c of ACTIVITY_COLS) expect(sql, c).toMatch(new RegExp(`ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS ${c} `));
    expect(sql).toMatch(/UPDATE journey_steps SET[\s\S]*?inputs\s*=\s*COALESCE\(inputs, contract->'inputs'\)/);
    expect(sql).toMatch(/outputs\s*=\s*COALESCE\(outputs, contract->'outputs'\)/);
    expect(sql).toMatch(/preconditions\s*=\s*COALESCE\(preconditions, contract->'preconditions'\)/);
    expect(sql).toMatch(/failure\s*=\s*COALESCE\(failure, contract->'failure'\)/);
    expect(sql).toMatch(/readback\s*=\s*COALESCE\(readback, contract->'postconditions'\)/);
    expect(sql).toMatch(/invariants\s*=\s*COALESCE\(invariants,[\s\S]*?'idempotency'[\s\S]*?'side_effects'/);
    expect(sql).toMatch(/nfr\s*=\s*COALESCE\(nfr,[\s\S]*?'budget'[\s\S]*?'resources'/);
    expect(sql).toMatch(/WHERE contract IS NOT NULL/);
    expect(sql).toMatch(/UPDATE journey_steps SET shelf_life_days = 7 WHERE shelf_life_days IS NULL AND status <> 'deprecated'/);
    expect(sql).toMatch(/ALTER TABLE steps ADD COLUMN IF NOT EXISTS on_fail text[^;]*CHECK \(on_fail IS NULL OR on_fail ~ '\^\(retry:\[0-9\]\+\|abort\)\$'\)/);
    for (const c of STEP_COLS) expect(sql, c).toMatch(new RegExp(`ALTER TABLE steps ADD COLUMN IF NOT EXISTS ${c} `));
    expect(sql).toMatch(/UPDATE steps SET name = [\s\S]*?WHERE name IS NULL/);
  });

  it('activity_items 改名 activity_uses（含索引），不建旧名视图', () => {
    expect(sql).toMatch(/ALTER TABLE activity_items RENAME TO activity_uses;/);
    expect(sql).toMatch(/ALTER INDEX IF EXISTS idx_activity_items_item RENAME TO idx_activity_uses_item;/);
    expect(sql).not.toMatch(/CREATE VIEW activity_items/);
    expect(downSql).toMatch(/ALTER TABLE activity_uses RENAME TO activity_items;/);
  });

  it('8 格固定：旧格子名映射到 8 个标准键，其余 Activity 级/Step 级格子标 parent_cell_key 子项，缺的标准格补灰格并记录进备份', () => {
    expect(sql).toMatch(/ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS parent_cell_key text/);
    const map = sql.match(/UPDATE journey_step_links l SET cell_key = m\.new_key[\s\S]*?\) AS m\(old_key, new_key\)[\s\S]*?;/)?.[0] || '';
    for (const [o, n] of RENAMES) expect(map, `${o}→${n}`).toContain(`('${o}', '${n}')`);
    expect(map).toMatch(/l\.cell_level = 'activity' AND l\.cell_kind = 'element' AND l\.cell_key = m\.old_key/);
    // 旧名归一触发器：旧种子迁移重放（348/350 幂等测试）再插 'FR' 会被归到 'promise' 撞唯一键 → DO NOTHING，行数不涨
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION cells_normalize_key\(\)[\s\S]*?WHEN 'FR' THEN 'promise'[\s\S]*?WHEN '保质期' THEN 'shelf_life'/);
    expect(sql).toMatch(/CREATE TRIGGER trg_cells_normalize_key BEFORE INSERT OR UPDATE OF cell_key ON journey_step_links/);
    expect(downSql).toMatch(/DROP TRIGGER IF EXISTS trg_cells_normalize_key ON journey_step_links;\s*DROP FUNCTION IF EXISTS cells_normalize_key\(\);/);
    const eightList = EIGHT.map((k) => `'${k}'`).join(', ');
    expect(sql).toContain(eightList);
    expect(sql).toMatch(/SET parent_cell_key = 'readback'[\s\S]*?WHERE cell_level = 'activity' AND cell_kind IN \('element', 'scenario', 'capability'\)[\s\S]*?cell_key NOT IN \(/);
    expect(sql).toMatch(/SET parent_cell_key = 'invariants'[\s\S]*?cell_key = 'producer_source_revision'/);
    expect(sql).toMatch(/SET parent_cell_key = 'readback'[\s\S]*?WHERE cell_level = 'step'/);
    expect(sql).toMatch(/WITH ins AS \(\s*INSERT INTO journey_step_links \(journey_id, step_id, cell_level, cell_kind, cell_key, cell_status, status, notion_synced_at\)[\s\S]*?CROSS JOIN \(VALUES[\s\S]*?WHERE a\.status <> 'deprecated'[\s\S]*?NOT EXISTS[\s\S]*?RETURNING id\s*\)\s*INSERT INTO migration_521_backup/);
    // 只允许一处删除：旧名行与标准键行并存的重复行（非生产旧种子重放造成），且没被回执/探针引用，删的整行进备份
    const deletes = sql.match(/DELETE FROM journey_step_links[\s\S]*?;/g) || [];
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatch(/EXISTS \(SELECT 1 FROM journey_step_links x WHERE x\.step_id = l\.step_id AND x\.cell_kind = l\.cell_kind AND x\.cell_key = m\.new_key\)[\s\S]*?NOT EXISTS \(SELECT 1 FROM journey_assertion_receipts r[\s\S]*?NOT EXISTS \(SELECT 1 FROM step_probes p/);
    expect(sql).toMatch(/'journey_step_links\.dedup_deleted', id::text, to_jsonb\(dup\)/);
    expect(downSql).toMatch(/jsonb_populate_record\(NULL::journey_step_links, b\.payload\)[\s\S]*?'journey_step_links\.dedup_deleted'/);
  });

  it('有流程但没有关系行的 Activity 补 workflow_activity_refs（sequence_no = step_number，source_ref 标记迁移，冲突跳过）', () => {
    expect(sql).toMatch(/INSERT INTO workflow_activity_refs \(workflow_id, slot_key, activity_id, sequence_no, source_ref, active\)[\s\S]*?s\.step_number, 'migration:521', true[\s\S]*?WHERE s\.workflow_id IS NOT NULL[\s\S]*?NOT EXISTS \(SELECT 1 FROM workflow_activity_refs r WHERE r\.activity_id = s\.id\)[\s\S]*?ON CONFLICT DO NOTHING/);
    expect(downSql).toMatch(/DELETE FROM workflow_activity_refs WHERE source_ref = 'migration:521'/);
  });

  it('标准名视图重建以带上新列；列注释写清谁填', () => {
    expect(sql).toMatch(/CREATE OR REPLACE VIEW activities AS SELECT \* FROM journey_steps;/);
    expect(sql).toMatch(/CREATE OR REPLACE VIEW activity_cells AS SELECT \* FROM journey_step_links;/);
    expect(sql).toMatch(/COMMENT ON COLUMN journey_steps\.promise IS/);
    expect(sql).toMatch(/COMMENT ON COLUMN steps\.readback IS/);
    expect(downSql).toMatch(/DROP VIEW IF EXISTS activities;[\s\S]*?CREATE VIEW activities AS SELECT \* FROM journey_steps;/);
  });

  it('备份覆盖改名的格子；回滚还原格子名、删补的灰格与关系行、去掉新列、改回表名、删 521 版本', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS migration_521_backup/);
    expect(sql).toMatch(/INSERT INTO migration_521_backup[\s\S]*?'journey_step_links\.renamed'/);
    expect(downSql).toMatch(/UPDATE journey_step_links l SET cell_key = b\.payload->>'cell_key'[\s\S]*?b\.table_name = 'journey_step_links\.renamed'/);
    expect(downSql).toMatch(/DELETE FROM journey_step_links WHERE id IN \(SELECT row_id::uuid FROM migration_521_backup WHERE table_name = 'journey_step_links\.inserted'\)/);
    for (const c of ACTIVITY_COLS) expect(downSql, c).toMatch(new RegExp(`ALTER TABLE journey_steps DROP COLUMN IF EXISTS ${c};`));
    for (const c of STEP_COLS) expect(downSql, c).toMatch(new RegExp(`ALTER TABLE steps DROP COLUMN IF EXISTS ${c};`));
    expect(downSql).toMatch(/ALTER TABLE journey_step_links DROP COLUMN IF EXISTS parent_cell_key;/);
    expect(downSql).toMatch(/DROP TABLE IF EXISTS migration_521_backup;/);
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'521'/);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '521'/);
  });
});
