/**
 * licenses 积分字段 + credit_transactions 记账表单元测试
 * Migration 312: credit_balance / credit_total / credit_transactions
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const { mockPool } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
}));

vi.mock('../db.js', () => ({ default: mockPool }));

// ─── 辅助：从 mock pool 封装的最简积分操作 ─────────────────────────────────

async function getLicenseCredits(pool, licenseId) {
  const { rows } = await pool.query(
    'SELECT credit_balance, credit_total FROM licenses WHERE id = $1',
    [licenseId],
  );
  return rows[0] ?? null;
}

async function recordCreditTransaction(pool, { licenseId, taskId, amount, description }) {
  const { rows } = await pool.query(
    `INSERT INTO credit_transactions (license_id, task_id, amount, description)
     VALUES ($1, $2, $3, $4)
     RETURNING id, license_id, task_id, amount, description, created_at`,
    [licenseId, taskId ?? null, amount, description ?? null],
  );
  return rows[0];
}

async function deductCredit(pool, licenseId, amount, taskId) {
  await pool.query('BEGIN');
  const { rows } = await pool.query(
    `UPDATE licenses
        SET credit_balance = credit_balance - $2
      WHERE id = $1 AND credit_balance >= $2
      RETURNING credit_balance`,
    [licenseId, amount],
  );
  if (!rows.length) {
    await pool.query('ROLLBACK');
    return { success: false, reason: 'insufficient_balance' };
  }
  const tx = await recordCreditTransaction(pool, { licenseId, taskId, amount: -amount });
  await pool.query('COMMIT');
  return { success: true, remaining: rows[0].credit_balance, transactionId: tx.id };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Migration 312 — migration SQL 文件', () => {
  it('312 迁移文件存在且包含关键 DDL', () => {
    const sql = readFileSync(
      join(process.cwd(), 'migrations/312_licenses_credit_fields.sql'),
      'utf8',
    );
    expect(sql).toContain('credit_balance');
    expect(sql).toContain('credit_total');
    expect(sql).toContain('credit_transactions');
    expect(sql).toContain('license_id');
    expect(sql).toContain('task_id');
    expect(sql).toContain('amount');
    expect(sql).toContain('created_at');
  });

  it('credit_balance / credit_total 均有 DEFAULT 0 和 CHECK >= 0', () => {
    const sql = readFileSync(
      join(process.cwd(), 'migrations/312_licenses_credit_fields.sql'),
      'utf8',
    );
    expect(sql).toMatch(/credit_balance\s+NUMERIC\s+NOT NULL\s+DEFAULT\s+0/);
    expect(sql).toMatch(/credit_total\s+NUMERIC\s+NOT NULL\s+DEFAULT\s+0/);
    expect(sql).toMatch(/CHECK\s*\(\s*credit_balance\s*>=\s*0\s*\)/);
    expect(sql).toMatch(/CHECK\s*\(\s*credit_total\s*>=\s*0\s*\)/);
  });

  it('credit_transactions 有 FK → licenses(id)', () => {
    const sql = readFileSync(
      join(process.cwd(), 'migrations/312_licenses_credit_fields.sql'),
      'utf8',
    );
    expect(sql).toContain('REFERENCES licenses(id)');
  });
});

describe('getLicenseCredits', () => {
  beforeEach(() => vi.clearAllMocks());

  it('存在的 license 返回 credit_balance 和 credit_total', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ credit_balance: '500.00', credit_total: '1000.00' }],
    });

    const result = await getLicenseCredits(mockPool, 'license-uuid-1');
    expect(result.credit_balance).toBe('500.00');
    expect(result.credit_total).toBe('1000.00');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('credit_balance'),
      ['license-uuid-1'],
    );
  });

  it('不存在的 license 返回 null', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const result = await getLicenseCredits(mockPool, 'nonexistent');
    expect(result).toBeNull();
  });
});

describe('recordCreditTransaction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('插入记录并返回带 id 的行', async () => {
    const txRow = {
      id: 'tx-uuid-1',
      license_id: 'lic-1',
      task_id: 'task-abc',
      amount: '-100',
      description: '任务消耗',
      created_at: new Date().toISOString(),
    };
    mockPool.query.mockResolvedValueOnce({ rows: [txRow] });

    const result = await recordCreditTransaction(mockPool, {
      licenseId: 'lic-1',
      taskId: 'task-abc',
      amount: -100,
      description: '任务消耗',
    });

    expect(result.id).toBe('tx-uuid-1');
    expect(result.amount).toBe('-100');
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO credit_transactions');
    expect(params).toEqual(['lic-1', 'task-abc', -100, '任务消耗']);
  });

  it('task_id 可为 null（无关联任务的充值记录）', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'tx-2', license_id: 'lic-1', task_id: null, amount: '1000', created_at: new Date().toISOString() }],
    });

    const result = await recordCreditTransaction(mockPool, {
      licenseId: 'lic-1',
      taskId: undefined,
      amount: 1000,
    });

    expect(result.task_id).toBeNull();
    const params = mockPool.query.mock.calls[0][1];
    expect(params[1]).toBeNull();
  });
});

describe('deductCredit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('余额充足时扣减成功，写入负数交易记录', async () => {
    mockPool.query
      .mockResolvedValueOnce(undefined)                                    // BEGIN
      .mockResolvedValueOnce({ rows: [{ credit_balance: '400' }] })       // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'tx-3', license_id: 'lic-1', task_id: 't-1', amount: '-100', created_at: '' }] }) // INSERT tx
      .mockResolvedValueOnce(undefined);                                   // COMMIT

    const result = await deductCredit(mockPool, 'lic-1', 100, 't-1');
    expect(result.success).toBe(true);
    expect(result.remaining).toBe('400');
    expect(result.transactionId).toBe('tx-3');
  });

  it('余额不足时回滚并返回 insufficient_balance', async () => {
    mockPool.query
      .mockResolvedValueOnce(undefined)        // BEGIN
      .mockResolvedValueOnce({ rows: [] })     // UPDATE 返回空（余额不够）
      .mockResolvedValueOnce(undefined);       // ROLLBACK

    const result = await deductCredit(mockPool, 'lic-1', 9999, 't-2');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('insufficient_balance');

    const calls = mockPool.query.mock.calls.map(c => c[0]);
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
  });
});
