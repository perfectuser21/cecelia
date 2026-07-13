/**
 * PATCH /api/brain/orchestrator/relay-runs/:initiative_id — verdict/cost 写入
 * P1 裁决结构化回写（spec 2026-07-11-relay-verdict-writeback-design.md）
 * TDD Red：handler 未扩字段前，SQL/参数断言全 FAIL
 * 铁律：verdict/cost 非法值绝不 400（否则打回 phase=done 终态 → watchdog 重点火）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));

const INITIATIVE_ID = 'aaaabbbb-1111-2222-3333-444455556666';
const ROW = {
  id: 'r1', initiative_id: INITIATIVE_ID, phase: 'done', completed_at: null,
  failure_reason: null, pr_url: null, evaluate_verdict: null, judge_verdict: 'PASS', cost_usd: 1.23,
};

let app;
async function buildApp() {
  const { default: router } = await import('../routes/initiatives.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/orchestrator', router);
  return a;
}
const lastCall = () => mockPool.query.mock.calls[mockPool.query.mock.calls.length - 1];

describe('PATCH /relay-runs/:id — verdict/cost best-effort 写入', () => {
  beforeEach(async () => { vi.clearAllMocks(); app = await buildApp(); });

  it('verdict=PASS + cost=1.23 → 200，SQL 写 judge_verdict/cost_usd，参数投影正确', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [ROW] });
    const res = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({ phase: 'done', verdict: 'PASS', cost: 1.23, pr_url: 'https://github.com/x/y/pull/1' })
      .expect(200);
    const [sql, params] = lastCall();
    expect(sql).toMatch(/judge_verdict\s*=\s*COALESCE\(\$6,\s*judge_verdict\)/);
    expect(sql).toMatch(/evaluate_verdict\s*=\s*COALESCE\(\$5,\s*evaluate_verdict\)/);
    expect(sql).toMatch(/cost_usd\s*=\s*COALESCE\(\$7,\s*cost_usd\)/);
    expect(params[5]).toBe('PASS');
    expect(params[6]).toBe(1.23);
    expect(res.body).toHaveProperty('judge_verdict', 'PASS');
  });

  it('小写 verdict=pass → 归一大写 PASS 写入', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [ROW] });
    await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({ phase: 'done', verdict: 'pass' })
      .expect(200);
    const [, params] = lastCall();
    expect(params[5]).toBe('PASS');
  });

  it('非法 verdict=MAYBE → 仍 200（phase 照写），judge_verdict 参数 null，响应含 warnings', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ...ROW, judge_verdict: null }] });
    const res = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({ phase: 'done', verdict: 'MAYBE' })
      .expect(200);
    const [, params] = lastCall();
    expect(params[1]).toBe('done');
    expect(params[5]).toBeNull();
    expect(res.body.warnings).toContain('verdict_ignored');
  });

  it('cost 字符串 "1.23" 归一为数字；cost=-1 被忽略', async () => {
    mockPool.query.mockResolvedValue({ rows: [ROW] });
    await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({ phase: 'done', cost: '1.23' })
      .expect(200);
    expect(lastCall()[1][6]).toBe(1.23);
    const res = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({ phase: 'done', cost: -1 })
      .expect(200);
    expect(lastCall()[1][6]).toBeNull();
    expect(res.body.warnings).toContain('cost_ignored');
  });

  it('evaluate_verdict=FIXED（合法前科值）→ 写入', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ...ROW, evaluate_verdict: 'FIXED' }] });
    await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({ phase: 'evaluate', evaluate_verdict: 'FIXED' })
      .expect(200);
    expect(lastCall()[1][4]).toBe('FIXED');
  });

  it('不带新字段 → 三个新参数全 null（现状行为不变，防回归）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [ROW] });
    const res = await request(app)
      .patch(`/api/brain/orchestrator/relay-runs/${INITIATIVE_ID}`)
      .send({ phase: 'done' })
      .expect(200);
    const [, params] = lastCall();
    expect(params[4]).toBeNull();
    expect(params[5]).toBeNull();
    expect(params[6]).toBeNull();
    expect(res.body).not.toHaveProperty('warnings');
  });
});
