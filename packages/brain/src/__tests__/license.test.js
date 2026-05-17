/**
 * License System 路由测试
 *
 * Admin:
 *   POST   /api/brain/admin/license      — 生成 license
 *   GET    /api/brain/admin/license      — 列表
 *   DELETE /api/brain/admin/license/:id  — 吊销
 *
 * Agent:
 *   POST   /api/brain/license/register   — 注册机器
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

// 让 internalAuth 在测试中直接放行（CECELIA_INTERNAL_TOKEN 未设置）
vi.mock('../middleware/internal-auth.js', () => ({
  internalAuth: (_req, _res, next) => next(),
  _resetInternalAuthWarning: vi.fn(),
}));

let app;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  app = express();
  app.use(express.json());

  const { default: licenseRouter } = await import('../routes/license.js');
  app.use('/api/brain', licenseRouter);
});

// ─────────────────────────────────────────────────────
// generateLicenseKey
// ─────────────────────────────────────────────────────
describe('generateLicenseKey', () => {
  it('生成 CECE-XXXX-XXXX-XXXX-XXXX 格式', async () => {
    const { generateLicenseKey } = await import('../routes/license.js');
    const key = generateLicenseKey();
    expect(key).toMatch(/^CECE-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  it('每次生成唯一 key', async () => {
    const { generateLicenseKey } = await import('../routes/license.js');
    const keys = new Set(Array.from({ length: 20 }, () => generateLicenseKey()));
    expect(keys.size).toBe(20);
  });
});

// ─────────────────────────────────────────────────────
// TIER_CONFIG
// ─────────────────────────────────────────────────────
describe('TIER_CONFIG', () => {
  it('各 tier max_machines 符合定价', async () => {
    const { TIER_CONFIG } = await import('../routes/license.js');
    expect(TIER_CONFIG.basic.max_machines).toBe(1);
    expect(TIER_CONFIG.matrix.max_machines).toBe(3);
    expect(TIER_CONFIG.studio.max_machines).toBe(10);
    expect(TIER_CONFIG.enterprise.max_machines).toBe(30);
  });
});

// ─────────────────────────────────────────────────────
// POST /api/brain/admin/license
// ─────────────────────────────────────────────────────
describe('POST /api/brain/admin/license', () => {
  it('创建 basic license，返回 201 + license 对象', async () => {
    const fakeRow = {
      id: 'uuid-1',
      license_key: 'CECE-AAAA-BBBB-CCCC-DDDD',
      tier: 'basic',
      max_machines: 1,
      expires_at: new Date(Date.now() + 365 * 86400000).toISOString(),
      status: 'active',
    };
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

    const res = await request(app)
      .post('/api/brain/admin/license')
      .send({ tier: 'basic' });

    expect(res.status).toBe(201);
    expect(res.body.tier).toBe('basic');
    expect(res.body.max_machines).toBe(1);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO licenses');
    expect(params[1]).toBe('basic');
    expect(params[2]).toBe(1);
  });

  it('tier 无效返回 400', async () => {
    const res = await request(app)
      .post('/api/brain/admin/license')
      .send({ tier: 'unknown' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tier 无效/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('缺少 tier 返回 400', async () => {
    const res = await request(app)
      .post('/api/brain/admin/license')
      .send({});

    expect(res.status).toBe(400);
  });

  it('expires_in_days 为负数返回 400', async () => {
    const res = await request(app)
      .post('/api/brain/admin/license')
      .send({ tier: 'basic', expires_in_days: -1 });

    expect(res.status).toBe(400);
  });

  it('enterprise tier max_machines=30', async () => {
    const fakeRow = { id: 'uuid-2', tier: 'enterprise', max_machines: 30, status: 'active' };
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

    const res = await request(app)
      .post('/api/brain/admin/license')
      .send({ tier: 'enterprise', customer_name: 'ACME', customer_email: 'cto@acme.com' });

    expect(res.status).toBe(201);
    const params = mockQuery.mock.calls[0][1];
    expect(params[2]).toBe(30);
    expect(params[3]).toBe('ACME');
    expect(params[4]).toBe('cto@acme.com');
  });
});

// ─────────────────────────────────────────────────────
// GET /api/brain/admin/license
// ─────────────────────────────────────────────────────
describe('GET /api/brain/admin/license', () => {
  it('返回 license 列表', async () => {
    const fakeRows = [
      { id: 'uuid-1', tier: 'basic', status: 'active', machines_used: '0' },
    ];
    mockQuery.mockResolvedValueOnce({ rows: fakeRows });

    const res = await request(app).get('/api/brain/admin/license');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].tier).toBe('basic');
  });

  it('支持 ?tier= 过滤', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/api/brain/admin/license?tier=enterprise');
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toContain('enterprise');
  });
});

// ─────────────────────────────────────────────────────
// DELETE /api/brain/admin/license/:id
// ─────────────────────────────────────────────────────
describe('DELETE /api/brain/admin/license/:id', () => {
  it('吊销存在的 license，返回 success', async () => {
    const fakeRow = { id: 'uuid-1', status: 'revoked', revoked_at: new Date().toISOString() };
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });

    const res = await request(app).delete('/api/brain/admin/license/uuid-1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.license.status).toBe('revoked');
  });

  it('不存在或已吊销返回 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).delete('/api/brain/admin/license/not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/不存在或已吊销/);
  });
});

// ─────────────────────────────────────────────────────
// POST /api/brain/license/register
// ─────────────────────────────────────────────────────
describe('POST /api/brain/license/register', () => {
  const validLicense = {
    id: 'lic-uuid-1',
    license_key: 'CECE-AAAA-BBBB-CCCC-DDDD',
    tier: 'matrix',
    max_machines: 3,
    status: 'active',
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  };

  it('新机器注册成功，返回 201 + registered:true', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [validLicense] })         // 查 license
      .mockResolvedValueOnce({ rows: [{ cnt: '1' }] })          // 当前装机数
      .mockResolvedValueOnce({ rows: [] })                       // 未注册
      .mockResolvedValueOnce({ rows: [] });                      // INSERT

    const res = await request(app)
      .post('/api/brain/license/register')
      .send({ license_key: 'CECE-AAAA-BBBB-CCCC-DDDD', machine_id: 'mac-001', machine_name: 'MacBook' });

    expect(res.status).toBe(201);
    expect(res.body.valid).toBe(true);
    expect(res.body.registered).toBe(true);
    expect(res.body.tier).toBe('matrix');
    expect(res.body.machines_used).toBe(2);
    expect(res.body.max_machines).toBe(3);
  });

  it('同一机器再次 register，返回 200 + registered:false（刷新 last_seen）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [validLicense] })          // 查 license
      .mockResolvedValueOnce({ rows: [{ cnt: '1' }] })           // 当前装机数
      .mockResolvedValueOnce({ rows: [{ id: 'mach-uuid-1' }] }) // 已注册
      .mockResolvedValueOnce({ rows: [] });                       // UPDATE last_seen_at

    const res = await request(app)
      .post('/api/brain/license/register')
      .send({ license_key: 'CECE-AAAA-BBBB-CCCC-DDDD', machine_id: 'mac-001' });

    expect(res.status).toBe(200);
    expect(res.body.registered).toBe(false);
    expect(res.body.valid).toBe(true);
  });

  it('装机配额已满返回 403', async () => {
    const fullLicense = { ...validLicense, max_machines: 1 };
    mockQuery
      .mockResolvedValueOnce({ rows: [fullLicense] })  // 查 license
      .mockResolvedValueOnce({ rows: [{ cnt: '1' }] }) // 当前装机数 = max
      .mockResolvedValueOnce({ rows: [] });              // 未注册此机器

    const res = await request(app)
      .post('/api/brain/license/register')
      .send({ license_key: 'CECE-AAAA-BBBB-CCCC-DDDD', machine_id: 'mac-new' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/配额已满/);
    expect(res.body.machines_used).toBe(1);
    expect(res.body.max_machines).toBe(1);
  });

  it('license 不存在返回 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/brain/license/register')
      .send({ license_key: 'CECE-XXXX-XXXX-XXXX-XXXX', machine_id: 'mac-001' });

    expect(res.status).toBe(404);
  });

  it('license 已吊销返回 403', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...validLicense, status: 'revoked' }] });

    const res = await request(app)
      .post('/api/brain/license/register')
      .send({ license_key: 'CECE-AAAA-BBBB-CCCC-DDDD', machine_id: 'mac-001' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/已被吊销/);
  });

  it('license 已过期返回 403', async () => {
    const expiredLicense = { ...validLicense, expires_at: new Date(Date.now() - 1000).toISOString() };
    mockQuery.mockResolvedValueOnce({ rows: [expiredLicense] });

    const res = await request(app)
      .post('/api/brain/license/register')
      .send({ license_key: 'CECE-AAAA-BBBB-CCCC-DDDD', machine_id: 'mac-001' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/已过期/);
  });

  it('缺少 license_key 返回 400', async () => {
    const res = await request(app)
      .post('/api/brain/license/register')
      .send({ machine_id: 'mac-001' });

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('缺少 machine_id 返回 400', async () => {
    const res = await request(app)
      .post('/api/brain/license/register')
      .send({ license_key: 'CECE-AAAA-BBBB-CCCC-DDDD' });

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
