import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runGpShelfLife, __resetGpShelfLifeForTest } from '../gp-shelf-life.js';

function makePool(rowsList) {
  const query = vi.fn();
  for (const rows of rowsList) query.mockResolvedValueOnce({ rows });
  return { query };
}

describe('gp-shelf-life（保质期 delta + 报备否决窗自动生效）', () => {
  beforeEach(() => __resetGpShelfLifeForTest());

  it('10min 自 gate：间隔内第二次调用 skip', async () => {
    const pool = makePool([[], []]);
    await runGpShelfLife(pool);
    const second = await runGpShelfLife(pool);
    expect(second.skipped).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('规则1：approved 超 review_after → expired + status_reason（DoD F7）', async () => {
    const pool = makePool([[{ id: 'gp-1', title: 't' }], []]);
    const result = await runGpShelfLife(pool);
    expect(result.expired).toBe(1);
    const sql1 = pool.query.mock.calls[0][0];
    expect(sql1).toMatch(/SET status = 'expired'/);
    expect(sql1).toMatch(/status_reason/);
    expect(sql1).toMatch(/WHERE status = 'approved' AND review_after IS NOT NULL AND review_after < now\(\)/);
  });

  it('规则2：converged+auto_release 过 veto_deadline → 自动生效 approved 留痕（DoD F6, b416bfb3）', async () => {
    const pool = makePool([[], [{ id: 'gp-2', title: 't2' }]]);
    const result = await runGpShelfLife(pool);
    expect(result.autoReleased).toBe(1);
    const sql2 = pool.query.mock.calls[1][0];
    expect(sql2).toMatch(/SET status = 'approved', approved_at = now\(\), review_after = now\(\) \+ interval '14 days'/);
    expect(sql2).toMatch(/b416bfb3/);
    expect(sql2).toMatch(/WHERE status = 'converged' AND auto_release = true/);
    expect(sql2).toMatch(/veto_deadline IS NOT NULL AND veto_deadline < now\(\)/);
  });

  it('DB 错误 fail-open 不抛', async () => {
    const query = vi.fn().mockRejectedValue(new Error('db down'));
    const result = await runGpShelfLife({ query });
    expect(result.expired).toBe(0);
    expect(result.autoReleased).toBe(0);
  });
});
