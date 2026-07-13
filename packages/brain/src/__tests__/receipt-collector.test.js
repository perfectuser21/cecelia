import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock 模块级 pool（record/resolve 用；tick/查询走参数注入的 pool）
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

import pool from '../db.js';
import {
  recordActionReceipt,
  resolveActionReceipt,
  runReceiptCollector,
  getUnconfirmedReceipts,
  __resetReceiptCollectorForTest,
} from '../receipt-collector.js';

function makePool(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) };
}

describe('recordActionReceipt', () => {
  beforeEach(() => vi.clearAllMocks());

  it('INSERT pending 并返回 id', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 'r-1' }] });
    const id = await recordActionReceipt({ kind: 'feishu', target: 'webhook' });
    expect(id).toBe('r-1');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO action_receipts/);
    expect(sql).toMatch(/'pending'/);
    expect(params[1]).toBe('feishu');
    expect(params[2]).toBe('webhook');
  });

  it('kind 缺失 → 返回 null 且不查库', async () => {
    const id = await recordActionReceipt({ target: 'webhook' });
    expect(id).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('DB 错误 fail-open → 返回 null 不抛', async () => {
    pool.query.mockRejectedValue(new Error('db down'));
    await expect(recordActionReceipt({ kind: 'bark' })).resolves.toBeNull();
  });
});

describe('resolveActionReceipt', () => {
  beforeEach(() => vi.clearAllMocks());

  it('UPDATE 到 confirmed（仅 pending 行）', async () => {
    pool.query.mockResolvedValue({ rowCount: 1 });
    const ok = await resolveActionReceipt('r-1', 'confirmed', { http_status: 200 });
    expect(ok).toBe(true);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE action_receipts/);
    expect(sql).toMatch(/receipt_status = 'pending'/);
    expect(params).toEqual(['r-1', 'confirmed', JSON.stringify({ http_status: 200 })]);
  });

  it('id 为 null 或状态非法 → false 且不查库', async () => {
    expect(await resolveActionReceipt(null, 'confirmed')).toBe(false);
    expect(await resolveActionReceipt('r-1', 'timeout')).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('DB 错误 fail-open → false 不抛', async () => {
    pool.query.mockRejectedValue(new Error('db down'));
    await expect(resolveActionReceipt('r-1', 'failed')).resolves.toBe(false);
  });
});

describe('runReceiptCollector（tick 自 gate + 超时核销）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetReceiptCollectorForTest();
  });

  it('超 30min 的 pending 标 timeout', async () => {
    const p = makePool([{ id: 'r-1', kind: 'deploy' }]);
    const result = await runReceiptCollector(p);
    expect(result).toEqual({ timedOut: 1 });
    const [sql, params] = p.query.mock.calls[0];
    expect(sql).toMatch(/SET receipt_status = 'timeout'/);
    expect(sql).toMatch(/receipt_status = 'pending'/);
    expect(params).toEqual([30]);
  });

  it('间隔内第二次调用 → skipped 不查库', async () => {
    const p = makePool([]);
    await runReceiptCollector(p);
    const result = await runReceiptCollector(p);
    expect(result).toEqual({ skipped: true, timedOut: 0 });
    expect(p.query).toHaveBeenCalledTimes(1);
  });
});

describe('getUnconfirmedReceipts', () => {
  it('查 24h 内 pending/timeout/failed，LIMIT 50', async () => {
    const rows = [{ kind: 'feishu', target: 'webhook', receipt_status: 'timeout', sent_at: new Date() }];
    const p = makePool(rows);
    const result = await getUnconfirmedReceipts(p);
    expect(result).toEqual(rows);
    const [sql] = p.query.mock.calls[0];
    expect(sql).toMatch(/IN \('pending', 'timeout', 'failed'\)/);
    expect(sql).toMatch(/24 hours/);
    expect(sql).toMatch(/LIMIT 50/);
  });
});
