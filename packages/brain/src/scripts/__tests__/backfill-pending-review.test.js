import { describe, it, expect, vi } from 'vitest';
import * as script from '../backfill-pending-review.js';
vi.mock('pg', () => ({ default: { Pool: vi.fn(() => ({ query: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] }), end: vi.fn() })) } }));
function pool() {
  return { query: vi.fn(async sql => /UPDATE/.test(sql) ? { rows: [{ id: 'parked' }] } : { rows: [{ count: '2' }] }), end: vi.fn() };
}
describe('积压修复脚本真实入口', () => {
  it('执行两类真实UPDATE并返回统计，最终关闭连接', async () => {
    expect(script.run).toBeTypeOf('function');
    const db = pool();
    expect(await script.run(db, { dryRun: false })).toEqual({ parked: 2, remaining: 2 });
    const updates = db.query.mock.calls.filter(([sql]) => /UPDATE/.test(sql)).map(([sql]) => sql);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toContain("ai_reason LIKE '[triage:%'");
    expect(updates[1]).toContain("target_type IN ('handoff','learning','issue')");
    expect(updates[1]).toContain('routed_to_table IS NULL OR routed_to_id IS NULL');
    expect(db.end).toHaveBeenCalledOnce();
  });
  it('dry-run只读计数，零UPDATE；错误时finally仍关闭', async () => {
    expect(script.run).toBeTypeOf('function');
    const db = pool();
    await script.run(db, { dryRun: true });
    expect(db.query.mock.calls.some(([sql]) => /UPDATE/.test(sql))).toBe(false);
    expect(db.end).toHaveBeenCalledOnce();
    db.end.mockClear(); db.query.mockRejectedValueOnce(new Error('query failed'));
    await expect(script.run(db, { dryRun: false })).rejects.toThrow('query failed');
    expect(db.end).toHaveBeenCalledOnce();
  });
});
