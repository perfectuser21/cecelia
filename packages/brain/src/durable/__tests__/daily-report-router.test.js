/**
 * daily-report-router 测试：flag 门控路由（关=原 generateDailyReport，开=durableDailyReport）。
 * 纯路由逻辑，注入两条路径 mock，断言按 flag 选对路径、且只调一条。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { routeDailyReport } from '../daily-report-router.js';

afterEach(() => {
  delete process.env.DBOS_DURABLE_ENABLED;
});

describe('routeDailyReport flag 门控', () => {
  const pool = { fake: 'pool' };

  it('flag 关：走原 generateDailyReport，不走 durable', async () => {
    delete process.env.DBOS_DURABLE_ENABLED;
    const original = vi.fn().mockResolvedValue({ generated: false });
    const durable = vi.fn().mockResolvedValue({ generated: true });
    await routeDailyReport(pool, { original, durable });
    expect(original).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledWith(pool);
    expect(durable).not.toHaveBeenCalled();
  });

  it('flag 开：走 durableDailyReport，不走原路径', async () => {
    process.env.DBOS_DURABLE_ENABLED = 'true';
    const original = vi.fn().mockResolvedValue({ generated: false });
    const durable = vi.fn().mockResolvedValue({ generated: true });
    await routeDailyReport(pool, { original, durable });
    expect(durable).toHaveBeenCalledTimes(1);
    expect(durable).toHaveBeenCalledWith(pool);
    expect(original).not.toHaveBeenCalled();
  });
});
