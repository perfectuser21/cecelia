/**
 * circuit-breaker.js 持久化测试（migration 261）
 *
 * 测试场景：
 *   - loadFromDB: 从 DB 恢复非默认态熔断器到内存 Map
 *   - recordFailure: 失败时 upsert 到 circuit_breaker_states
 *   - recordSuccess: 成功时 DELETE FROM circuit_breaker_states
 *   - DB 写失败只 warn，不影响内存状态变更
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn(async () => {}) }));
vi.mock('../alerting.js', () => ({ raise: vi.fn(async () => {}) }));

describe('circuit-breaker 持久化 (migration 261)', () => {
  beforeEach(async () => {
    mockQuery.mockReset();
    vi.resetModules();
  });

  it('loadFromDB: 从 DB 恢复 OPEN 状态到内存 Map', async () => {
    const openedAt = new Date(Date.now() - 1000);
    const lastFailureAt = new Date(Date.now() - 500);
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          key: 'cecelia-run',
          state: 'OPEN',
          failures: 22,
          last_failure_at: lastFailureAt.toISOString(),
          opened_at: openedAt.toISOString(),
        },
      ],
    });

    const { loadFromDB, getState } = await import('../circuit-breaker.js');
    await loadFromDB();

    const s = getState('cecelia-run');
    expect(s.state).toBe('OPEN');
    expect(s.failures).toBe(22);
    expect(s.openedAt).toBe(openedAt.getTime());
    expect(s.lastFailureAt).toBe(lastFailureAt.getTime());
  });

  it('loadFromDB: 无非默认态时不污染内存', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { loadFromDB, getAllStates } = await import('../circuit-breaker.js');
    await loadFromDB();
    expect(Object.keys(getAllStates())).toHaveLength(0);
  });

  it('loadFromDB: DB 错误时不抛出（fail-degraded）', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const { loadFromDB } = await import('../circuit-breaker.js');
    await expect(loadFromDB()).resolves.toBeUndefined();
  });

  it('recordFailure: 累积失败异步 upsert circuit_breaker_states', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { recordFailure } = await import('../circuit-breaker.js');
    await recordFailure('worker-x');

    const upsertCall = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('circuit_breaker_states') && c[0].includes('INSERT')
    );
    expect(upsertCall).toBeTruthy();
    expect(upsertCall[1][0]).toBe('worker-x');
  });

  it('recordSuccess: 重置时 DELETE 行 (成功即清零)', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { recordSuccess } = await import('../circuit-breaker.js');
    await recordSuccess('worker-y');

    const deleteCall = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('DELETE FROM circuit_breaker_states')
    );
    expect(deleteCall).toBeTruthy();
    expect(deleteCall[1][0]).toBe('worker-y');
  });

  it('persist 失败只 warn，不影响内存状态', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    const { recordFailure, getState } = await import('../circuit-breaker.js');
    await expect(recordFailure('worker-z')).resolves.toBeUndefined();
    expect(getState('worker-z').failures).toBe(1);
  });

  it('resetBreaker: 内存置 CLOSED + DB UPSERT 到 CLOSED（W7.2 Bug #D）', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const { recordFailure, resetBreaker, getState } = await import('../circuit-breaker.js');
    await recordFailure('worker-r');
    await recordFailure('worker-r');
    expect(getState('worker-r').failures).toBe(2);

    const ret = await resetBreaker('worker-r');

    expect(getState('worker-r').state).toBe('CLOSED');
    expect(getState('worker-r').failures).toBe(0);
    expect(getState('worker-r').lastFailureAt).toBeNull();
    expect(getState('worker-r').openedAt).toBeNull();
    expect(ret.state).toBe('CLOSED');

    // 关键差异：resetBreaker 走 INSERT...ON CONFLICT UPDATE 而非 DELETE
    const upsertCall = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string'
        && c[0].includes('circuit_breaker_states')
        && c[0].includes('INSERT')
        && c[0].includes("'CLOSED'")
    );
    expect(upsertCall).toBeTruthy();
    expect(upsertCall[1][0]).toBe('worker-r');
  });

  it('resetBreaker: DB 失败只 warn，不影响内存状态（fail-degraded）', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    const { resetBreaker, getState } = await import('../circuit-breaker.js');
    await expect(resetBreaker('worker-rd')).resolves.toMatchObject({ state: 'CLOSED', failures: 0 });
    expect(getState('worker-rd').state).toBe('CLOSED');
  });
});
