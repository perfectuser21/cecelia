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

  it("471 executor_kind 加已登记的502增量后等于当前注册表，且含 script", () => {
    const list = listOf(strip(readFileSync(file, 'utf8')), 'tasks_executor_kind_check');
    expect(list).toContain('script');
    expect(readFileSync(join(MIG, '502_preview_owned_cache_janitor.sql'), 'utf8'))
      .toContain("('tasks_executor_kind_check','executor_kind','preview-janitor')");
    expect(readFileSync(join(MIG,'504_app_server_generations.sql'),'utf8')).toContain("('tasks_executor_kind_check','executor_kind','app-server-controller')");
    expect(readFileSync(join(MIG,'508_phone_dispatches.sql'),'utf8')).toContain("('tasks_executor_kind_check','executor_kind','phone-ssh-controller')");
    const imageJanitor = strip(readFileSync(join(MIG, '510_us_brain_image_retention.sql'), 'utf8'));
    expect(imageJanitor).toContain("conname='tasks_executor_kind_check'");
    expect(imageJanitor).toContain('CHECK ((%s) OR executor_kind=%L)');
    expect(imageJanitor).toContain("substring(definition FROM 8 FOR length(definition)-8),'image-janitor'");
    expect(readFileSync(join(MIG,'512_linux_pool_controller.sql'),'utf8')).toContain("substring(definition FROM 8 FOR length(definition)-8),'linux-pool-controller'");
    expect([...list, 'preview-janitor','app-server-controller','image-janitor','phone-ssh-controller','linux-pool-controller'].sort()).toEqual([...VALID_EXECUTOR_KINDS].sort());
