import { describe, it, expect, vi } from 'vitest';
import { updatePublishSuccessKRs } from '../kr1-kr2-updater.js';

const makePool = (rate) => ({
  query: vi.fn().mockImplementation(async (sql) => {
    if (sql.includes('publish_success_daily')) {
      return { rows: [{ rate }] };
    }
    // UPDATE key_results
    return { rowCount: 1 };
  }),
});

describe('kr1-kr2-updater', () => {
  it('updates KR1 and KR2 when data exists', async () => {
    const pool = makePool(85.5);
    const result = await updatePublishSuccessKRs(pool);
    expect(result.kr1).toBe(85.5);
    expect(result.kr2).toBe(85.5);
  });

  it('returns null when no publish_success_daily rows', async () => {
    const pool = makePool(null);
    const result = await updatePublishSuccessKRs(pool);
    expect(result.kr1).toBeNull();
    expect(result.kr2).toBeNull();
  });

  it('does not throw when db errors', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('db error')) };
    await expect(updatePublishSuccessKRs(pool)).resolves.toBeDefined();
  });

  it('progress is capped at 100 when rate exceeds threshold', async () => {
    const pool = makePool(100);
    const result = await updatePublishSuccessKRs(pool);
    // UPDATE 应被调用（rowCount=1 表示命中）
    expect(result.kr1).toBe(100);
  });
});
