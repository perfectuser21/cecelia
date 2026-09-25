/**
 * 迁移 471/472：executor_kind 白名单加 'script'，task_type 白名单加 'script_run'
 * （链 bf5088a3 棒3，任务 5cdbd52a）。照 461/462、463/464 的拆法：471 只 NOT VALID 登记，472 单独 VALIDATE。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VALID_EXECUTOR_KINDS } from '../executor-contracts.js';
import { DB_WHITELISTED_TASK_TYPES } from '../lib/task-type-registry.js';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
const strip = (sql) => sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const listOf = (sql, name) => {
  const m = sql.match(new RegExp(`${name}\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*NOT VALID`));
  expect(m, `471 里找不到 ${name}`).toBeTruthy();
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

describe('迁移 471：登记 script 与 script_run', () => {
  const file = join(MIG, '471_script_executor_kind_and_task_type.sql');
  it('文件存在，两条约束都 DROP+ADD 且 NOT VALID（不与全表扫描同事务）', () => {
    expect(existsSync(file)).toBe(true);
    const sql = strip(readFileSync(file, 'utf8'));
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS tasks_executor_kind_check/);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS tasks_task_type_check/);
    expect((sql.match(/NOT VALID/g) || []).length).toBe(2);
    expect(sql).not.toMatch(/VALIDATE CONSTRAINT/);
  });

  it("executor_kind 列表 == VALID_EXECUTOR_KINDS，且含 'script'", () => {
    const list = listOf(strip(readFileSync(file, 'utf8')), 'tasks_executor_kind_check');
    expect(list).toContain('script');
    expect([...list].sort()).toEqual([...VALID_EXECUTOR_KINDS].sort());
  });

  it("task_type 列表 == 注册表 DB 白名单，且含 'script_run'", () => {
    const list = listOf(strip(readFileSync(file, 'utf8')), 'tasks_task_type_check');
    expect(list).toContain('script_run');
    expect([...list].sort()).toEqual([...DB_WHITELISTED_TASK_TYPES].sort());
  });

  it('写 schema_version 471', () => {
    expect(readFileSync(file, 'utf8')).toMatch(/schema_version[\s\S]*'471'/);
  });
});

describe('迁移 472：VALIDATE 收尾', () => {
  const file = join(MIG, '472_validate_script_executor_constraints.sql');
  it('两条约束都 VALIDATE，写 schema_version 472', () => {
    expect(existsSync(file)).toBe(true);
    const raw = readFileSync(file, 'utf8');
    const sql = strip(raw);
    expect(sql).toMatch(/VALIDATE CONSTRAINT tasks_executor_kind_check/);
    expect(sql).toMatch(/VALIDATE CONSTRAINT tasks_task_type_check/);
    expect(raw).toMatch(/schema_version[\s\S]*'472'/);
  });
});

describe('回滚文件', () => {
  it('471/472 都有 down', () => {
    expect(existsSync(join(MIG, 'rollback', '471_script_executor_kind_and_task_type.down.sql'))).toBe(true);
    expect(existsSync(join(MIG, 'rollback', '472_validate_script_executor_constraints.down.sql'))).toBe(true);
  });
});
