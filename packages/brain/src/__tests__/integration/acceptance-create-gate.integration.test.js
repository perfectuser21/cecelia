import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import pool from '../../db.js';
import { createAcceptanceInternalRouter } from '../../routes/acceptance.js';

const GP = `t12-gp-gate-${process.pid}`;
const PREV = `t12-gate-prev-${process.pid}`;
const NEXT = `t12-gate-next-${process.pid}`;
const LINK = `t12-gate-link-${process.pid}`;
const CHECKS = [{ check_key: 'S3-c1', kind: 'FR', name: '权限三项已开启' }];
const HEAD = {
  tenant_account: 'acc-verify-01',
  backend_sha: 'a'.repeat(40), backend_sha_src2: 'a'.repeat(40),
  frontend_sha: 'b'.repeat(40), frontend_sha_src2: 'b'.repeat(40),
  spec_sha: 'c'.repeat(64),
};
/** fixture 规程里 scenario_class: mandatory 的那 5 格（Task 8 的闸按这批取数） */
const MANDATORY = ['S4-c2', 'S4-c3', 'S5-c3', 'S5-c4', 'S10-c4'];
const ALL_KEYS = [[PREV, NEXT, LINK]];

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/acceptance', createAcceptanceInternalRouter({ pool }));
  return app;
}

const create = (body) => request(makeApp()).post('/api/brain/acceptance/runs').send({
  run_key: NEXT, title: '下一轮', gp_id: GP, checks: CHECKS, detail: HEAD, ...body,
});

async function seedPrev({ closed }) {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = ANY($1)', ALL_KEYS);
  await pool.query(
    `INSERT INTO acceptance_runs (run_key, title, gp_id, status, detail)
     VALUES ($1,'上一轮',$2,'adjudicated',$3::jsonb)`,
    [PREV, GP, JSON.stringify(closed ? { review_closed_at: new Date().toISOString() } : {})]
  );
}

afterAll(async () => {
  await pool.query('DELETE FROM acceptance_runs WHERE run_key = ANY($1)', ALL_KEYS);
  await pool.end();
});

describe('A15①⑥⑦ 建单前置与逃生阀', () => {
  beforeEach(() => seedPrev({ closed: false }));

  it('A15① 上一轮未闭环复盘 → 409 且无新行', async () => {
    const res = await create({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('previous_review_not_closed');
    const { rows } = await pool.query('SELECT 1 FROM acceptance_runs WHERE run_key = $1', [NEXT]);
    expect(rows).toHaveLength(0);
  });

  it('A15⑥ force_reason <20 字 → 仍 409', async () => {
    const res = await create({ force_reason: '急着发版', force_opened_by: 'alex' });
    expect(res.status).toBe(409);
  });

  it('A15⑥⑦ force_reason ≥20 字 → 放行 201 且三项留痕', async () => {
    const reason = '上一轮验收人休假联系不上，本轮为客户演示不可延期，风险由我承担';
    const res = await create({ force_reason: reason, force_opened_by: 'alex' });
    expect(res.status).toBe(201);
    const { rows } = await pool.query('SELECT detail FROM acceptance_runs WHERE run_key = $1', [NEXT]);
    expect(rows[0].detail.force_reason).toBe(reason);
    expect(rows[0].detail.force_opened_by).toBe('alex');
    expect(rows[0].detail.force_opened_at).toBeTruthy();
  });

  it('上一轮已闭环 → 无需 force 直接 201', async () => {
    await seedPrev({ closed: true });
    expect((await create({})).status).toBe(201);
  });

  it('A16② 非专用租户账号 → 非 200 且无新行', async () => {
    await seedPrev({ closed: true });
    const res = await create({ detail: { ...HEAD, tenant_account: 'prod-customer-9' } });
    expect(res.status).toBe(400);
    const { rows } = await pool.query('SELECT 1 FROM acceptance_runs WHERE run_key = $1', [NEXT]);
    expect(rows).toHaveLength(0);
  });

  it('ACCEPTANCE_TENANT_ALLOWLIST 缺失 → 拒绝建单（fail-closed，不是降级放行）', async () => {
    await seedPrev({ closed: true });
    const saved = process.env.ACCEPTANCE_TENANT_ALLOWLIST;
    delete process.env.ACCEPTANCE_TENANT_ALLOWLIST;
    try {
      const res = await create({});
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('acceptance_tenant_allowlist_unset');
    } finally {
      process.env.ACCEPTANCE_TENANT_ALLOWLIST = saved;
    }
  });
});

/**
 * A16①-b 接链：Task 8 的收单期推进闸读 detail.scenarios_observed，但在本刀之前
 * 没有任何写入路径能把它放进去——闸永远拦着，等于整条 AI 回写链死锁。
 * 建单落 detail 就是那条写入侧，这两例断言的是「写进去的确实是闸读到的那一份」。
 */
describe('A16①-b scenarios_observed 写入侧接链', () => {
  const createLink = (detail) => request(makeApp()).post('/api/brain/acceptance/runs').send({
    run_key: LINK, title: '接链单', checks: CHECKS, detail: { ...HEAD, ...detail },
  });
  const aiWrite = () => request(makeApp()).post('/api/brain/acceptance/ai-results')
    .send({ run_key: LINK, results: [{ check_key: 'S3-c1', ai_verdict: '通过' }] });

  beforeEach(async () => {
    await pool.query('DELETE FROM acceptance_runs WHERE run_key = ANY($1)', ALL_KEYS);
  });

  it('建单带齐 mandatory 场景码 → 落库后 AI 回写被放行 200', async () => {
    expect((await createLink({ scenarios_observed: MANDATORY })).status).toBe(201);
    const { rows } = await pool.query('SELECT detail FROM acceptance_runs WHERE run_key = $1', [LINK]);
    expect(rows[0].detail.scenarios_observed).toEqual(MANDATORY);
    expect((await aiWrite()).status).toBe(200);
  });

  it('建单不带 scenarios_observed → AI 回写仍被闸拦 409（写入侧没做，闸不放水）', async () => {
    expect((await createLink({})).status).toBe(201);
    const res = await aiWrite();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('mandatory_scenarios_missing');
  });
});
