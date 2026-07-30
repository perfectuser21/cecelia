import { describe, expect, it, vi } from 'vitest';
import { checkGpLedgerReadiness } from '../gp-ledger-readiness.js';

function makePool(counts) {
  const query = vi.fn();
  for (const count of counts) {
    query.mockResolvedValueOnce({ rows: [{ count }] });
  }
  return { query };
}

describe('checkGpLedgerReadiness', () => {
  it('returns ready only when all §③ invariants are clean', async () => {
    const pool = makePool([0, 0, 0, 0]);
    await expect(checkGpLedgerReadiness(pool)).resolves.toEqual({
      ready: true,
      positive_missing: 0,
      orphan_nfr: 0,
      invalid_base_ref: 0,
      unknown_assertion: 0,
    });
    expect(pool.query).toHaveBeenCalledTimes(4);
  });

  it.each([
    [[1, 0, 0, 0], 'positive_missing'],
    [[0, 1, 0, 0], 'orphan_nfr'],
    [[0, 0, 1, 0], 'invalid_base_ref'],
    [[0, 0, 0, 1], 'unknown_assertion'],
  ])('fails closed when %s is non-zero', async (counts, key) => {
    const result = await checkGpLedgerReadiness(makePool(counts));
    expect(result.ready).toBe(false);
    expect(result[key]).toBe(1);
  });

  it('propagates database errors instead of reporting a false green', async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error('database unavailable')),
    };
    await expect(checkGpLedgerReadiness(pool)).rejects.toThrow('database unavailable');
  });
});
