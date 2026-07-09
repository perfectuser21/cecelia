import { describe, it, expect, beforeAll, afterAll } from 'vitest';
let pool, claimDedupeKey;

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
  ({ claimDedupeKey } = await import('../../lib/dedupe.js'));
  await pool.query(`DELETE FROM side_effect_dedupe WHERE kind = 'itest'`);
});

afterAll(async () => {
  await pool.query(`DELETE FROM side_effect_dedupe WHERE kind = 'itest'`);
});

describe('dedupe integration（真 DB）', () => {
  it('并发 10 个 claim 同 key，恰好 1 个成功', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => claimDedupeKey('itest', 'race-key', 60))
    );
    const winners = results.filter(r => r.claimed && !r.degraded);
    expect(winners.length).toBe(1);
  });

  it('过期行可被重占', async () => {
    const first = await claimDedupeKey('itest', 'expire-key', -1); // 立即过期
    expect(first.claimed).toBe(true);
    const second = await claimDedupeKey('itest', 'expire-key', 60);
    expect(second.claimed).toBe(true);
  });
});
