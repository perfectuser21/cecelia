import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = new URL('../../migrations/412_initiative_contract_artifacts.sql', import.meta.url);
const rollbackPath = new URL('../../migrations/rollback/412_initiative_contract_artifacts.down.sql', import.meta.url);

describe('migration 412 initiative contract artifacts', () => {
  it('创建 contract 归属、路径主键、摘要、长度和 source revision 合同', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS initiative_contract_artifacts/i);
    expect(sql).toMatch(/contract_id\s+UUID\s+NOT NULL/i);
    expect(sql).toMatch(/path\s+TEXT\s+NOT NULL/i);
    expect(sql).toMatch(/content\s+TEXT\s+NOT NULL/i);
    expect(sql).toMatch(/sha256\s+(?:CHAR\(64\)|TEXT)\s+NOT NULL/i);
    expect(sql).toMatch(/byte_length\s+INTEGER\s+NOT NULL/i);
    expect(sql).toMatch(/source_revision\s+(?:CHAR\(40\)|TEXT)\s+NOT NULL/i);
    expect(sql).toMatch(/PRIMARY KEY\s*\(contract_id,\s*path\)/i);
    expect(sql).toMatch(/REFERENCES initiative_contracts\s*\(id\)/i);
    expect(sql).toMatch(/REFERENCES initiative_contracts\s*\(id\)\s+ON DELETE RESTRICT/i);
    expect(sql).toMatch(/CHECK\s*\(byte_length\s*>=\s*0\)/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON initiative_contract_artifacts/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS initiative_contract_artifact_seals/i);
    expect(sql).toMatch(/BEFORE INSERT ON initiative_contract_artifacts/i);
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/initiative_contract_artifacts:/i);
    expect(sql).toMatch(/FROM initiative_contracts/i);
    expect(sql).toMatch(/initiative_contract_artifact_seals/i);
    expect(sql).toMatch(/VALUES\s*\(\s*'412'/i);
  });

  it('rollback 只撤销 412 自有表与 schema marker', () => {
    const sql = readFileSync(rollbackPath, 'utf8');
    expect(sql).toMatch(/DROP TABLE IF EXISTS initiative_contract_artifacts/i);
    expect(sql).toMatch(/DROP TABLE IF EXISTS initiative_contract_artifact_seals/i);
    expect(sql).toMatch(/DELETE FROM schema_version WHERE version = '412'/i);
    expect(sql).not.toMatch(/DROP TABLE IF EXISTS initiative_contracts/i);
  });
});
