/**
 * 迁移 489：recurring_tasks.skip_streak（定时引擎复活，任务 3d0db274）。
 * 叠单跳过计数：同模板已有未完结实例时跳过并 +1，连续 3 次告警，成功建单归 0。
 * 迁移号撞号会改，测试按文件名后缀定位。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migDir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const SUFFIX = '_recurring_skip_streak';
const upName = readdirSync(migDir).find((f) => f.endsWith(`${SUFFIX}.sql`)) || '';
const version = upName.split('_')[0];
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const sql = read(`${migDir}${upName}`).replace(/^\s*--.*$/gm, '');
const downSql = read(`${migDir}rollback/${version}${SUFFIX}.down.sql`).replace(/^\s*--.*$/gm, '');

describe('migration-489-recurring-skip-streak 迁移', () => {
  it('迁移文件存在、版本号三位数且登记 schema_version', () => {
    expect(upName).toMatch(/^\d{3}_recurring_skip_streak\.sql$/);
    expect(sql).toMatch(new RegExp(`INSERT INTO schema_version[\\s\\S]*'${version}'[\\s\\S]*ON CONFLICT \\(version\\) DO NOTHING`));
  });

  it('幂等加列 skip_streak integer NOT NULL DEFAULT 0', () => {
    expect(sql).toMatch(/ALTER TABLE recurring_tasks\s+ADD COLUMN IF NOT EXISTS skip_streak integer NOT NULL DEFAULT 0/i);
  });

  it('有对应回滚：删列 + 删 schema_version 行', () => {
    expect(downSql).toMatch(/ALTER TABLE recurring_tasks\s+DROP COLUMN IF EXISTS skip_streak/i);
    expect(downSql).toMatch(new RegExp(`DELETE FROM schema_version WHERE version = '${version}'`));
  });
});
