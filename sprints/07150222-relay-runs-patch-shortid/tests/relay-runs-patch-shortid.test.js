/**
 * PATCH /api/brain/orchestrator/relay-runs/:initiative_id 短号解析合同测试
 *
 * Sprint: 07150222-relay-runs-patch-shortid
 * TASK_ID: 8e07a118-9b9f-45b3-9d8c-f37d581339e1
 *
 * TDD Red 阶段：实现前全部 FAIL，实现后全部 PASS。
 *
 * 覆盖（对应 contract-dod.md）：
 *   [BEHAVIOR-1] 短号命中唯一活跃 v2 run → 200 + phase 更新落库
 *   [BEHAVIOR-2] 短号命中多条非终态 run → 取 started_at 最新的一条
 *   [BEHAVIOR-3] 短号命中 0 条 → 404 且 error 含短号原值
 *   [BEHAVIOR-4] 格式非法（非 UUID / 非 8 位十六进制）→ 400
 *   [BEHAVIOR-5] 完整 UUID 参数走既有逻辑，不回退
 *   [BEHAVIOR-6] DB 查询抛异常 → 500 + console.warn 含短号上下文
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── mock pool（必须在 import 路由前 hoist）────────────────────────────
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

// ── 测试数据 ──────────────────────────────────────────────────────────
const FULL_UUID = 'dd34e184-0000-0000-0000-000000000001';
const SHORT_ID = 'dd34e184';

const SINGLE_RUN = {
  id: 'run-id-0001',
  initiative_id: FULL_UUID,
  phase: 'done',
  completed_at: '2026-07-14T10:00:00.000Z',
  failure_reason: null,
  pr_url: null,
  evaluate_verdict: null,
  judge_verdict: null,
  cost_usd: null,
};

const RUN_NEWER = {
  id: 'run-id-newer',
  initiative_id: 'aabb1122-0000-0000-0000-000000000002',
  phase: 'evaluate',
  completed_at: null,
  failure_reason: null,
  pr_url: null,
  evaluate_verdict: null,
  judge_verdict: null,
  cost_usd: null,
};

beforeEach(async () => {
  vi.clearAllMocks();
  app = await buildApp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-1] 短号命中唯一活跃 v2 run → 200 + phase 更新', () => {
  it('返回 200 且响应体含 phase=done', async () => {
    // 第一次 query：短号解析（返回唯一 run）
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ initiative_id: FULL_UUID }] }) // 短号 SELECT
      .mockResolvedValueOnce({ rows: [SINGLE_RUN] }); // UPDATE RETURNING

    const res = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${SHORT_ID}`)
      .send({ phase: 'done' });

    expect(res.status).toBe(200);
    expect(res.body.phase).toBe('done');
    expect(res.body.completed_at).toBeTruthy();
  });

  it('UPDATE SQL 使用完整 UUID（不把短号直传 pg）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ initiative_id: FULL_UUID }] })
      .mockResolvedValueOnce({ rows: [SINGLE_RUN] });

    await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${SHORT_ID}`)
      .send({ phase: 'done' });

    // 第二次调用（UPDATE）的参数 $1 必须是完整 UUID，不能是短号
    const updateCall = mockPool.query.mock.calls[1];
    expect(updateCall[1][0]).toBe(FULL_UUID);
    expect(updateCall[1][0]).not.toBe(SHORT_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-2] 短号命中多条非终态 run → 取 started_at 最新', () => {
  it('更新的是 started_at 最新的 run（解析 SELECT 用 ORDER BY started_at DESC LIMIT 1）', async () => {
    const NEWER_UUID = 'aabb1122-0000-0000-0000-000000000002';

    mockPool.query
      .mockResolvedValueOnce({ rows: [{ initiative_id: NEWER_UUID }] }) // 解析取最新
      .mockResolvedValueOnce({ rows: [{ ...RUN_NEWER, initiative_id: NEWER_UUID }] });

    const res = await request(app)
      .patch('/api/brain/orchestrator/relay-runs/aabb1122')
      .send({ phase: 'evaluate' });

    expect(res.status).toBe(200);
    expect(res.body.initiative_id).toBe(NEWER_UUID);
  });

  it('短号解析 SELECT 包含 ORDER BY started_at DESC LIMIT 1', async () => {
    const NEWER_UUID = 'aabb1122-0000-0000-0000-000000000002';
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ initiative_id: NEWER_UUID }] })
      .mockResolvedValueOnce({ rows: [{ ...RUN_NEWER, initiative_id: NEWER_UUID }] });

    await request(app)
      .patch('/api/brain/orchestrator/relay-runs/aabb1122')
      .send({ phase: 'evaluate' });

    const resolveSQL = mockPool.query.mock.calls[0][0].toLowerCase();
    expect(resolveSQL).toMatch(/order by started_at desc/);
    expect(resolveSQL).toMatch(/limit 1/);
  });

  it('短号解析 SELECT 排除终态（done/failed）', async () => {
    const NEWER_UUID = 'aabb1122-0000-0000-0000-000000000002';
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ initiative_id: NEWER_UUID }] })
      .mockResolvedValueOnce({ rows: [{ ...RUN_NEWER, initiative_id: NEWER_UUID }] });

    await request(app)
      .patch('/api/brain/orchestrator/relay-runs/aabb1122')
      .send({ phase: 'evaluate' });

    const resolveSQL = mockPool.query.mock.calls[0][0].toLowerCase();
    expect(resolveSQL).toMatch(/done/);
    expect(resolveSQL).toMatch(/failed/);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-3] 短号命中 0 条 → 404 且 error 含短号原值', () => {
  it('返回 404 且 error 字段含短号 00000000', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }); // 短号解析无结果

    const res = await request(app)
      .patch('/api/brain/orchestrator/relay-runs/00000000')
      .send({ phase: 'done' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/00000000/);
  });

  it('命中 0 条时不执行 UPDATE', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await request(app)
      .patch('/api/brain/orchestrator/relay-runs/00000000')
      .send({ phase: 'done' });

    // 只调用了一次（短号解析），未调用第二次（UPDATE）
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-4] 格式非法 → 400，不触发 DB 查询', () => {
  const INVALID_IDS = [
    'bad-id!',       // 含非十六进制字符 + 感叹号
    'gggggggg',      // 8 位但含非十六进制字符 g
    'abcd',          // 长度不足
    'abcdefgh',      // 8 位但 h 非十六进制
    'abcdef123',     // 9 位
    '',              // 空（路由参数不会命中但防御性测试）
  ];

  it.each(INVALID_IDS)('非法格式 "%s" → 400 invalid id format', async (badId) => {
    const res = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${encodeURIComponent(badId)}`)
      .send({ phase: 'done' });

    // 空字符串路由不命中，跳过
    if (badId === '') return;

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid id format');
  });

  it('格式非法时 pool.query 不被调用', async () => {
    await request(app)
      .patch('/api/brain/orchestrator/relay-runs/gggggggg')
      .send({ phase: 'done' });

    expect(mockPool.query).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-5] 完整 UUID 走既有逻辑，不回退', () => {
  it('完整 UUID 存在时返回 200', async () => {
    // 完整 UUID 路径：直接 UPDATE，不经过短号解析 SELECT
    mockPool.query.mockResolvedValueOnce({ rows: [SINGLE_RUN] });

    const res = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${FULL_UUID}`)
      .send({ phase: 'done' });

    expect(res.status).toBe(200);
  });

  it('完整 UUID 不存在时返回 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${FULL_UUID}`)
      .send({ phase: 'done' });

    expect(res.status).toBe(404);
  });

  it('完整 UUID 路径不误触发短号解析（query 只调用一次）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [SINGLE_RUN] });

    await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${FULL_UUID}`)
      .send({ phase: 'done' });

    // 完整 UUID 路径只有一次 UPDATE query，不做短号解析
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('[BEHAVIOR-6] DB 抛异常 → 500 + console.warn 含短号', () => {
  it('短号解析阶段 DB 抛异常 → 500 + console.warn 含短号', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockPool.query.mockRejectedValueOnce(new Error('connection refused'));

    const res = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${SHORT_ID}`)
      .send({ phase: 'done' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal error');

    // console.warn 必须含短号原值（不静默）
    const warnArgs = warnSpy.mock.calls.flat().join(' ');
    expect(warnArgs).toMatch(new RegExp(SHORT_ID));
  });

  it('UPDATE 阶段 DB 抛异常 → 500 + console.warn 含短号', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ initiative_id: FULL_UUID }] }) // 短号解析成功
      .mockRejectedValueOnce(new Error('invalid input syntax for type uuid')); // UPDATE 失败

    const res = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${SHORT_ID}`)
      .send({ phase: 'done' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal error');

    const warnArgs = warnSpy.mock.calls.flat().join(' ');
    expect(warnArgs).toMatch(new RegExp(SHORT_ID));
  });

  it('响应体不暴露内部错误信息', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockPool.query.mockRejectedValueOnce(new Error('secret internal detail'));

    const res = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${SHORT_ID}`)
      .send({ phase: 'done' });

    expect(res.body.error).not.toMatch(/secret internal detail/);
    expect(res.body.error).toBe('internal error');
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('既有行为回归（PR-PRD 铁律：不改字段语义）', () => {
  it('phase 白名单校验仍然有效（非法 phase → 400）', async () => {
    const res = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${SHORT_ID}`)
      .send({ phase: 'bogus' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid phase/);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('pr_url 格式校验仍然有效（非 github URL → 400）', async () => {
    const res = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${SHORT_ID}`)
      .send({ phase: 'done', pr_url: 'http://evil.com' });

    expect(res.status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });
});
