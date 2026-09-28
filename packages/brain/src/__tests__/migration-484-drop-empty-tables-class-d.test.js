/**
 * 迁移 484 结构断言（决策 28674999 / 959d081f，任务 a39b2cde）：删除 D 类 7 张空表，引用代码同 PR 删。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/484_drop_empty_tables_class_d.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/484_drop_empty_tables_class_d.down.sql', import.meta.url));
const sql = (existsSync(up) ? readFileSync(up, 'utf8') : '').replace(/^\s*--.*$/gm, '');
const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';
const TABLES = ['alex_pages', 'dev_execution_logs', 'dev_reviews', 'llm_usage_snapshots', 'content_topics', 'tick_history', 'project_repos'];
const drop = (sql.match(/DROP TABLE IF EXISTS([\s\S]*?);/) || [])[1] || '';

describe('migration 484', () => {
  it('文件存在（含回滚）', () => { expect(existsSync(up)).toBe(true); expect(existsSync(down)).toBe(true); });
  it('7 张表同一条 DROP，无清单外表、无 CASCADE', () => {
    for (const t of TABLES) expect(drop).toContain(`public.${t}`);
    expect(drop.match(/public\./g)).toHaveLength(7);
    expect(sql).not.toMatch(/CASCADE/i);
  });
  it('非空闸覆盖 7 张', () => {
    const guard = sql.slice(0, sql.indexOf('DROP TABLE'));
    expect(guard).toMatch(/RAISE EXCEPTION/);
    for (const t of TABLES) expect(guard).toContain(`'${t}'`);
  });
  it('schema_version 484；回滚重建 7 表并删版本', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'484'/);
    expect(downSql.match(/^CREATE TABLE /gm)).toHaveLength(7);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '484'/);
  });
  it('引用代码已删：源码不再读写这 7 张表', async () => {
    const { execSync } = await import('node:child_process');
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const pat = `(FROM|JOIN|INTO|UPDATE)[[:space:]]+(${TABLES.join('|')})([[:space:](,;]|$)`;
    const out = execSync(`git grep -lE '${pat}' -- packages/brain/src apps/api/src ':!*__tests__*' ':!*.test.*' || true`, { cwd: root, encoding: 'utf8' });
    expect(out.trim()).toBe('');
  });
});
