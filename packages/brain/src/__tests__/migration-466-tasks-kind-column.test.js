/**
 * 迁移 466/467 —— tasks.kind 真列（agent | workflow）+ 按注册表回填 + VALIDATE 拆分。
 * 任务 94465721（链 bf5088a3 棒4），决策 df67a9d6 / e073bdc2。
 *
 * 回填 CASE 里的 workflow 名单是 SQL 字面量（migrate.js 只跑 SQL，进不了 JS 注册表），
 * 历史名单保留迁移当时的回填语义；当前注册表允许继续演进，不修改已运行的迁移。
 */
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TASK_KINDS } from '../lib/task-type-registry.js';

const up466 = new URL('../../migrations/466_tasks_kind_column.sql', import.meta.url);
const down466 = new URL('../../migrations/rollback/466_tasks_kind_column.down.sql', import.meta.url);
const up467 = new URL('../../migrations/467_validate_tasks_kind_check.sql', import.meta.url);
const down467 = new URL('../../migrations/rollback/467_validate_tasks_kind_check.down.sql', import.meta.url);

const read = (u) => readFileSync(u, 'utf8');

describe('migration 466 — tasks.kind 真列 + CHECK + 回填', () => {
  it('up/down 文件存在', () => {
    expect(existsSync(up466)).toBe(true);
    expect(existsSync(down466)).toBe(true);
  });

  it('加 kind TEXT 列（无 DEFAULT：NULL = 未分类，由回填清零）', () => {
    const sql = read(up466);
    expect(sql).toMatch(/ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kind TEXT;/);
    expect(sql).not.toMatch(/kind TEXT\s+(NOT NULL|DEFAULT)/i);
    expect(sql).toMatch(/COMMENT ON COLUMN tasks\.kind IS/);
  });

  it('CHECK 白名单 = TASK_KINDS，允许 NULL，NOT VALID 登记（不与 ACCESS EXCLUSIVE 同事务扫全表）', () => {
    const sql = read(up466);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS tasks_kind_check;/);
    const m = sql.match(/ADD CONSTRAINT tasks_kind_check\s+CHECK \(kind IS NULL OR kind IN \(([^)]*)\)\)\s+NOT VALID;/);
    expect(m, 'tasks_kind_check 定义形态不符').toBeTruthy();
    const listed = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(listed).toEqual([...TASK_KINDS]);
  });

  it('回填：只动 kind IS NULL 的行（幂等）、分批 5000，保留agent兜底与退出条件', () => {
    const sql = read(up466);
    expect(sql).toMatch(/DO \$\$[\s\S]*LOOP[\s\S]*UPDATE tasks SET kind = CASE[\s\S]*ELSE 'agent' END[\s\S]*WHERE kind IS NULL[\s\S]*LIMIT 5000[\s\S]*EXIT WHEN updated_count = 0[\s\S]*END\s*\$\$;/);

  });

  it('登记 schema_version 466；down 删约束、删列、删版本行', () => {
    expect(read(up466)).toMatch(/INSERT INTO schema_version[\s\S]*'466'/);
    const down = read(down466);
    expect(down).toMatch(/DROP CONSTRAINT IF EXISTS tasks_kind_check/);
    expect(down).toMatch(/DROP COLUMN IF EXISTS kind/);
    expect(down).toMatch(/DELETE FROM schema_version WHERE version = '466'/);
  });
});

describe('migration 467 — VALIDATE tasks_kind_check（照 461/462、463/464 拆法）', () => {
  it('up 只做 VALIDATE + 登记；down 只删版本行', () => {
    expect(existsSync(up467)).toBe(true);
    expect(existsSync(down467)).toBe(true);
    const up = read(up467);
    expect(up).toMatch(/ALTER TABLE tasks VALIDATE CONSTRAINT tasks_kind_check;/);
    expect(up).not.toMatch(/ADD COLUMN|ADD CONSTRAINT|UPDATE tasks/);
    expect(up).toMatch(/INSERT INTO schema_version[\s\S]*'467'/);
    expect(read(down467)).toMatch(/DELETE FROM schema_version WHERE version = '467'/);
  });
});
