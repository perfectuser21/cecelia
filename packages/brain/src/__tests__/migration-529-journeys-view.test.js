/** 迁移 529（v3.0 第 6 刀 PR-B）：journeys 空壳父表下线，改只读 UNION 视图。只读 SQL 文本断言形状；行为见 integration/migration-529-journeys-view.pg.integration.test.js。 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/529_journeys_parent_to_view.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/529_journeys_parent_to_view.down.sql', import.meta.url));

describe('migration 529 journeys parent → read-only view', () => {
  const sql = readFileSync(up, 'utf8');
  const at = text => sql.indexOf(text);

  it('先处理依赖（指标视图、外键守卫函数），再拆继承、删父表、建同名视图', () => {
    expect(sql).toMatch(/CREATE OR REPLACE VIEW activity_flow_metrics[\s\S]*LEFT JOIN capabilities cap[\s\S]*LEFT JOIN capabilities own/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION journey_ref_guard\(\)[\s\S]*FROM value_streams WHERE id = v[\s\S]*FROM capabilities WHERE id = v/);
    expect(at('CREATE OR REPLACE VIEW activity_flow_metrics')).toBeLessThan(at('NO INHERIT'));
    expect(at('CREATE OR REPLACE FUNCTION journey_ref_guard')).toBeLessThan(at('NO INHERIT'));
    expect(sql).toMatch(/ALTER TABLE value_streams NO INHERIT journeys/);
    expect(sql).toMatch(/ALTER TABLE capabilities NO INHERIT journeys/);
    expect(at('NO INHERIT')).toBeLessThan(at('DROP TABLE journeys'));
    expect(at('DROP TABLE journeys')).toBeLessThan(at('CREATE VIEW journeys'));
  });

  it('INSERT 分流触发器与函数随父表下线；视图是两张子表的 UNION ALL，不带写入能力', () => {
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_journeys_route_insert ON journeys/);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS journeys_route_insert\(\)/);
    expect(sql).toMatch(/CREATE VIEW journeys AS[\s\S]*FROM value_streams[\s\S]*UNION ALL[\s\S]*FROM capabilities/);
    expect(sql).not.toMatch(/INSTEAD OF/i);
  });

  it('子表上的身份锁与级联删除触发器保留（不在本迁移里动）', () => {
    expect(sql).not.toMatch(/DROP TRIGGER[^;]*trg_(value_streams|capabilities)_(kind_locked|after_delete)/);
    expect(sql).not.toMatch(/DROP FUNCTION[^;]*journeys_child_/);
  });

  it('删父表前确认父表是空的（有行就中止，不丢数据）', () => {
    expect(sql).toMatch(/SELECT count\(\*\) INTO[\s\S]*FROM ONLY journeys[\s\S]*RAISE EXCEPTION/);
    expect(at('FROM ONLY journeys')).toBeLessThan(at('DROP TABLE journeys'));
  });

  it('写 schema_version 529，事务包裹，回滚脚本还原继承与分流触发器', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'529'/);
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(existsSync(down)).toBe(true);
    const rollback = readFileSync(down, 'utf8');
    expect(rollback).toMatch(/DROP VIEW journeys/);
    expect(rollback).toMatch(/CREATE TABLE journeys/);
    expect(rollback).toMatch(/ALTER TABLE value_streams INHERIT journeys/);
    expect(rollback).toMatch(/ALTER TABLE capabilities INHERIT journeys/);
    expect(rollback).toMatch(/CREATE TRIGGER trg_journeys_route_insert/);
  });
});
