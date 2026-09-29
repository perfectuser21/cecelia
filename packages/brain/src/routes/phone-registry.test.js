/**
 * GET/PUT /api/brain/phone-registry（任务 b923b1f7，决策 432172f7 方案 C）。
 * 台账是手机映射的唯一真身：列表只读开放，upsert 必须过内部令牌（internalAuthOrLoopback），不许裸奔。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../db.js', () => ({ default: mockPool }));

let app;
let router;
const TOKEN = 'test-internal-token';

beforeAll(async () => {
  router = (await import('./phone-registry.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/brain', router);
});

beforeEach(() => {
  mockPool.query.mockReset();
  process.env.CECELIA_INTERNAL_TOKEN = TOKEN;
});
afterEach(() => { delete process.env.CECELIA_INTERNAL_TOKEN; });

const row = { serial: 'ANGYVB4402004137', nickname: '小黄', aliases: ['一号机'], host: 'xian-m4', profile: 'legacy', enabled: true };

describe('GET /api/brain/phone-registry', () => {
  it('返回全量行（含 disabled），按 serial 排序', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [row] });
    const res = await request(app).get('/api/brain/phone-registry');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ phones: [row], count: 1 });
    expect(mockPool.query.mock.calls[0][0]).toMatch(/FROM phone_registry/);
    expect(mockPool.query.mock.calls[0][0]).toMatch(/ORDER BY serial/);
  });
});

describe('PUT /api/brain/phone-registry/:serial', () => {
  it('挂 internalAuthOrLoopback 中间件', () => {
    const layer = router.stack.find((l) => l.route?.path === '/phone-registry/:serial' && l.route.methods.put);
    expect(layer).toBeTruthy();
    expect(layer.route.stack[0].handle.name).toBe(internalAuthOrLoopback.name);
  });

  it('无令牌 → 401，不写库', async () => {
    const res = await request(app).put('/api/brain/phone-registry/ANGYVB4402004137').send({ nickname: '小黄' });
    expect(res.status).toBe(401);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('错令牌 → 401，不写库', async () => {
    const res = await request(app).put('/api/brain/phone-registry/ANGYVB4402004137')
      .set('Authorization', 'Bearer wrong').send({ nickname: '小黄' });
    expect(res.status).toBe(401);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('带令牌 → upsert：ON CONFLICT (serial) 只改传了的字段，参数化，回写整行', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ...row, updated_by: 'ops' }] });
    const res = await request(app).put('/api/brain/phone-registry/ANGYVB4402004137')
      .set('X-Internal-Token', TOKEN)
      .send({
        nickname: '小黄', aliases: ['一号机'], host: 'xian-m4', profile: 'legacy',
        douyin_accounts: [{ id: '44997267357', nickname: '人工智能小诺考评', current: true }], updated_by: 'ops',
      });
    expect(res.status).toBe(200);
    expect(res.body.phone).toMatchObject({ serial: 'ANGYVB4402004137', nickname: '小黄' });
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO phone_registry/);
    expect(sql).toMatch(/ON CONFLICT \(serial\) DO UPDATE SET/);
    expect(sql).toMatch(/RETURNING/);
    expect(sql).not.toContain('小黄');
    expect(params).toContain('ANGYVB4402004137');
    expect(params).toContain('小黄');
    expect(params).toContain('ops');
    // 没传的列（model/owner/role/wechat/enabled）不进 DO UPDATE SET，台账里已有的值不被冲掉
    const updateSet = sql.split('DO UPDATE SET')[1];
    expect(updateSet).not.toMatch(/\bmodel\s*=/);
    expect(updateSet).not.toMatch(/\benabled\s*=/);
    expect(updateSet).toMatch(/updated_at\s*=\s*NOW\(\)/);
  });

  it('只改 enabled（停用一台）也行：新行插入时 nickname 仍必填由库兜底', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ ...row, enabled: false }] });
    const res = await request(app).put('/api/brain/phone-registry/ANGYVB4402004137')
      .set('Authorization', `Bearer ${TOKEN}`).send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.phone.enabled).toBe(false);
  });

  it('非法入参 → 400：serial 含非法字符 / nickname 空串 / aliases 非字符串数组 / douyin_accounts 形状错 / 多个 current', async () => {
    const put = (serial, body) => request(app).put(`/api/brain/phone-registry/${encodeURIComponent(serial)}`)
      .set('X-Internal-Token', TOKEN).send(body);
    expect((await put('bad serial;', { nickname: 'x' })).status).toBe(400);
    expect((await put('S1', { nickname: '' })).status).toBe(400);
    expect((await put('S1', { nickname: 'x', aliases: [1] })).status).toBe(400);
    expect((await put('S1', { nickname: 'x', douyin_accounts: [{ id: 1 }] })).status).toBe(400);
    expect((await put('S1', { nickname: 'x', douyin_accounts: [{ nickname: 'a', current: true }, { nickname: 'b', current: true }] })).status).toBe(400);
    expect((await put('S1', { nickname: 'x', enabled: 'yes' })).status).toBe(400);
    expect((await put('S1', {})).status).toBe(400);
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('库报错 → 500，不吞', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).put('/api/brain/phone-registry/S1').set('X-Internal-Token', TOKEN).send({ nickname: 'x' });
    expect(res.status).toBe(500);
  });
});
