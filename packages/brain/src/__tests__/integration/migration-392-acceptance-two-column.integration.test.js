import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, afterAll } from 'vitest';
import pool from '../../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOWN_SQL = fs.readFileSync(
  path.join(__dirname, '../../../migrations/rollback/392_acceptance_two_column.down.sql'),
  'utf-8'
);

async function columnsOf(table) {
  const { rows } = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1`,
    [table]
  );
  return new Map(rows.map((r) => [r.column_name, r.data_type]));
}

describe('migration 392 结构断言', () => {
  afterAll(async () => { await pool.end(); });

  it('acceptance_checks 有 AI 四列且全部 nullable', async () => {
    const cols = await columnsOf('acceptance_checks');
    expect(cols.get('ai_verdict')).toBe('text');
    expect(cols.get('ai_evidence')).toBe('jsonb');
    expect(cols.get('ai_run_at')).toBe('timestamp with time zone');
    expect(cols.get('adjudication')).toBe('jsonb');

    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='acceptance_checks'
         AND column_name IN ('ai_verdict','ai_evidence','ai_run_at','adjudication')
         AND is_nullable='NO'`
    );
    expect(rows).toHaveLength(0); // ai_verdict IS NULL 是 Q0′ 的机械载体，不能有 NOT NULL/默认值
  });

  it('acceptance_runs 有 detail jsonb 列（补 v7-final 断言 A9/A10/A12/A15/A16 的读取路径）', async () => {
    const cols = await columnsOf('acceptance_runs');
    expect(cols.get('detail')).toBe('jsonb');
  });

  it('A10① status CHECK 含全部 7 值 + 2 个历史兼容值', async () => {
    const { rows } = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'acceptance_runs_status_check'`
    );
    expect(rows).toHaveLength(1);
    const def = rows[0].def;
    for (const v of ['pending','in_review','human_complete','adjudicated','stale','expired','abandoned','passed','failed']) {
      expect(def).toContain(`'${v}'`);
    }
  });

  it('ai_verdict CHECK 是中文三值枚举', async () => {
    const { rows } = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'acceptance_checks_ai_verdict_check'`
    );
    expect(rows).toHaveLength(1);
    for (const v of ['通过', '不通过', '无法验证']) expect(rows[0].def).toContain(v);
  });

  it('J5-A UNIQUE 从全局 check_key 换绑到 (run_id, check_key)', async () => {
    const { rows } = await pool.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'acceptance_checks'::regclass AND contype = 'u'`
    );
    const names = rows.map((r) => r.conname);
    expect(names).toContain('uq_acceptance_checks_run_key');
    expect(names).not.toContain('acceptance_checks_check_key_key');
    const def = rows.find((r) => r.conname === 'uq_acceptance_checks_run_key').def;
    expect(def).toMatch(/UNIQUE \(run_id, check_key\)/);
  });

  it('down 在无跨 run 重复格号时完全可逆（事务内跑完即回滚，不动测试库）', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM acceptance_checks WHERE check_key IN (
        SELECT check_key FROM acceptance_checks GROUP BY check_key HAVING count(*) > 1)`);
      await client.query(DOWN_SQL);
      const { rows } = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name='acceptance_checks' AND column_name='ai_verdict'`
      );
      expect(rows).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('down 在已有新格号跨 run 重复时 fail-fast 报错，不静默丢数据', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const mk = async (key) => {
        const { rows } = await client.query(
          `INSERT INTO acceptance_runs (run_key, title) VALUES ($1, 'down-guard') RETURNING id`, [key]
        );
        await client.query(
          `INSERT INTO acceptance_checks (run_id, check_key, kind, name) VALUES ($1, 'S3-c1', 'FR', 'x')`,
          [rows[0].id]
        );
      };
      await mk(`down-guard-a-${process.pid}`);
      await mk(`down-guard-b-${process.pid}`);
      await expect(client.query(DOWN_SQL)).rejects.toThrow(/不可回滚/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
