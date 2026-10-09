/** 迁移 534：迁移 520「格子跟随所属 Activity」把共享 Activity 上按消费者能力登记的回归格（cell_key=regression:<能力>:...）一并改到了 Activity 的能力，按 cell_key 改回。 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/534_restore_regression_consumer_capability.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/534_restore_regression_consumer_capability.down.sql', import.meta.url));

describe('migration 534 回归格归还消费者能力', () => {
  const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';
  const code = sql.replace(/--[^\n]*/g, '');

  it('事务包裹、先备份再改、写 schema_version 534', () => {
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS migration_534_backup/);
    expect(code.indexOf('INSERT INTO migration_534_backup')).toBeGreaterThan(-1);
    expect(code.indexOf('INSERT INTO migration_534_backup')).toBeLessThan(code.indexOf('UPDATE activity_cells'));
    expect(code).toMatch(/INSERT INTO schema_version[\s\S]*'534'/);
  });

  it('只改 scenario 回归格，目标能力取自 cell_key，且该能力确有生效流程在用此 Activity', () => {
    const update = code.slice(code.indexOf('UPDATE activity_cells'));
    expect(update).toMatch(/cell_kind = 'scenario'/);
    expect(update).toMatch(/cell_key LIKE 'regression:%'/);
    expect(update).toMatch(/split_part\(c\.cell_key, ':', 2\)/);
    expect(update).toMatch(/journey_id IS DISTINCT FROM/);
    expect(update).toMatch(/workflow_activity_refs[\s\S]*r\.active[\s\S]*w\.capability_id[\s\S]*w\.status <> 'retired'/);
  });

  it('不碰空骨架格、不删行', () => {
    expect(code).not.toMatch(/DELETE FROM activity_cells/);
    expect(code).not.toMatch(/cell_kind = 'element'/);
  });

  it('有回滚脚本，按备份还原 journey_id', () => {
    expect(existsSync(down)).toBe(true);
    const d = readFileSync(down, 'utf8');
    expect(d).toMatch(/UPDATE activity_cells[\s\S]*migration_534_backup/);
    expect(d).toMatch(/DELETE FROM schema_version WHERE version = '534'/);
  });
});
