/** 迁移 526（v3.0 第 5 刀①）：形状断言。行为见同名 pg 集成测试。 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/526_attach_orphan_activities_to_workflows.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/526_attach_orphan_activities_to_workflows.down.sql', import.meta.url));

describe('migration 526 attach orphan activities', () => {
  const sql = readFileSync(up, 'utf8');
  it('先给没有流程/有多个流程的能力建主线流程，再挂引用；挂引用只处理未退役且无生效引用的 Activity', () => {
    expect(sql.indexOf('INSERT INTO workflows')).toBeGreaterThan(-1);
    expect(sql.indexOf('INSERT INTO workflows')).toBeLessThan(sql.indexOf('INSERT INTO workflow_activity_refs'));
    expect(sql).toMatch(/'gp_steps_' \|\| left\(c\.id::text, 8\)/);
    expect(sql).toMatch(/a\.status <> 'deprecated'[\s\S]*NOT EXISTS \(SELECT 1 FROM workflow_activity_refs r WHERE r\.activity_id = a\.id AND r\.active\)/);
    expect(sql).toMatch(/'step_' \|\| a\.step_number/);
    expect(sql).toMatch(/ON CONFLICT[\s\S]*DO NOTHING/);
  });
  it('写 schema_version 526，事务包裹，回滚只删本迁移挂的引用与新建的主线流程', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'526'/);
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(existsSync(down)).toBe(true);
    expect(readFileSync(down, 'utf8')).toMatch(/DELETE FROM workflow_activity_refs[\s\S]*source_path = 'migration:526'/);
  });
});
