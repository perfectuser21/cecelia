/**
 * decision-log.test.js —— mock pool（vi.fn 断言 SQL 形状 + 参数顺序），不跑真 pg。
 * append-only 行为已由 migration 312 的真库 trigger 覆盖（spec §测试策略）。
 * heartbeat 测试在 heartbeat.test.js（lint-test-pairing 配对要求）。
 */
import { describe, it, expect, vi } from 'vitest';
import { appendHop, nextHop, SingletonConflictError } from '../decision-log.js';

const RUN_ID = '11111111-2222-3333-4444-555555555555';

function mockPool(result = { rows: [] }) {
  return { query: vi.fn().mockResolvedValue(result) };
}

describe('appendHop', () => {
  const entry = {
    runId: RUN_ID,
    hop: 3,
    observed: { pr: null, prdExists: true },
    derivedPhase: 'gan',
    gateVerdict: null,
    action: 'spawn:proposer',
    detail: { reason: 'no_contract_yet' },
  };

  it('正常插入：SQL 打到 orchestrator_decision_log，列名齐全，参数顺序正确', async () => {
    const pool = mockPool();
    await appendHop(pool, entry);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO orchestrator_decision_log');
    expect(sql).not.toMatch(/INSERT INTO harness_run_events/i);
    for (const col of ['run_id', 'hop', 'observed', 'derived_phase', 'gate_verdict', 'action', 'detail']) {
      expect(sql).toContain(col);
    }
    expect(params).toEqual([
      RUN_ID,
      3,
      JSON.stringify({ pr: null, prdExists: true }),
      'gan',
      null,
      'spawn:proposer',
      JSON.stringify({ reason: 'no_contract_yet' }),
    ]);
  });

  it('detail 缺省 → 传 null', async () => {
    const pool = mockPool();
    await appendHop(pool, { ...entry, detail: undefined });
    const [, params] = pool.query.mock.calls[0];
    expect(params[6]).toBeNull();
  });

  it('UNIQUE(run_id,hop) 冲突（pg 23505）→ throw SingletonConflictError', async () => {
    const err = new Error('duplicate key value violates unique constraint');
    err.code = '23505';
    const pool = { query: vi.fn().mockRejectedValue(err) };

    await expect(appendHop(pool, entry)).rejects.toBeInstanceOf(SingletonConflictError);
  });

  it('SingletonConflictError 带 runId/hop 上下文（watchdog 排障用）', async () => {
    const err = new Error('dup');
    err.code = '23505';
    const pool = { query: vi.fn().mockRejectedValue(err) };

    await expect(appendHop(pool, entry)).rejects.toThrow(new RegExp(`${RUN_ID}.*hop.*3|hop.*3.*${RUN_ID}`));
  });

  it('observed 为 null → fail-fast throw，不发 SQL（空快照=静默丢观测）', async () => {
    const pool = mockPool();
    await expect(appendHop(pool, { ...entry, observed: null })).rejects.toThrow(/observed/);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('observed 为 undefined → fail-fast throw', async () => {
    const pool = mockPool();
    await expect(appendHop(pool, { ...entry, observed: undefined })).rejects.toThrow(/observed/);
  });

  it('非 23505 错误原样抛出，不吞不包装', async () => {
    const err = new Error('connection refused');
    err.code = 'ECONNREFUSED';
    const pool = { query: vi.fn().mockRejectedValue(err) };

    await expect(appendHop(pool, entry)).rejects.toBe(err);
  });
});

describe('nextHop', () => {
  it('空表 → 1（COALESCE(MAX(hop),0)+1）', async () => {
    const pool = mockPool({ rows: [{ next_hop: 1 }] });
    await expect(nextHop(pool, RUN_ID)).resolves.toBe(1);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/COALESCE\(MAX\(hop\),\s*0\)\s*\+\s*1/);
    expect(sql).toContain('orchestrator_decision_log');
    expect(sql).toContain('run_id');
    expect(params).toEqual([RUN_ID]);
  });

  it('已有 hop=7 → 8', async () => {
    const pool = mockPool({ rows: [{ next_hop: 8 }] });
    await expect(nextHop(pool, RUN_ID)).resolves.toBe(8);
  });
});
