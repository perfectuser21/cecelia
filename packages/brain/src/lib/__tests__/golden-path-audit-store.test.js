import { describe, expect, it, vi } from 'vitest';
import { createGoldenPathAuditStore } from '../golden-path-audit-store.js';

describe('golden-path-audit-store永久边界', () => {
  it('专属store取得连接超时后有界，迟到连接释放且不BEGIN', async () => {
    let resolve;
    const client = { query: vi.fn(), release: vi.fn() };
    const store = createGoldenPathAuditStore({ connect: () => new Promise(r => { resolve = r; }) }, { timeoutMs: 5 });
    await expect(Promise.race([store.persist('health', { audit_id: 'id' }),
      new Promise(r => setTimeout(() => r('unbounded'), 20))])).rejects.toThrow('gp_audit_deadline');
    resolve(client); await new Promise(r => setTimeout(r, 0));
    expect(client.query).not.toHaveBeenCalled(); expect(client.release).toHaveBeenCalled();
  });
  it('COMMIT未知必须销毁连接，不把可仍执行的连接正常放回池', async () => {
    const release = vi.fn();
    const query = async input => {
      if (input.text === 'COMMIT') throw new Error('unknown commit');
      if (input.text.includes('INSERT INTO')) return { rows: [{ id: 123, created_at: new Date(), gp_db_created_at: new Date().toISOString(), db_time: new Date() }] };
      return { rows: [] };
    };
    const store = createGoldenPathAuditStore({ connect: async () => ({ query, release }) });
    await expect(store.persist('health', { audit_id: 'id' })).rejects.toThrow();
    expect(release).toHaveBeenCalledWith(true);
  });
  it('事务advisory锁核已有audit_id，不在commit与ACK间故障后重复插入', async () => {
    const payload = { audit_id: 'bound-audit-id' };
    const row = { id: 91, event_type: 'golden_path_legacy_access', payload, created_at: '2026-10-02T00:00:00Z', gp_db_created_at: '2026-10-02T00:00:00Z' };
    const calls = [];
    const query = async input => {
      const sql = input.text, params = input.values;
      calls.push({ sql, params });
      if (/SELECT id/.test(sql)) return { rows: [row] };
      return { rows: [] };
    };
    const store = createGoldenPathAuditStore({ connect: async () => ({ query, release() {} }) });
    expect((await store.persist(row.event_type, payload)).id).toBe(91);
    expect(calls.some(c => /pg_advisory_xact_lock/.test(c.sql))).toBe(true);
    expect(calls.some(c => /INSERT/.test(c.sql))).toBe(false);
    expect(calls.at(-1).sql).toBe('COMMIT');
  });
});
