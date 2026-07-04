/**
 * Migration 312 — licenses 积分额度字段 + credit_transactions 记账表
 *
 * 验证：
 * 1. licenses 表有 credit_balance 列（numeric，NOT NULL，默认 0）
 * 2. licenses 表有 credit_total 列（numeric，NOT NULL，默认 0）
 * 3. credit_transactions 表存在，含 license_id / task_id / amount / created_at
 * 4. credit_balance / credit_total CHECK 约束拒绝负值
 * 5. EXPECTED_SCHEMA_VERSION 已更新到 312
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../db-config.js';

const { Pool } = pg;
let pool;

beforeAll(async () => {
  pool = new Pool(DB_DEFAULTS);
});

afterAll(async () => {
  await pool.end();
});

describe('Migration 312 - licenses credit_balance/credit_total + credit_transactions', () => {
  it('licenses 表应有 credit_balance 列（numeric，NOT NULL）', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'licenses'
        AND column_name = 'credit_balance'
    `);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe('numeric');
    expect(result.rows[0].is_nullable).toBe('NO');
  });

  it('licenses 表应有 credit_total 列（numeric，NOT NULL）', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'licenses'
        AND column_name = 'credit_total'
    `);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].data_type).toBe('numeric');
    expect(result.rows[0].is_nullable).toBe('NO');
  });

  it('credit_transactions 表应存在，含必要列', async () => {
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'credit_transactions'
      ORDER BY ordinal_position
    `);
    const cols = result.rows.map(r => r.column_name);
    expect(cols).toContain('id');
    expect(cols).toContain('license_id');
    expect(cols).toContain('task_id');
    expect(cols).toContain('amount');
    expect(cols).toContain('created_at');
  });

  it('credit_transactions.license_id 有 FK 约束引用 licenses.id', async () => {
    const result = await pool.query(`
      SELECT tc.constraint_type, kcu.column_name, ccu.table_name AS foreign_table_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'credit_transactions'
        AND kcu.column_name = 'license_id'
    `);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0].foreign_table_name).toBe('licenses');
  });

  it('credit_balance 的 CHECK 约束拒绝负值', async () => {
    const testKey = `test-check-${Date.now()}`;
    await pool.query(`
      INSERT INTO licenses (license_key, tier, max_machines, expires_at)
      VALUES ($1, 'basic', 1, NOW() + interval '1 year')
    `, [testKey]);

    await expect(
      pool.query(`UPDATE licenses SET credit_balance = -1 WHERE license_key = $1`, [testKey])
    ).rejects.toThrow();

    await pool.query(`DELETE FROM licenses WHERE license_key = $1`, [testKey]);
  });

  it('credit_total 的 CHECK 约束拒绝负值', async () => {
    const testKey = `test-check-total-${Date.now()}`;
    await pool.query(`
      INSERT INTO licenses (license_key, tier, max_machines, expires_at)
      VALUES ($1, 'basic', 1, NOW() + interval '1 year')
    `, [testKey]);

    await expect(
      pool.query(`UPDATE licenses SET credit_total = -0.5 WHERE license_key = $1`, [testKey])
    ).rejects.toThrow();

    await pool.query(`DELETE FROM licenses WHERE license_key = $1`, [testKey]);
  });

  it('EXPECTED_SCHEMA_VERSION 应为 312', async () => {
    const { EXPECTED_SCHEMA_VERSION } = await import('../selfcheck.js');
    expect(EXPECTED_SCHEMA_VERSION).toBe('312');
  });
});
