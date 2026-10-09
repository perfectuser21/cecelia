/**
 * 迁移 477 结构断言（棒3a-3，任务 5e9dffd2）：journey_assertion_receipts 唯一键补 assertion_ref_snapshot。
 *
 * 09-27 生产实证：run social-keyword-leadgen-crontab-auto09262230__a1.delivery 判定 judged=3，
 * 回执只落 1 行——业务探针同 run 同格且 source_sha / impact_contract_hash 皆 NULL，409 建的四列唯一键
 * NULLS NOT DISTINCT 把后两条当重复 DO NOTHING 吞掉，FAIL 行丢失，晨报「断言红灯」失明。
 * 本迁移：四列 → 五列（补 assertion_ref_snapshot），harness 一格一断言且 assertion_ref_snapshot 固定，语义不变。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/477_receipt_unique_key_assertion_ref.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/477_receipt_unique_key_assertion_ref.down.sql', import.meta.url));

describe('migration 477', () => {
  it('文件存在（含回滚脚本）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';

  it('幂等摘掉 409 的四列唯一约束/索引', () => {
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS journey_assertion_receipts_run_link_source_impact_key/);
    expect(sql).toMatch(/DROP INDEX IF EXISTS journey_assertion_receipts_run_link_source_impact_key/);
  });

  it('幂等重建五列唯一索引：(run_id, journey_step_link_id, source_sha, impact_contract_hash, assertion_ref_snapshot) NULLS NOT DISTINCT', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS journey_assertion_receipts_run_link_source_impact_ref_key/);
    expect(sql).toMatch(/\(\s*run_id,\s*journey_step_link_id,\s*source_sha,\s*impact_contract_hash,\s*assertion_ref_snapshot\s*\)\s*NULLS NOT DISTINCT/);
  });

  it('登记 schema_version 477', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'477'/);
  });

  it('回滚脚本：摘五列索引、按四列键去重后恢复 409 四列约束、摘掉 schema_version', () => {
    const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';
    expect(downSql).toMatch(/DROP INDEX IF EXISTS journey_assertion_receipts_run_link_source_impact_ref_key/);
    expect(downSql).toMatch(/DISABLE TRIGGER trg_journey_assertion_receipts_append_only/);
    expect(downSql).toMatch(/ADD CONSTRAINT journey_assertion_receipts_run_link_source_impact_key[\s\S]*UNIQUE NULLS NOT DISTINCT \(\s*run_id, journey_step_link_id, source_sha, impact_contract_hash\s*\)/);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '477'/);
  });
});
