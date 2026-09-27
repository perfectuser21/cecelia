/**
 * 迁移 478 结构断言（链 bf5088a3 棒4-2，决策 10a68212）：验证层三表接 Notion 投影。
 *  - step_probes / journey_assertion_receipts 加 notion_id / notion_synced_at / notion_digest 记账列
 *  - 回执表 append-only 触发器只放行「仅记账列变化」的 UPDATE（证据仍不可改）
 *  - journey_step_links 加 updated_at + 触发器（非记账列变化才抬，引擎回写 synced 不自激）
 *  - notion_projection_map 登记「探针」「判定回执」两库（push/active）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/478_notion_projection_probe_receipts.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/478_notion_projection_probe_receipts.down.sql', import.meta.url));
const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';
const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';

describe('migration 478', () => {
  it('文件存在（含回滚脚本）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  it('step_probes / journey_assertion_receipts 幂等加三记账列', () => {
    for (const t of ['step_probes', 'journey_assertion_receipts']) {
      for (const c of ['notion_id text', 'notion_synced_at timestamptz', 'notion_digest text']) {
        expect(sql).toMatch(new RegExp(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS ${c}`));
      }
    }
  });

  it('回执 append-only 触发器只放行记账列 UPDATE', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION prevent_journey_assertion_receipt_mutation\(\)/);
    expect(sql).toMatch(/TG_OP = 'UPDATE'/);
    expect(sql).toMatch(/to_jsonb\(NEW\) - 'notion_id' - 'notion_synced_at' - 'notion_digest'/);
    expect(sql).toMatch(/to_jsonb\(OLD\) - 'notion_id' - 'notion_synced_at' - 'notion_digest'/);
    expect(sql).toMatch(/RAISE EXCEPTION 'journey_assertion_receipts is append-only/);
  });

  it('journey_step_links 加 updated_at + 触发器（记账列变化不抬）', () => {
    expect(sql).toMatch(/ALTER TABLE journey_step_links ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now\(\)/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION touch_journey_step_links_updated_at\(\)/);
    expect(sql).toMatch(/- 'notion_id' - 'notion_synced_at' - 'notion_digest' - 'updated_at'/);
    expect(sql).toMatch(/NEW\.updated_at := now\(\)/);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_touch_journey_step_links_updated_at ON journey_step_links/);
    expect(sql).toMatch(/CREATE TRIGGER trg_touch_journey_step_links_updated_at[\s\S]*BEFORE UPDATE ON journey_step_links/);
  });

  it('注册表登记两库为 push/active，真库 id 由建库脚本产出', () => {
    expect(sql).toMatch(/INSERT INTO notion_projection_map/);
    expect(sql).toMatch(/'3e8c40c2-ba63-8182-954e-f9eda21d137e', *'探针', *'mirror', *'step_probes', *'push', *'notion-probe-projection\.pushStepProbes', *'active'/);
    expect(sql).toMatch(/'3e8c40c2-ba63-81d7-8c48-c70142b3f0bc', *'判定回执', *'mirror', *'journey_assertion_receipts', *'push', *'notion-probe-projection\.pushProbeReceipts', *'active'/);
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/);
  });

  it('登记 schema_version 478', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'478'/);
  });

  it('回滚：删列、还原 374 触发器、摘 step_links 触发器与列、删登记与 schema_version', () => {
    for (const t of ['step_probes', 'journey_assertion_receipts']) {
      for (const c of ['notion_id', 'notion_synced_at', 'notion_digest']) {
        expect(downSql).toMatch(new RegExp(`ALTER TABLE ${t} DROP COLUMN IF EXISTS ${c}`));
      }
    }
    expect(downSql).toMatch(/CREATE OR REPLACE FUNCTION prevent_journey_assertion_receipt_mutation\(\)[\s\S]*RAISE EXCEPTION/);
    expect(downSql).not.toMatch(/TG_OP = 'UPDATE'/);
    expect(downSql).toMatch(/DROP TRIGGER IF EXISTS trg_touch_journey_step_links_updated_at ON journey_step_links/);
    expect(downSql).toMatch(/DROP FUNCTION IF EXISTS touch_journey_step_links_updated_at/);
    expect(downSql).toMatch(/ALTER TABLE journey_step_links DROP COLUMN IF EXISTS updated_at/);
    expect(downSql).toMatch(/DELETE FROM notion_projection_map WHERE brain_table IN \('step_probes', 'journey_assertion_receipts'\)/);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '478'/);
  });
});
