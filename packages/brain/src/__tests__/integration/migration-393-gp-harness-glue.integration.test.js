import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, afterAll } from 'vitest';
import pool from '../../db.js';
import { GP_HARNESS_TARGET_ENVIRONMENTS } from '../../golden-path-contract-task.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOWN_SQL = fs.readFileSync(
  path.join(__dirname, '../../../migrations/rollback/393_gp_harness_glue.down.sql'),
  'utf-8'
);

describe('migration 393 结构断言（golden_paths 胶水两列）', () => {
  afterAll(async () => { await pool.end(); });

  it('golden_paths 有 base_repo / target_environment 两列且都可空', async () => {
    const { rows } = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'golden_paths'
          AND column_name IN ('base_repo', 'target_environment')`
    );
    const cols = new Map(rows.map((r) => [r.column_name, r]));
    for (const name of ['base_repo', 'target_environment']) {
      expect(cols.get(name)?.data_type).toBe('text');
      // NULL 就是「沿用 GP_HARNESS_* 常量」的载体：给 NOT NULL 或默认值，
      // 存量 GP 的回落分支就再也走不到，参数化变成强制迁移。
      expect(cols.get(name)?.is_nullable).toBe('YES');
      expect(cols.get(name)?.column_default).toBeNull();
    }
  });

  it('target_environment CHECK 收全部合法枚举 + NULL', async () => {
    const { rows } = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'golden_paths_target_environment_check'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toMatch(/IS NULL/);
    for (const env of GP_HARNESS_TARGET_ENVIRONMENTS) {
      expect(rows[0].def).toContain(`'${env}'`);
    }
  });

  /**
   * 跑完即回滚：这几条要真写 golden_paths 才能证明 CHECK 是活的，
   * 但测试库是共享的，留下的行会污染邻居测试的计数断言。
   */
  async function inRolledBackTxn(body) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await body(client);
    } finally {
      try { await client.query('ROLLBACK'); } catch { /* 事务已被 PG 中止 */ }
      client.release();
    }
  }

  async function insertGp(client, targetEnv) {
    return client.query(
      `INSERT INTO golden_paths (title, one_liner, target_environment)
       VALUES ($1, 'migration 393 guard', $2)`,
      [`m393-${process.pid}-${targetEnv ?? 'null'}`, targetEnv]
    );
  }

  it('合法枚举与 NULL 都能写入', async () => {
    await inRolledBackTxn(async (client) => {
      await insertGp(client, null);
      for (const env of GP_HARNESS_TARGET_ENVIRONMENTS) {
        await insertGp(client, env);
      }
    });
  });

  it('非法枚举被 CHECK 拒绝（23514）', async () => {
    await inRolledBackTxn(async (client) => {
      const err = await insertGp(client, 'no_such_env').then(() => null, (e) => e);
      expect(err?.code).toBe('23514');
      expect(err.constraint).toBe('golden_paths_target_environment_check');
    });
  });

  it('down 可逆：两列与 CHECK 一并消失', async () => {
    await inRolledBackTxn(async (client) => {
      await client.query(DOWN_SQL);
      const { rows } = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'golden_paths'
            AND column_name IN ('base_repo', 'target_environment')`
      );
      expect(rows).toHaveLength(0);
      const { rows: cons } = await client.query(
        `SELECT conname FROM pg_constraint WHERE conname = 'golden_paths_target_environment_check'`
      );
      expect(cons).toHaveLength(0);
    });
  });
});
