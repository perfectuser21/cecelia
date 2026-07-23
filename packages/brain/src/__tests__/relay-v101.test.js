/**
 * v1.0.1 接线三件（N4 三跑实证修订，与 harness-controller skill v1.1.0 配套）：
 * 1. PATCH /api/brain/orchestrator/relay-runs/:initiative_id —— controller report 步骤回写终态
 *    （治 Brain 巡逻把 relay run 误判 Stuck at Planner 的问题）
 * 2. spawn env 补 HARNESS_NODE + HARNESS_CALLBACK_URL —— entrypoint tee stdout 观测
 * 3. /harness/callback/:containerId 对 cecelia-relay-* 容器 200 ack ——
 *    relay session 无 thread_lookup，免掉 entrypoint 5×404 重试尾巴（~36s/session）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));

async function buildApp() {
  const { default: router } = await import('../routes/initiatives.js');
  const a = express();
  a.use(express.json());
  a.use('/api/brain/orchestrator', router);
  return a;
}

beforeEach(() => {
  mockPool.query.mockReset();
});

describe('PATCH /relay-runs/:initiative_id（controller 终态回写）', () => {
  const ID = 'bbbbcccc-1111-2222-3333-444455556666';

  it('phase=done → UPDATE v2 行 + completed_at，200 返回更新后对象', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ initiative_id: ID, phase: 'done' }] });
    const app = await buildApp();
    const r = await request(app).patch(`/api/brain/orchestrator/relay-runs/${ID}`).send({ phase: 'done' });
    expect(r.status).toBe(200);
    expect(r.body.phase).toBe('done');
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE initiative_runs/);
    expect(sql).toMatch(/orchestrator_version\s*=\s*'v2'/); // 只允许改 v2 行
    expect(sql).toMatch(/completed_at/);
    expect(params).toContain(ID);
  });

  it('phase=failed 带 failure_reason → 落 failure_reason', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ initiative_id: ID, phase: 'failed' }] });
    const app = await buildApp();
    const r = await request(app).patch(`/api/brain/orchestrator/relay-runs/${ID}`).send({ phase: 'failed', failure_reason: '账号 401' });
    expect(r.status).toBe(200);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/failure_reason/);
    expect(params).toContain('账号 401');
  });

  // 行为变更（relay-watchdog PR）：白名单扩到 312 中间态（进度条数据源），
  // planning/gan/generate/evaluate 从 400 变为合法——本测试同步到新语义。
  it('phase 白名单外（如 bogus）→ 400 + allowed 列表，零 DB 调用', async () => {
    const app = await buildApp();
    const r = await request(app).patch(`/api/brain/orchestrator/relay-runs/${ID}`).send({ phase: 'bogus' });
    expect(r.status).toBe(400);
    expect(r.body.allowed).toEqual(['planning', 'gan', 'generate', 'evaluate', 'done', 'failed']);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('中间态 phase=generate → 200 且不写 completed_at（进度上报语义）', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ initiative_id: ID, phase: 'generate' }] });
    const app = await buildApp();
    const r = await request(app).patch(`/api/brain/orchestrator/relay-runs/${ID}`).send({ phase: 'generate' });
    expect(r.status).toBe(200);
    const [sql] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/CASE WHEN \$2 IN \('done','failed'\)/);
  });

  it('目标不存在或非 v2 → 404 JSON', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const app = await buildApp();
    const r = await request(app).patch(`/api/brain/orchestrator/relay-runs/${ID}`).send({ phase: 'done' });
    expect(r.status).toBe(404);
    expect(r.body.error).toBeTruthy();
  });

  it('DB 失败 → 500 JSON 且不暴露内部 err.message', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('pg secret detail'));
    const app = await buildApp();
    const r = await request(app).patch(`/api/brain/orchestrator/relay-runs/${ID}`).send({ phase: 'done' });
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('pg secret detail');
  });
});

describe('spawn env 观测接线（HARNESS_NODE + HARNESS_CALLBACK_URL）', () => {
  it('spawnSkillRelaySession 的 env 含 HARNESS_NODE=controller 且 callback URL 含 containerId', async () => {
    const { spawnSkillRelaySession } = await import('../harness-skill-relay.js');
    const deps = {
      pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      spawnFn: vi.fn().mockResolvedValue({}),
      loadSkill: vi.fn().mockReturnValue('SKILL'),
      ensureWt: vi.fn().mockResolvedValue('/tmp/wt'),
      resolveAccountFn: vi.fn().mockImplementation(async (o) => { o.env = o.env || {}; o.env.CECELIA_CREDENTIALS = 'account1'; }),  // 新契约（5167ef48）：claude 需已解析账号
      tokenFn: vi.fn().mockResolvedValue('t'),
      now: () => new Date('2026-07-04T12:00:00Z'),
    };
    const task = { id: 'aaaabbbb-cccc-dddd-eeee-ffff00001111', payload: { orchestrator: 'skill-relay', sprint_dir: 's' } };
    const r = await spawnSkillRelaySession(task, deps);
    expect(r.ok).toBe(true);
    const opts = deps.spawnFn.mock.calls[0][0];
    expect(opts.env.HARNESS_NODE).toBe('controller');
    expect(opts.env.HARNESS_CALLBACK_URL).toContain(opts.containerId);
    expect(opts.env.HARNESS_CALLBACK_URL).toMatch(/^http:\/\/host\.docker\.internal:5221\/api\/brain\/harness\/callback\//);
  });
});

describe('harness-callback 对 relay 容器 200 ack', () => {
  it('containerId 前缀 cecelia-relay- → 200 relayAck，不做 thread lookup', async () => {
    const { default: cbRouter } = await import('../routes/harness-callback.js');
    const a = express();
    a.use(express.json());
    a.use('/api/brain', cbRouter);
    const r = await request(a)
      .post('/api/brain/harness/callback/cecelia-relay-deadbeef-12345678')
      .send({ result: 'completed', exit_code: 0, stdout: 'x' });
    expect(r.status).toBe(200);
    expect(r.body.relayAck).toBe(true);
  });
});
