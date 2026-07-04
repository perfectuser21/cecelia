/**
 * Contract Test: relay-runs 过滤与详情端点
 * Sprint: 07041800-relay-runs-filter
 *
 * 覆盖：
 * 1. ?phase=A_planning 过滤 → SQL 含 WHERE phase=$N，返回数组每条 phase 匹配
 * 2. ?phase=invalid_phase → 400 + { error, allowed: [...] } 含枚举白名单
 * 3. GET /relay-runs/:initiative_id（存在）→ 200 含 failure_reason/completed_at 全量字段
 * 4. GET /relay-runs/:initiative_id（不存在）→ 404 + { error: "not found" }
 * 5. DB 失败 → 500 + { error }（JSON，不崩进程）
 * 6. 不带 ?phase 时 SQL 不含 phase 过滤条件（向后兼容 INV-5）
 * 7. ALLOWED_PHASES 枚举白名单钉定（铁律1）
 * 8. Content-Type: application/json（所有响应，铁律3）
 * 9. 404 body 不泄露内部信息（铁律4）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---- mock pool（必须在 import 路由前 hoist）----
const { mockPool } = vi.hoisted(() => ({
  mockPool: { query: vi.fn() },
}));

vi.mock('../../../packages/brain/src/db.js', () => ({ default: mockPool }));

let app;

async function buildApp() {
  const { default: router } = await import('../../../packages/brain/src/routes/initiatives.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/orchestrator', router);
  return a;
}

// 测试样本数据
const V2_RUN_PLANNING = {
  id: 'aaaabbbb-1111-2222-3333-444455556666',
  initiative_id: 'bbbbcccc-1111-2222-3333-444455556666',
  phase: 'A_planning',
  orchestrator_heartbeat_at: null,
  orchestrator_host: null,
  pr_url: null,
  started_at: '2026-07-04T10:00:00.000Z',
  deadline_at: '2026-07-04T16:00:00.000Z',
};

const V2_RUN_DONE = {
  id: 'ccccdddd-1111-2222-3333-444455556666',
  initiative_id: 'ddddeeee-1111-2222-3333-444455556666',
  phase: 'done',
  orchestrator_heartbeat_at: null,
  orchestrator_host: null,
  pr_url: 'https://github.com/org/repo/pull/42',
  started_at: '2026-07-03T10:00:00.000Z',
  deadline_at: '2026-07-03T16:00:00.000Z',
};

const V2_RUN_DETAIL = {
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
};

// migration 312 铁律枚举（铁律1 基准值）
const MIGRATION_312_PHASES = [
  'A_planning',
  'A_contract',
  'B_task_loop',
  'C_final_e2e',
  'done',
  'failed',
  'planning',
  'gan',
  'generate',
  'evaluate',
];

describe('relay-runs 过滤与详情 — Contract Tests', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    app = await buildApp();
  });

  // =========================================================
  // 铁律1：ALLOWED_PHASES 枚举钉定
  // =========================================================
  describe('铁律1：ALLOWED_PHASES 枚举与 migration 312 一致', () => {
    it('路由暴露的 ALLOWED_PHASES 长度 == 10', async () => {
      // 通过发送已知枚举值验证路由接受，发送未知值验证被拒绝
      // 此测试通过 400 响应的 allowed 字段来反向验证枚举定义
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs?phase=INVALID_PHASE_XYZ')
        .expect(400);

      expect(res.body).toHaveProperty('allowed');
      expect(Array.isArray(res.body.allowed)).toBe(true);
      expect(res.body.allowed).toHaveLength(10);
    });

    it('allowed 字段包含 migration 312 所有枚举值', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs?phase=INVALID_PHASE_XYZ')
        .expect(400);

      const allowed = res.body.allowed;
      for (const phase of MIGRATION_312_PHASES) {
        expect(allowed).toContain(phase);
      }
    });

    it('allowed 字段不含 migration 312 以外的值', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs?phase=INVALID_PHASE_XYZ')
        .expect(400);

      const allowed = res.body.allowed;
      const unexpected = allowed.filter((v) => !MIGRATION_312_PHASES.includes(v));
      expect(unexpected).toHaveLength(0);
    });
  });

  // =========================================================
  // GP-1：phase 过滤
  // =========================================================
  describe('GP-1：?phase= 过滤列表', () => {
    it('?phase=A_planning → HTTP 200 JSON 数组', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_PLANNING] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs?phase=A_planning')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].phase).toBe('A_planning');
    });

    it('?phase=A_planning → SQL 含 WHERE phase=$N 绑定参数', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_PLANNING] });

      await request(app)
        .get('/api/brain/orchestrator/relay-runs?phase=A_planning')
        .expect(200);

      expect(mockPool.query).toHaveBeenCalledOnce();
      const [sql, params] = mockPool.query.mock.calls[0];
      // SQL 必须含 phase 过滤条件
      expect(sql).toMatch(/phase\s*=\s*\$\d+/i);
      // 参数中含 'A_planning'
      expect(params).toContain('A_planning');
    });

    it('?phase=A_planning → 结果每条记录 phase == "A_planning"', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_PLANNING] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs?phase=A_planning')
        .expect(200);

      for (const run of res.body) {
        expect(run.phase).toBe('A_planning');
      }
    });

    it('?phase=done → HTTP 200，返回 done phase 的记录', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_DONE] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs?phase=done')
        .expect(200);

      expect(res.body[0].phase).toBe('done');
    });

    it('?phase=A_planning&limit=5 → SQL 参数同时含 phase 和 limit=5', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_PLANNING] });

      await request(app)
        .get('/api/brain/orchestrator/relay-runs?phase=A_planning&limit=5')
        .expect(200);

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toMatch(/phase\s*=\s*\$\d+/i);
      expect(params).toContain('A_planning');
      expect(params).toContain(5);
    });

    it('?phase=invalid_phase → HTTP 400 + { error, allowed }', async () => {
      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs?phase=invalid_phase')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(typeof res.body.error).toBe('string');
      expect(res.body).toHaveProperty('allowed');
      expect(Array.isArray(res.body.allowed)).toBe(true);
    });

    it('?phase=invalid_phase → 不执行 DB 查询', async () => {
      await request(app)
        .get('/api/brain/orchestrator/relay-runs?phase=invalid_phase')
        .expect(400);

      // 无效 phase 应在验证层拒绝，不到达 DB
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('?phase=（空字符串）→ HTTP 400 + { error, allowed }', async () => {
      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs?phase=')
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body).toHaveProperty('allowed');
    });
  });

  // =========================================================
  // INV-5：向后兼容（不带 ?phase）
  // =========================================================
  describe('INV-5：不带 ?phase 时行为不变（向后兼容）', () => {
    it('不带 ?phase → HTTP 200 JSON 数组（全部 v2 runs）', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_PLANNING, V2_RUN_DONE] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
    });

    it('不带 ?phase → SQL 不含 phase 过滤条件', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_PLANNING] });

      await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      const [sql, params] = mockPool.query.mock.calls[0];
      // SQL 不应含 phase=$N 绑定
      expect(sql).not.toMatch(/phase\s*=\s*\$\d+/i);
      // 参数中不含任何 phase 枚举值
      const phaseInParams = MIGRATION_312_PHASES.some((p) => (params || []).includes(p));
      expect(phaseInParams).toBe(false);
    });

    it('不带 ?phase，?limit=10 → SQL 参数含 10，不含 phase 条件', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_PLANNING] });

      await request(app)
        .get('/api/brain/orchestrator/relay-runs?limit=10')
        .expect(200);

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(params).toContain(10);
      expect(sql).not.toMatch(/phase\s*=\s*\$\d+/i);
    });

    it('不带任何参数 → 默认 limit=20（SQL 参数含 20）', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      const [, params] = mockPool.query.mock.calls[0];
      expect(params).toContain(20);
    });
  });

  // =========================================================
  // GP-2：:initiative_id 详情（存在）
  // =========================================================
  describe('GP-2：GET /relay-runs/:initiative_id（存在）', () => {
    it('存在的 initiative_id → HTTP 200 JSON 对象', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_DETAIL] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs/bbbbcccc-1111-2222-3333-444455556666')
        .expect(200);

      expect(typeof res.body).toBe('object');
      expect(Array.isArray(res.body)).toBe(false);
    });

    it('详情响应含 failure_reason / completed_at 字段', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_DETAIL] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs/bbbbcccc-1111-2222-3333-444455556666')
        .expect(200);

      expect(res.body).toHaveProperty('failure_reason');
      expect(res.body).toHaveProperty('completed_at');
    });

    it('详情响应含 PRD 全量字段', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_DETAIL] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs/bbbbcccc-1111-2222-3333-444455556666')
        .expect(200);

      const requiredFields = [
        'id',
        'initiative_id',
        'phase',
        'started_at',
        'deadline_at',
        'completed_at',
        'failure_reason',
        'orchestrator_version',
        'orchestrator_heartbeat_at',
        'orchestrator_host',
        'orchestrator_pid',
        'pr_url',
        'round',
        'evaluate_verdict',
        'judge_verdict',
      ];

      for (const field of requiredFields) {
        expect(res.body).toHaveProperty(field);
      }
    });

    it('详情响应字段值正确（initiative_id 匹配）', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_DETAIL] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs/bbbbcccc-1111-2222-3333-444455556666')
        .expect(200);

      expect(res.body.initiative_id).toBe('bbbbcccc-1111-2222-3333-444455556666');
      expect(res.body.orchestrator_version).toBe('v2');
    });
  });

  // =========================================================
  // GP-3：:initiative_id 不存在 → 404
  // =========================================================
  describe('GP-3：GET /relay-runs/:initiative_id（不存在）', () => {
    it('不存在的 id → HTTP 404', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await request(app)
        .get('/api/brain/orchestrator/relay-runs/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });

    it('不存在的 id → body 含 { error: "not found" }', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs/00000000-0000-0000-0000-000000000000')
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toBe('not found');
    });

    it('铁律4：404 body 不泄露 SQL/表名/内部错误', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs/00000000-0000-0000-0000-000000000000')
        .expect(404);

      const bodyStr = JSON.stringify(res.body).toLowerCase();
      // 不含 SQL 错误关键词
      expect(bodyStr).not.toMatch(/\bsql\b/);
      expect(bodyStr).not.toMatch(/\btable\b/);
      expect(bodyStr).not.toMatch(/\bcolumn\b/);
      expect(bodyStr).not.toMatch(/\bsyntax\b/);
      expect(bodyStr).not.toMatch(/\bpg\b/);
      expect(bodyStr).not.toMatch(/\bpostgres\b/);
      // body 只有 error 字段（不额外泄露）
      expect(Object.keys(res.body)).toEqual(['error']);
    });
  });

  // =========================================================
  // 铁律3：Content-Type: application/json（全响应）
  // =========================================================
  describe('铁律3：Content-Type: application/json（所有状态码）', () => {
    it('200 响应含 Content-Type: application/json', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [V2_RUN_PLANNING] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(200);

      expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    it('400 响应（无效 phase）含 Content-Type: application/json', async () => {
      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs?phase=bad_phase')
        .expect(400);

      expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    it('404 响应含 Content-Type: application/json', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs/00000000-0000-0000-0000-000000000000')
        .expect(404);

      expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    it('500 响应（DB 失败）含 Content-Type: application/json', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('connection refused'));

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(500);

      expect(res.headers['content-type']).toMatch(/application\/json/);
    });
  });

  // =========================================================
  // DB 失败 → 500（不崩进程）
  // =========================================================
  describe('DB 失败 → HTTP 500（进程不崩）', () => {
    it('列表端点 DB 失败 → HTTP 500 + { error }', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('connection refused'));

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(500);

      expect(res.body).toHaveProperty('error');
      expect(typeof res.body.error).toBe('string');
    });

    it('列表端点 DB 失败后进程不崩（后续请求仍可响应）', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('connection refused'));

      await request(app).get('/api/brain/orchestrator/relay-runs').expect(500);

      // 后续请求仍可处理
      const res2 = await request(app)
        .get('/api/brain/orchestrator/relay-runs?phase=bad_phase')
        .expect(400);

      expect(res2.body).toHaveProperty('error');
    });

    it('详情端点 DB 失败 → HTTP 500 + { error }', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('connection refused'));

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs/bbbbcccc-1111-2222-3333-444455556666')
        .expect(500);

      expect(res.body).toHaveProperty('error');
      expect(typeof res.body.error).toBe('string');
    });

    it('500 响应 body 不含 stack trace（不泄露内部信息）', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('pg_connection_error_XYZ'));

      const res = await request(app)
        .get('/api/brain/orchestrator/relay-runs')
        .expect(500);

      // 不暴露原始 Error message
      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toContain('pg_connection_error_XYZ');
      expect(bodyStr).not.toMatch(/at Object\./);
      expect(bodyStr).not.toContain('stack');
    });
  });
});
