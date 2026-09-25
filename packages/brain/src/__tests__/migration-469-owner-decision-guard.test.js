/**
 * 迁移 469 结构断言（链 bf5088a3 棒5，任务 3fad28e0）：owner_decision 协议触发器。
 * 行为（真拦 psql 直写、存量不报错）见 integration/task-governance-guards.pg.integration.test.js。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/469_tasks_owner_decision_guard.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/469_tasks_owner_decision_guard.down.sql', import.meta.url));

describe('migration 469', () => {
  it('文件存在（含回滚脚本）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';

  it('触发器只在 blocked_reason=owner_decision 时触发（WHEN 子句，热表零开销）', () => {
    expect(sql).toMatch(/CREATE TRIGGER trg_tasks_owner_decision_protocol/);
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE ON tasks/);
    expect(sql).toMatch(/WHEN \(NEW\.blocked_reason = 'owner_decision'\)/);
  });

  it('只拦新写入：UPDATE 时 blocked_reason/blocked_detail 未变则放行（存量行不回填不报错）', () => {
    expect(sql).toMatch(/OLD\.blocked_reason IS NOT DISTINCT FROM NEW\.blocked_reason/);
    expect(sql).toMatch(/OLD\.blocked_detail IS NOT DISTINCT FROM NEW\.blocked_detail/);
  });

  it('违规抛 23514（路由层已有 23514→400 映射）', () => {
    expect(sql).toMatch(/ERRCODE = '23514'/);
    expect(sql).toMatch(/owner_decision_protocol_violation/);
  });

  it('幂等（CREATE OR REPLACE / DROP TRIGGER IF EXISTS）并登记 schema_version 469', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION/);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_tasks_owner_decision_protocol/);
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'469'/);
  });
});
