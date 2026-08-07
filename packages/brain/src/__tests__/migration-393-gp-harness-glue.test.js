/**
 * migration-393-gp-harness-glue.test.js — GP 胶水参数化的结构断言（TDD failing test 先行）
 *
 * Task: d2567378-babb-4d7d-808c-968186223a8b
 *
 * 债2：golden_paths.base_repo / target_environment 两列，让跨 repo / 非 local_api 的 GP
 * 能自动转 harness。两列都可空——NULL 是「沿用现常量」的载体，给默认值会让存量 GP 的
 * 回落路径变成一条永远走不到的死代码。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { GP_HARNESS_TARGET_ENVIRONMENTS } from '../golden-path-contract-task.js';

const sql = readFileSync(
  new URL('../../migrations/393_gp_harness_glue.sql', import.meta.url),
  'utf8',
);
const downSql = readFileSync(
  new URL('../../migrations/rollback/393_gp_harness_glue.down.sql', import.meta.url),
  'utf8',
);

describe('migration 393 gp harness glue', () => {
  it('给 golden_paths 加两列，都是可空 TEXT（无 NOT NULL / 无 DEFAULT）', () => {
    expect(sql).toMatch(/ALTER TABLE golden_paths\s+ADD COLUMN IF NOT EXISTS base_repo TEXT;/);
    expect(sql).toMatch(/ALTER TABLE golden_paths\s+ADD COLUMN IF NOT EXISTS target_environment TEXT;/);
    expect(sql).not.toMatch(/base_repo TEXT[^;]*(NOT NULL|DEFAULT)/);
    expect(sql).not.toMatch(/target_environment TEXT[^;]*(NOT NULL|DEFAULT)/);
  });

  it('target_environment CHECK 放行 NULL 并覆盖全部合法环境枚举', () => {
    expect(sql).toMatch(/CHECK \(\s*target_environment IS NULL/);
    for (const env of GP_HARNESS_TARGET_ENVIRONMENTS) {
      expect(sql).toContain(`'${env}'`);
    }
  });

  /**
   * CHECK 里的枚举与 JS 侧写 payload 前的枚举校验必须是同一份清单。
   * 两边各写一遍是必然漂移的形态——DB 放行的值 JS 拒绝（GP 建了却转不出 harness），
   * 或 JS 放行的值 DB 拒绝（写 payload 时才 23514 炸在事务里）。
   */
  it('SQL CHECK 的枚举集合与 JS 侧 GP_HARNESS_TARGET_ENVIRONMENTS 逐字一致', () => {
    const checkBlock = sql.match(/target_environment IN \(([^)]*)\)/);
    expect(checkBlock).toBeTruthy();
    const sqlEnums = [...checkBlock[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(sqlEnums.sort()).toEqual([...GP_HARNESS_TARGET_ENVIRONMENTS].sort());
  });

  it('登记 schema_version 393', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'393'/);
  });

  it('回滚脚本删两列与 CHECK 并摘掉 393 版本行', () => {
    expect(downSql).toMatch(/ALTER TABLE golden_paths DROP CONSTRAINT IF EXISTS golden_paths_target_environment_check;/);
    expect(downSql).toMatch(/ALTER TABLE golden_paths DROP COLUMN IF EXISTS target_environment;/);
    expect(downSql).toMatch(/ALTER TABLE golden_paths DROP COLUMN IF EXISTS base_repo;/);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '393';/);
  });
});
