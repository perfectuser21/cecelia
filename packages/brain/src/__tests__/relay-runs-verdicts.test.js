/**
 * Contract Test: relay-runs 新增五字段（裁决与成本）
 * Sprint: 07041845-relay-runs-verdicts
 * Task ID: 8aadc072-3367-4748-94bd-43578786548a
 *
 * 覆盖：
 * FR-10: 列表响应含 evaluate_verdict（null-able）
 * FR-11: 列表响应含 judge_verdict（null-able）
 * FR-12: 列表响应含 cost_usd（null-able）
 * FR-13: 列表响应含 completed_at（null-able）
 * FR-14: 列表响应含 failure_reason（null-able）
 * FR-15: 详情响应含 cost_usd（null-able）
 *
 * Invariants:
 * INV-1: 字段名 snake_case，与 DB 列名完全一致
 * INV-6: 新字段无值时返回 null，键必须存在（不得 omit）
 * INV-7: pr_url 回退路径（colErr 分支）时，四个新字段仍出现
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

// 含五新字段的列表行样本（有值）
const V2_RUN_WITH_VERDICTS = {
  id: 'aaaabbbb-1111-2222-3333-444455556666',
  initiative_id: 'bbbbcccc-1111-2222-3333-444455556666',
  phase: 'done',
  orchestrator_heartbeat_at: '2026-07-04T13:55:00.000Z',
  orchestrator_host: 'cecelia-dev',
  pr_url: 'https://github.com/org/repo/pull/99',
  started_at: '2026-07-04T10:00:00.000Z',
  deadline_at: '2026-07-04T16:00:00.000Z',
  // 五个新字段
  evaluate_verdict: 'pass',
  judge_verdict: 'approved',
  cost_usd: '1.23',
  completed_at: '2026-07-04T14:00:00.000Z',
  failure_reason: null,
};

// 含五新字段的列表行样本（全 null）
const V2_RUN_NULL_VERDICTS = {
  id: 'ccccdddd-1111-2222-3333-444455556666',
  initiative_id: 'ddddeeee-1111-2222-3333-444455556666',
  phase: 'A_planning',
  orchestrator_heartbeat_at: null,
  orchestrator_host: null,
  pr_url: null,
  started_at: '2026-07-04T10:00:00.000Z',
  deadline_at: '2026-07-04T16:00:00.000Z',
  // 五个新字段，全为 null
  evaluate_verdict: null,
  judge_verdict: null,
  cost_usd: null,
  completed_at: null,
  failure_reason: null,
};

// 含 cost_usd 的详情行样本
const V2_RUN_DETAIL_WITH_COST = {
  id: 'aaaabbbb-1111-2222-3333-444455556666',
  initiative_id: 'bbbbcccc-1111-2222-3333-444455556666',
  phase: 'done',
  started_at: '2026-07-04T10:00:00.000Z',
  deadline_at: '2026-07-04T16:00:00.000Z',
  completed_at: '2026-07-04T14:00:00.000Z',
  failure_reason: null,
  orchestrator_version: 'v2',
  orchestrator_heartbeat_at: null,
  orchestrator_host: 'cecelia-dev',
  orchestrator_pid: 12345,
  pr_url: 'https://github.com/org/repo/pull/42',
  round: 3,
  evaluate_verdict: 'pass',
  judge_verdict: 'approved',
  cost_usd: '2.50',
};

// 含 cost_usd=null 的详情行样本
const V2_RUN_DETAIL_NULL_COST = {
  ...V2_RUN_DETAIL_WITH_COST,
  cost_usd: null,
  evaluate_verdict: null,
  judge_verdict: null,
};

describe('relay-runs 五新字段合同测试（verdicts + cost）', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    app = await buildApp();
  });

  // =========================================================
  // FR-10~14：列表端点新字段存在性
  // =========================================================
  describe('FR-10~14：列表端点含五个新字段（有值）', () => {
    it('响应数组每项含 evaluate_verdict 字段', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_WITH_VERDICTS] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toHaveProperty('evaluate_verdict', 'pass');
    });

    it('响应数组每项含 judge_verdict 字段', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_WITH_VERDICTS] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      expect(res.body[0]).toHaveProperty('judge_verdict', 'approved');
    });

    it('响应数组每项含 cost_usd 字段', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_WITH_VERDICTS] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      expect(res.body[0]).toHaveProperty('cost_usd', '1.23');
    });

    it('响应数组每项含 completed_at 字段', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_WITH_VERDICTS] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      expect(res.body[0]).toHaveProperty('completed_at', '2026-07-04T14:00:00.000Z');
    });

    it('响应数组每项含 failure_reason 字段', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_WITH_VERDICTS] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      expect(res.body[0]).toHaveProperty('failure_reason');
    });

    it('五个新字段同时存在于单个响应项', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_WITH_VERDICTS] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      const item = res.body[0];
      expect(item).toHaveProperty('evaluate_verdict');
      expect(item).toHaveProperty('judge_verdict');
      expect(item).toHaveProperty('cost_usd');
      expect(item).toHaveProperty('completed_at');
      expect(item).toHaveProperty('failure_reason');
    });
  });

  // =========================================================
  // INV-6：null 语义——键存在，值为 null（不得 omit）
  // =========================================================
  describe('INV-6：null 语义——新字段无值时键存在且值为 null', () => {
    it('列表：evaluate_verdict=null → 响应键存在，值为 null', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_NULL_VERDICTS] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      const item = res.body[0];
      // 键必须存在（不得 omit）
      expect(Object.prototype.hasOwnProperty.call(item, 'evaluate_verdict')).toBe(true);
      expect(item.evaluate_verdict).toBeNull();
    });

    it('列表：judge_verdict=null → 响应键存在，值为 null', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_NULL_VERDICTS] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      const item = res.body[0];
      expect(Object.prototype.hasOwnProperty.call(item, 'judge_verdict')).toBe(true);
      expect(item.judge_verdict).toBeNull();
    });

    it('列表：cost_usd=null → 响应键存在，值为 null', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_NULL_VERDICTS] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      const item = res.body[0];
      expect(Object.prototype.hasOwnProperty.call(item, 'cost_usd')).toBe(true);
      expect(item.cost_usd).toBeNull();
    });

    it('列表：completed_at=null → 响应键存在，值为 null', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_NULL_VERDICTS] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      const item = res.body[0];
      expect(Object.prototype.hasOwnProperty.call(item, 'completed_at')).toBe(true);
      expect(item.completed_at).toBeNull();
    });

    it('列表：failure_reason=null → 响应键存在，值为 null', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_NULL_VERDICTS] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      const item = res.body[0];
      expect(Object.prototype.hasOwnProperty.call(item, 'failure_reason')).toBe(true);
      expect(item.failure_reason).toBeNull();
    });

    it('列表：五字段全 null → 全部键存在且值为 null', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_NULL_VERDICTS] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      const item = res.body[0];
      for (const field of ['evaluate_verdict', 'judge_verdict', 'cost_usd', 'completed_at', 'failure_reason']) {
        expect(Object.prototype.hasOwnProperty.call(item, field), `字段 ${field} 缺省`).toBe(true);
        expect(item[field], `字段 ${field} 应为 null`).toBeNull();
      }
    });
  });

  // =========================================================
  // INV-1：字段名 snake_case，不得有 camelCase 变体
  // =========================================================
  describe('INV-1：字段名与 DB 列名一致（snake_case）', () => {
    it('列表响应不含 camelCase 变体（evaluateVerdict 等）', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_WITH_VERDICTS] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      const keys = Object.keys(res.body[0]);
      expect(keys).not.toContain('evaluateVerdict');
      expect(keys).not.toContain('judgeVerdict');
      expect(keys).not.toContain('costUsd');
      expect(keys).not.toContain('completedAt');
      expect(keys).not.toContain('failureReason');
    });
  });

  // =========================================================
  // SQL SELECT 包含新列（断言查询结构）
  // =========================================================
  describe('SQL SELECT 包含新列', () => {
    it('列表端点 SQL 含 evaluate_verdict', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_WITH_VERDICTS] });

      await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toMatch(/evaluate_verdict/i);
    });

    it('列表端点 SQL 含 judge_verdict', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_WITH_VERDICTS] });

      await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toMatch(/judge_verdict/i);
    });

    it('列表端点 SQL 含 cost_usd', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_WITH_VERDICTS] });

      await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toMatch(/cost_usd/i);
    });

    it('列表端点 SQL 含 completed_at', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_WITH_VERDICTS] });

      await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toMatch(/completed_at/i);
    });

    it('列表端点 SQL 含 failure_reason', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_WITH_VERDICTS] });

      await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toMatch(/failure_reason/i);
    });

    it('详情端点 SQL 含 cost_usd', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_DETAIL_WITH_COST] });

      await request(app)
        .get('/api/brain/orchestrator/relay-runs/bbbbcccc-1111-2222-3333-444455556666')
        .expect(200);

      const [sql] = mockPool.query.mock.calls[0];
      expect(sql).toMatch(/cost_usd/i);
    });
  });

  // =========================================================
  // FR-15：详情端点含 cost_usd
  // =========================================================
  describe('FR-15：详情端点含 cost_usd', () => {
    it('详情响应含 cost_usd 字段（有值）', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_DETAIL_WITH_COST] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs/bbbbcccc-1111-2222-3333-444455556666')
        .expect(200);

      expect(res.body).toHaveProperty('cost_usd', '2.50');
    });

    it('详情：cost_usd=null → 键存在，值为 null', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_DETAIL_NULL_COST] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs/bbbbcccc-1111-2222-3333-444455556666')
        .expect(200);

      expect(Object.prototype.hasOwnProperty.call(res.body, 'cost_usd')).toBe(true);
      expect(res.body.cost_usd).toBeNull();
    });

    it('详情响应含全部五新字段', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_DETAIL_WITH_COST] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs/bbbbcccc-1111-2222-3333-444455556666')
        .expect(200);

      expect(res.body).toHaveProperty('evaluate_verdict');
      expect(res.body).toHaveProperty('judge_verdict');
      expect(res.body).toHaveProperty('cost_usd');
      expect(res.body).toHaveProperty('completed_at');
      expect(res.body).toHaveProperty('failure_reason');
    });
  });

  // =========================================================
  // INV-7：pr_url 回退路径（colErr 分支）时新字段仍出现
  // =========================================================
  describe('INV-7：pr_url 回退路径（colErr 分支）时新字段仍出现', () => {
    it('colErr 回退路径：四个新字段仍在响应中', async () => {
      // 第一次 query 抛含 pr_url 的错误（触发 colErr 分支）
      mockPool.query
        .mockRejectedValueOnce(new Error('column pr_url does not exist'))
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'aaaabbbb-1111-2222-3333-444455556666',
              initiative_id: 'bbbbcccc-1111-2222-3333-444455556666',
              phase: 'A_planning',
              orchestrator_heartbeat_at: null,
              orchestrator_host: null,
              // 没有 pr_url（回退路径不含 pr_url）
              started_at: '2026-07-04T10:00:00.000Z',
              deadline_at: '2026-07-04T16:00:00.000Z',
              // 四个新字段（evaluate_verdict/judge_verdict/cost_usd/completed_at/failure_reason）
              evaluate_verdict: null,
              judge_verdict: null,
              cost_usd: null,
              completed_at: null,
              failure_reason: null,
            },
          ],
        });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      expect(res.body).toHaveLength(1);
      const item = res.body[0];

      // 四个新字段必须在回退路径响应中出现
      expect(Object.prototype.hasOwnProperty.call(item, 'evaluate_verdict')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(item, 'judge_verdict')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(item, 'cost_usd')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(item, 'completed_at')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(item, 'failure_reason')).toBe(true);
    });

    it('colErr 回退路径：SQL 不含 pr_url 但含四个新字段', async () => {
      mockPool.query
        .mockRejectedValueOnce(new Error('column pr_url does not exist'))
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      // 第二次调用是回退路径
      expect(mockPool.query).toHaveBeenCalledTimes(2);
      const [fallbackSql] = mockPool.query.mock.calls[1];
      // 回退路径 SQL 不含 pr_url
      expect(fallbackSql).not.toMatch(/\bpr_url\b/i);
      // 但含四个新字段
      expect(fallbackSql).toMatch(/evaluate_verdict/i);
      expect(fallbackSql).toMatch(/judge_verdict/i);
      expect(fallbackSql).toMatch(/cost_usd/i);
      expect(fallbackSql).toMatch(/completed_at/i);
      expect(fallbackSql).toMatch(/failure_reason/i);
    });
  });

  // =========================================================
  // INV-2 回归：既有字段不得移除
  // =========================================================
  describe('INV-2 回归：新字段追加后既有字段仍保留', () => {
    it('列表响应仍含 id / initiative_id / phase / started_at', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_WITH_VERDICTS] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      const item = res.body[0];
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('initiative_id');
      expect(item).toHaveProperty('phase');
      expect(item).toHaveProperty('started_at');
      expect(item).toHaveProperty('deadline_at');
      expect(item).toHaveProperty('orchestrator_heartbeat_at');
      expect(item).toHaveProperty('orchestrator_host');
      expect(item).toHaveProperty('pr_url');
    });
  });
});
