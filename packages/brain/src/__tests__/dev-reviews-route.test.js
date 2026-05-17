import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

describe('dev-reviews route', () => {
  let router;
  let pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    pool = (await import('../db.js')).default;
    const mod = await import('../routes/dev-reviews.js');
    router = mod.default;
  });

  function findHandler(method, path) {
    const layer = router.stack.find(
      (l) => l.route?.path === path && l.route?.methods?.[method],
    );
    return layer?.route?.stack[0]?.handle;
  }

  function mockRes() {
    const res = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
  }

  it('exports a router with POST /dev-reviews + GET /dev-reviews + GET /dev-reviews/stats', () => {
    expect(findHandler('post', '/dev-reviews')).toBeDefined();
    expect(findHandler('get', '/dev-reviews')).toBeDefined();
    expect(findHandler('get', '/dev-reviews/stats')).toBeDefined();
  });

  it('POST 结构化字段 → 写入成功，返回 id+created_at', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, created_at: '2026-04-20T00:00:00Z' }] });
    const handler = findHandler('post', '/dev-reviews');
    const res = mockRes();
    await handler(
      {
        body: {
          pr_number: 2456,
          branch: 'cp-xxx',
          point_code: 'B-5',
          decision: 'APPROVE',
          confidence: 'HIGH',
          quality_score: 9,
          risks: [{ risk: 'R1', impact: 'minor' }],
        },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 1, created_at: '2026-04-20T00:00:00Z' });
  });

  it('POST 带 raw_markdown → 走 parser 填充字段', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 2, created_at: '2026-04-20T00:00:01Z' }] });
    const handler = findHandler('post', '/dev-reviews');
    const res = mockRes();
    await handler(
      {
        body: {
          raw_markdown: `## Review（autonomous，B-4 design review）
**判断**：APPROVE
**confidence**：HIGH
**质量分**：8/10`,
        },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('POST 非法 point_code → 400', async () => {
    const handler = findHandler('post', '/dev-reviews');
    const res = mockRes();
    await handler(
      {
        body: {
          point_code: 'XXX',
          decision: 'APPROVE',
          confidence: 'HIGH',
          quality_score: 9,
        },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_point_code' }),
    );
  });

  it('POST quality_score 超范围 → 400', async () => {
    const handler = findHandler('post', '/dev-reviews');
    const res = mockRes();
    await handler(
      {
        body: {
          point_code: 'B-5',
          decision: 'APPROVE',
          confidence: 'HIGH',
          quality_score: 15,
        },
      },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_quality_score' }));
  });

  it('GET /dev-reviews 带 pr + point 过滤', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 1, pr_number: 2456, point_code: 'B-5' }],
    });
    const handler = findHandler('get', '/dev-reviews');
    const res = mockRes();
    await handler({ query: { pr: '2456', point: 'B-5', limit: '10' } }, res);
    expect(res.json).toHaveBeenCalledWith({ reviews: expect.any(Array) });
    // params 带上 pr_number + point + limit
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('pr_number = $');
    expect(sql).toContain('point_code = $');
    expect(params).toContain(2456);
    expect(params).toContain('B-5');
    expect(params).toContain(10);
  });

  it('GET /dev-reviews/stats 聚合', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { point_code: 'B-5', avg_quality: 8.5, count: 3, low_confidence_rate: 0.1 },
      ],
    });
    const handler = findHandler('get', '/dev-reviews/stats');
    const res = mockRes();
    await handler({}, res);
    expect(res.json).toHaveBeenCalledWith({
      stats: [{ point_code: 'B-5', avg_quality: 8.5, count: 3, low_confidence_rate: 0.1 }],
    });
  });
});
