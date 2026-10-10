/**
 * /api/brain/resource-health（任务 5bf2512a，决策 de6dff5d 第 5 步）。
 * 写入口（执行端上报、账号切换三态）必须过内部令牌；读与调度前检查开放。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));
const mockNotify = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock('../lib/resource-health-alert.js', () => ({ notifyHealthTransition: mockNotify, decideHealthAlert: vi.fn() }));

const TOKEN = 'test-internal-token';
let app;

beforeAll(async () => {
  const router = (await import('./resource-health.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/brain', router);
});
beforeEach(() => {
  mockPool.query.mockReset();
  mockNotify.mockClear();
  process.env.CECELIA_INTERNAL_TOKEN = TOKEN;
});
afterEach(() => { delete process.env.CECELIA_INTERNAL_TOKEN; });

const auth = (r) => r.set('Authorization', `Bearer ${TOKEN}`);

describe('POST /resource-health/report', () => {
  it('无令牌 → 401，不写库', async () => {
    const res = await request(app).post('/api/brain/resource-health/report')
      .send({ resource_type: 'phone', resource_key: 'S1', status: 'healthy', source: 'x' });
    expect(res.status).toBe(401);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('非法状态 → 400', async () => {
    const res = await auth(request(app).post('/api/brain/resource-health/report'))
      .send({ resource_type: 'phone', resource_key: 'S1', status: 'dead', source: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status/);
  });

  it('合法上报 → 写库并回当前状态与是否变化', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'h1', resource_type: 'phone', resource_key: 'S1', status: 'offline', previous_status: 'healthy' }] });
    const res = await auth(request(app).post('/api/brain/resource-health/report'))
      .send({ resource_type: 'phone', resource_key: 'S1', status: 'offline', reason: 'adb 掉线', source: 'mirror' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, changed: true, previous_status: 'healthy', current: { status: 'offline' } });
    expect(mockNotify).toHaveBeenCalled();
  });

  it('item_key 不在仓库 → 422', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    const res = await auth(request(app).post('/api/brain/resource-health/report'))
      .send({ resource_type: 'phone', resource_key: 'S1', status: 'healthy', source: 'x', item_key: 'nope' });
    expect(res.status).toBe(422);
  });
});

describe('POST /resource-health/account-switch（账号三态判据）', () => {
  it('身份校验 → restricted + 指示立即退出不验证', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'h2', resource_type: 'account', resource_key: 'kuaishou:k9', status: 'restricted', previous_status: 'healthy' }] });
    const res = await auth(request(app).post('/api/brain/resource-health/account-switch'))
      .send({ platform: 'kuaishou', account_id: 'k9', outcome: 'verification_required', evidence: { screenshot: 'x.png' }, source: 'phone-rpa' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'restricted', action: 'exit_without_verification', resource_key: 'kuaishou:k9' });
    const params = mockPool.query.mock.calls[0][1];
    expect(params).toContain('kuaishou:k9');
    expect(params).toContain('restricted');
  });

  it('不健康结果不带证据 → 400', async () => {
    const res = await auth(request(app).post('/api/brain/resource-health/account-switch'))
      .send({ platform: 'douyin', account_id: 'a1', outcome: 'list_missing', source: 'phone-rpa' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/evidence/);
  });

  it('未知结果 → 400，不猜', async () => {
    const res = await auth(request(app).post('/api/brain/resource-health/account-switch'))
      .send({ platform: 'douyin', account_id: 'a1', outcome: 'weird', evidence: { a: 1 }, source: 'phone-rpa' });
    expect(res.status).toBe(400);
  });
});

describe('POST /resource-health/check（调度前检查）', () => {
  it('按资源清单查：被风控的列在 blocked 里，ok=false', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ resource_type: 'account', resource_key: 'douyin:a1', status: 'restricted', reason: '人脸', observed_at: new Date().toISOString() }] });
    const res = await request(app).post('/api/brain/resource-health/check')
      .send({ resources: [{ type: 'account', key: 'douyin:a1' }, { type: 'phone', key: 'S1' }] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.blocked).toHaveLength(1);
    expect(res.body.unknown).toEqual([{ type: 'phone', key: 'S1' }]);
    expect(res.body.summary).toMatch(/restricted/);
  });

  it('按任务 id 查：从 payload 收集资源', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: 't1', payload: { device_serial: 'S1' } }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/brain/resource-health/check').send({ task_id: 't1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, resources: [{ type: 'phone', key: 'S1' }] });
  });

  it('什么都没给 → 400', async () => {
    const res = await request(app).post('/api/brain/resource-health/check').send({});
    expect(res.status).toBe(400);
  });
});

describe('读接口', () => {
  it('GET /resource-health 列当前状态，可按类型/状态过滤', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ resource_type: 'phone', resource_key: 'S1', status: 'offline' }] });
    const res = await request(app).get('/api/brain/resource-health?type=phone&status=offline');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/FROM resource_health/);
    expect(params).toEqual(expect.arrayContaining(['phone', 'offline']));
  });

  it('GET /resource-health/:type/:key/history 返回状态变化历史', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ from_status: 'healthy', to_status: 'offline' }] });
    const res = await request(app).get('/api/brain/resource-health/account/douyin%3Aa1/history');
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(mockPool.query.mock.calls[0][1]).toEqual(expect.arrayContaining(['account', 'douyin:a1']));
  });

  it('GET /resource-health/warehouse 返回仓库物件健康汇总', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ key: 'adb_channel', worst_status: 'offline' }] });
    const res = await request(app).get('/api/brain/resource-health/warehouse');
    expect(res.status).toBe(200);
    expect(mockPool.query.mock.calls[0][0]).toMatch(/v_warehouse_item_health/);
  });
});
