/**
 * 迁移 470 结构断言（链 bf5088a3 棒7，任务 9917a588）：skill_registry 加 task_types / dispatch_command，
 * 并把迁移当时的技能映射一次性幂等灌入账本。行为（真库 UPSERT 幂等、不覆盖其它列）见
 * integration/skill-registry-binding.pg.integration.test.js。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/470_skill_registry_task_bindings.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/470_skill_registry_task_bindings.down.sql', import.meta.url));

describe('migration 470', () => {
  it('文件存在（含回滚脚本）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';

  it('只加列（幂等）+ GIN 索引 + 登记 schema_version 470', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS task_types\s+TEXT\[\]\s+NOT NULL DEFAULT '\{\}'/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS dispatch_command\s+TEXT/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_skill_registry_task_types[\s\S]*USING GIN/);
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'470'/);
  });

  it('回填是幂等 UPSERT，且不覆盖已有行的其它列（只并集 task_types、只补空 dispatch_command）', () => {
    expect(sql).toMatch(/ON CONFLICT \(name\) DO UPDATE/);
    const upd = sql.slice(sql.indexOf('DO UPDATE'));
    const setClause = upd.slice(0, upd.indexOf(';'));
    expect(setClause).toMatch(/task_types\s*=/);
    expect(setClause).toMatch(/dispatch_command\s*=\s*COALESCE\(skill_registry\.dispatch_command/);
    // 不许出现覆盖 description/status/location/metadata 的 SET
    expect(setClause).not.toMatch(/\b(description|status|location|metadata|area_id)\s*=/);
  });


});
