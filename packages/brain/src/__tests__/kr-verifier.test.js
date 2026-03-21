import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

describe('kr-verifier', () => {
  let pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    pool = (await import('../db.js')).default;
  });

  it('should return empty results when no verifiers exist', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const { runAllVerifiers } = await import('../kr-verifier.js');
    const result = await runAllVerifiers();
    expect(result.checked).toBe(0);
    expect(result.updated).toBe(0);
  });

  it('should calculate progress as (current_value / threshold) * 100', async () => {
    // Mock: 1 verifier with SQL result = 50, threshold = 500
    pool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'v1', kr_id: 'kr1', kr_title: 'Test KR',
          verifier_type: 'sql', query: 'SELECT 50 as count',
          metric_field: 'count', threshold: 500, operator: '>=',
          current_value: 0, check_interval_minutes: 60,
          metric_from: '0', metric_to: '500',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ count: 50 }] })  // SQL query result
      .mockResolvedValueOnce({ rows: [] })  // update verifier
      .mockResolvedValueOnce({ rows: [] }); // update goals

    const { runAllVerifiers } = await import('../kr-verifier.js');
    const result = await runAllVerifiers();

    expect(result.checked).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.results[0].current_value).toBe(50);
    expect(result.results[0].progress).toBe(10); // 50/500 * 100 = 10%
  });

  it('should cap progress at 100', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'v2', kr_id: 'kr2', kr_title: 'Over KR',
          verifier_type: 'sql', query: 'SELECT 600 as count',
          metric_field: 'count', threshold: 500, operator: '>=',
          current_value: 0, check_interval_minutes: 60,
          metric_from: '0', metric_to: '500',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ count: 600 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { runAllVerifiers } = await import('../kr-verifier.js');
    const result = await runAllVerifiers();

    expect(result.results[0].progress).toBe(100); // capped
  });
});
