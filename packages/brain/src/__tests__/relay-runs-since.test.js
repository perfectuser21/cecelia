/**
 * Contract Test: relay-runs since 过滤
 * Sprint: 07042120-relay-runs-since
 * Task ID: 61fd2e5c-4c79-4184-8584-cab426596846
 *
 * 覆盖：
 * FR-19: ?since=<ISO8601> → SQL WHERE 含 started_at >= $N（参数化绑定）
 * FR-20: ?since 缺失 → 不含 since 条件（INV-5 向后兼容）
 * FR-21: ?since + ?phase + ?limit 三参数组合同时生效
 * FR-22: ?since=<非法> → 400 + { error: string }，不执行 DB 查询
 * FR-23: ?since=（空字符串）→ 400 + { error: string }
 * FR-24: colErr 回退路径（pr_url 缺列）中 since 条件同样生效
 *
 * Invariants:
 * INV-2: 既有四份测试文件零改动（本文件只新增，不修改）
 * INV-3: 400 响应 Content-Type: application/json
 * INV-5: 不带 since 时行为与当前完全一致
 * INV-8: since 非法格式 → 400，不到达 DB
 * INV-9: since+phase+limit 三参数 AND 逻辑，单次 DB 查询
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---- mock pool（必须在 import 路由前 hoist）----
const { mockPool } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
}));

vi.mock('../db.js', () => ({ default: mockPool }));

let app;

async function buildApp() {
  const { default: router } = await import('../routes/initiatives.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/orchestrator', router);
  return a;
}

// 测试辅助数据（沿用既有风格）
const V2_RUN = {
  id: 'aaaabbbb-1111-2222-3333-444455556666',
  initiative_id: 'bbbbcccc-1111-2222-3333-444455556666',
  phase: 'A_planning',
  orchestrator_heartbeat_at: null,
  orchestrator_host: null,
  pr_url: null,
  started_at: '2026-07-04T10:00:00.000Z',
  deadline_at: '2026-07-04T16:00:00.000Z',
  evaluate_verdict: null,
  judge_verdict: null,
  cost_usd: null,
  completed_at: null,
  failure_reason: null,
};

const V2_RUN_PLANNING = {
  ...V2_RUN,
  phase: 'A_planning',
};

const SINCE_TS = '2026-07-04T00:00:00Z';

describe('relay-runs since 过滤 — Contract Tests', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    app = await buildApp();
  });

  // =========================================================
  // 描述块 1：FR-19 since 参数生效
  // =========================================================
  describe('FR-19 since 参数生效', () => {
    it('B-01: ?since=2026-07-04T00:00:00Z → HTTP 200，SQL 含 started_at >= $N', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN] });

      const res = await request(app)
        .get(`/api/brain/orchestrator/relay-runs?since=${SINCE_TS}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);

      expect(mockPool.query).toHaveBeenCalledOnce();
      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toMatch(/started_at\s*>=\s*\$\d+/i);
    });

    it('B-02: ?since=2026-07-04T00:00:00Z → SQL 使用参数化绑定（ISO 字符串不出现在 SQL 文本中）', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN] });

      await request(app)
        .get(`/api/brain/orchestrator/relay-runs?since=${SINCE_TS}`)
        .expect(200);

      const [sql, params] = mockPool.query.mock.calls[0];
      // ISO 字符串字面量不应直接出现在 SQL 文本里（参数化绑定）
      expect(sql).not.toContain(SINCE_TS);
      // 参数数组中包含 since 值
      expect(params).toContain(SINCE_TS);
    });

    it('B-03: 返回数组中每项都含 started_at 字段（防字段丢失回归）', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN] });

      const res = await request(app)
        .get(`/api/brain/orchestrator/relay-runs?since=${SINCE_TS}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toHaveProperty('started_at');
    });
  });

  // =========================================================
  // 描述块 2：FR-21 三参数组合同时生效
  // =========================================================
  describe('FR-21 三参数组合同时生效', () => {
    it('B-04: ?since=T&phase=A_planning&limit=5 → SQL 含三条件，params 含三值（INV-9: 单次 DB 查询）', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_PLANNING] });

      const res = await request(app)
        .get(`/api/brain/orchestrator/relay-runs?since=${SINCE_TS}&phase=A_planning&limit=5`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);

      // INV-9: 单次 DB 查询
      expect(mockPool.query).toHaveBeenCalledOnce();
      const [sql, params] = mockPool.query.mock.calls[0];

      // SQL 含 since 条件
      expect(sql).toMatch(/started_at\s*>=\s*\$\d+/i);
      // SQL 含 phase 条件
      expect(sql).toMatch(/phase\s*=\s*\$\d+/i);
      // params 含三个值
      expect(params).toContain(SINCE_TS);
      expect(params).toContain('A_planning');
      expect(params).toContain(5);
    });

    it('B-05: ?since=T&limit=3（无 phase）→ SQL 含 since 条件，不含 phase 条件，params 含 3', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN] });

      await request(app)
        .get(`/api/brain/orchestrator/relay-runs?since=${SINCE_TS}&limit=3`)
        .expect(200);

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toMatch(/started_at\s*>=\s*\$\d+/i);
      expect(sql).not.toMatch(/phase\s*=\s*\$\d+/i);
      expect(params).toContain(3);
    });

    it('B-06: ?since=T&phase=done（无 limit）→ SQL 含 since + phase 条件，默认 limit=20', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get(`/api/brain/orchestrator/relay-runs?since=${SINCE_TS}&phase=done`)
        .expect(200);

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toMatch(/started_at\s*>=\s*\$\d+/i);
      expect(sql).toMatch(/phase\s*=\s*\$\d+/i);
      // 默认 limit=20
      expect(params).toContain(20);
    });
  });

  // =========================================================
  // 描述块 3：FR-22/FR-23 非法 since → 400
  // =========================================================
  describe('FR-22/FR-23 非法 since → 400', () => {
    it('B-07: ?since=not-a-date → HTTP 400 + { error: string }，不执行 DB 查询', async () => {
      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs?since=not-a-date')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(typeof res.body.error).toBe('string');
      // 非法 since 在校验层拦截，不到达 DB
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('B-08: ?since=（空字符串）→ HTTP 400 + { error: string }，不执行 DB 查询', async () => {
      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs?since=')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(typeof res.body.error).toBe('string');
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('B-09: ?since=2026-13-99T00:00:00Z（非法日期）→ HTTP 400 + { error: string }', async () => {
      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs?since=2026-13-99T00:00:00Z')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(typeof res.body.error).toBe('string');
    });

    it('B-10: INV-3: 400 响应 Content-Type: application/json（非法 since）', async () => {
      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs?since=not-a-date')
        .expect(400);

      expect(res.headers['content-type']).toMatch(/application\/json/);
    });
  });

  // =========================================================
  // 描述块 4：INV-5 since 缺失时行为不变（向后兼容）
  // =========================================================
  describe('INV-5 since 缺失时行为不变（向后兼容）', () => {
    it('B-11: 不带 ?since → SQL 不含 started_at >= 条件', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN] });

      await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).not.toMatch(/started_at\s*>=/i);
    });

    it('B-12: 不带 ?since，?limit=10 → SQL 不含 since，params 含 10', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN] });

      await request(app)
        .get('/api/brain/orchestrator/relay-runs?limit=10')
        .expect(200);

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).not.toMatch(/started_at\s*>=/i);
      expect(params).toContain(10);
    });

    it('B-13: 不带任何参数 → 默认 limit=20，无 since/phase 条件（完整 INV-5 回归）', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(params).toContain(20);
      expect(sql).not.toMatch(/started_at\s*>=/i);
      expect(sql).not.toMatch(/phase\s*=\s*\$\d+/i);
    });
  });

  // =========================================================
  // 描述块 5：FR-24 colErr 回退路径中 since 条件生效
  // =========================================================
  describe('FR-24 colErr 回退路径中 since 条件生效', () => {
    it('B-14: ?since=T → 第一次 query 抛 pr_url 错误 → 回退路径 SQL 含 since 条件', async () => {
      // 第一次：抛含 'pr_url' 的错误（触发 colErr 回退）
      mockPool.query.mockRejectedValueOnce(new Error('column "pr_url" does not exist'));
      // 第二次：回退查询成功
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN] });

      const res = await request(app)
        .get(`/api/brain/orchestrator/relay-runs?since=${SINCE_TS}`)
        .expect(200);

      // query 应被调用两次
      expect(mockPool.query).toHaveBeenCalledTimes(2);

      // 第二次调用（回退路径）的 SQL 应含 since 条件
      const [sql2, params2] = mockPool.query.mock.calls[1];
      expect(sql2).toMatch(/started_at\s*>=\s*\$\d+/i);
      // 回退路径参数也应含 since 值
      expect(params2).toContain(SINCE_TS);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
