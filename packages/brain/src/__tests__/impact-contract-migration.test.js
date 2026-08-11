import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsDir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const legacyMigrationsDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));

function readMigration(name) {
  return readFileSync(`${migrationsDir}${name}`, 'utf8');
}

describe('Impact Contract 正式迁移合同', () => {
  it('迁移只存在于 migrate.js 扫描的正式目录', () => {
    expect(existsSync(`${migrationsDir}406_impact_contracts.sql`)).toBe(true);
    expect(existsSync(`${migrationsDir}407_harness_gap_ledger.sql`)).toBe(true);
    expect(existsSync(`${legacyMigrationsDir}401_impact_contracts.sql`)).toBe(false);
    expect(existsSync(`${legacyMigrationsDir}402_harness_gaps.sql`)).toBe(false);
  });

  it('Impact Contract 外键引用真实 tasks 表', () => {
    const sql = readMigration('406_impact_contracts.sql');
    expect(sql).toMatch(/task_id\s+UUID\s+NOT NULL\s+REFERENCES\s+tasks\s*\(id\)/i);
    expect(sql).not.toContain('harness_tasks');
    expect(sql).toMatch(/status\s*<>\s*'active'[\s\S]*manifest_digest\s+IS NOT NULL[\s\S]*projection_digest\s+IS NOT NULL/i);
    expect(sql).not.toMatch(/UNIQUE\s*\(task_id,\s*contract_hash\)/i);
    expect(sql).toMatch(/INDEX[\s\S]*\(task_id,\s*contract_hash\)/i);
  });

  it('Gap Ledger 加厚既有 task_dependencies 而不重建冲突表', () => {
    const sql = readMigration('407_harness_gap_ledger.sql');
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+task_dependencies/i);
    expect(sql).toMatch(/ALTER TABLE\s+task_dependencies[\s\S]*ADD COLUMN IF NOT EXISTS\s+gap_id/i);
    expect(sql).toMatch(/ALTER TABLE\s+task_dependencies[\s\S]*ADD COLUMN IF NOT EXISTS\s+status/i);
    expect(sql).toMatch(/REFERENCES\s+tasks\s*\(id\)/i);
  });

  it('每个 gap 用独立关联记录表达硬依赖，不能被相同任务对覆盖', () => {
    const sql = readMigration('407_harness_gap_ledger.sql');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS\s+harness_gap_dependencies/i);
    expect(sql).toMatch(/gap_id\s+UUID\s+PRIMARY KEY\s+REFERENCES\s+harness_gaps/i);
    expect(sql).toMatch(/source_task_id\s+UUID\s+NOT NULL\s+REFERENCES\s+tasks/i);
    expect(sql).toMatch(/repair_task_id\s+UUID\s+NOT NULL\s+REFERENCES\s+tasks/i);
  });

  it('数据库阻止 unresolved gap 被通用状态更新解除', () => {
    const sql = readMigration('407_harness_gap_ledger.sql');
    expect(sql).toContain('prevent_unresolved_harness_gap_unblock');
    expect(sql).not.toMatch(/OLD\.status\s*=\s*'blocked'/);
    expect(sql).toMatch(/NEW\.status\s+IN\s+\('queued',\s*'in_progress',\s*'completed'\)/);
    expect(sql).toContain("status <> 'resolved'");
  });

  it('数据库强制 Gap 合法状态机与可信 resolution evidence', () => {
    const sql = readMigration('407_harness_gap_ledger.sql');
    expect(sql).toContain('enforce_harness_gap_transition');
    expect(sql).toMatch(/assertion_receipt_id/);
    expect(sql).toMatch(/journey_assertion_receipts/);
    expect(sql).toMatch(/command_argv/);
    expect(sql).toMatch(/repair_completed_at/);
    expect(sql).toMatch(/verification_started_at/);
  });

  it('普通 DAG 边默认已满足 gap 状态字段，只有 gap 边显式 pending', () => {
    const sql = readMigration('407_harness_gap_ledger.sql');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS\s+status\s+TEXT\s+NOT NULL\s+DEFAULT\s+'satisfied'/i);
  });

  it('同一 run 在新 head 或新 contract 上可写新的不可变 assertion receipt', () => {
    const sql = readMigration('407_harness_gap_ledger.sql');
    expect(sql).toMatch(/UNIQUE NULLS NOT DISTINCT\s*\(\s*run_id,\s*journey_step_link_id,\s*source_sha,\s*impact_contract_hash\s*\)/);
    expect(sql).toMatch(/harness_attempt_id\s+UUID\s+REFERENCES\s+harness_attempts\s*\(id\)/i);
    expect(sql).toMatch(/impact_contract_id\s+IS\s+NOT\s+NULL[\s\S]*harness_attempt_id\s+IS\s+NOT\s+NULL/i);
  });
});
