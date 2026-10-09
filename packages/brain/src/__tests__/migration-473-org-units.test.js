/**
 * 迁移 473 结构断言（链 bf5088a3 棒6，任务 80e9f816）：org_units + org_unit_members
 * 两张新表 + 种子行（company/Cecelia-ZenithJoy/Alex）。真库行为见 route 测试
 * ../routes/org-units.test.js（mock pool）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/473_org_units.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/473_org_units.down.sql', import.meta.url));

describe('migration 473', () => {
  it('文件存在（含回滚脚本）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';

  it('建 org_units 表，unit_type/status 有 CHECK 约束', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS org_units/);
    expect(sql).toMatch(/CHECK \(unit_type IN \('company', 'department'\)\)/);
    expect(sql).toMatch(/CHECK \(status IN \('active', 'incubating', 'demoted'\)\)/);
    expect(sql).toMatch(/parent_id uuid REFERENCES org_units\(id\)/);
    expect(sql).toMatch(/area_id uuid REFERENCES areas\(id\)/);
  });

  it('建 org_unit_members 轻表，member_type 有 CHECK 约束', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS org_unit_members/);
    expect(sql).toMatch(/CHECK \(member_type IN \('agent', 'human'\)\)/);
    expect(sql).toMatch(/org_unit_id uuid NOT NULL REFERENCES org_units\(id\)/);
  });

  it('种子行：company / Cecelia-ZenithJoy / leader=Alex，且幂等（WHERE NOT EXISTS）', () => {
    expect(sql).toMatch(/INSERT INTO org_units[\s\S]*'company', NULL, 'Cecelia\/ZenithJoy', 'Alex', NULL, 'active'/);
    expect(sql).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM org_units WHERE unit_type = 'company'\)/);
  });

  it('登记 schema_version 473', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'473'/);
  });

  it('回滚脚本删两张表并摘掉 schema_version 记录', () => {
    const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';
    expect(downSql).toMatch(/DROP TABLE IF EXISTS org_unit_members/);
    expect(downSql).toMatch(/DROP TABLE IF EXISTS org_units/);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '473'/);
  });
});
