/**
 * MJ5 Promise Map API — 刀1 新字段 + blast-radius 端点单元测试
 * PRD: docs/prd/2026-07-17-mj5-promise-map-first-cut.prd.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  vi.resetModules();
  const { default: router } = await import('../journeys.js');
  const express = await import('express');
  const app = express.default();
  app.use(express.default.json());
  app.use('/api/brain', router);
  return app;
}

describe('POST /api/brain/journeys — home 字段', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('接受合法 home=factory 并写入', async () => {
    const fakeRow = { id: 'j1', name: 'Line04', home: 'factory', notion_synced_at: null };
    mockQuery
      .mockResolvedValueOnce({ rows: [fakeRow] });   // INSERT（body 无 area，lookup 跳过）
    const app = await makeApp();
    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/journeys')
      .send({ name: 'Line04', journey_type: 'user_facing', home: 'factory' });
    expect(res.status).toBe(201);
    expect(res.body.home).toBe('factory');
  });

  it('非法 home 值返回 400', async () => {
    const app = await makeApp();
    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/journeys')
      .send({ name: 'X', journey_type: 'user_facing', home: 'invalid_home' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/home must be one of/);
  });

  it('写入 trigger + endpoint 字段', async () => {
    const fakeRow = {
      id: 'j2', name: 'GP', home: 'biz',
      trigger: '主理人拍板', endpoint: '账本可查',
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [fakeRow] });   // INSERT（body 无 area，lookup 跳过）
    const app = await makeApp();
    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/journeys')
      .send({ name: 'GP', journey_type: 'user_facing', home: 'biz',
              trigger: '主理人拍板', endpoint: '账本可查' });
    expect(res.status).toBe(201);
    expect(res.body.trigger).toBe('主理人拍板');
  });
});

describe('POST /api/brain/journey_steps — promise 字段', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('写入 promise + backbone_version', async () => {
    const fakeRow = {
      id: 's1', journey_id: 'j1', name: 'S1', step_number: 1,
      promise: '账本写入', backbone_version: '1.0',
    };
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });
    const app = await makeApp();
    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/journey_steps')
      .send({ journey_id: 'j1', name: 'S1', step_number: 1,
              promise: '账本写入', backbone_version: '1.0' });
    expect(res.status).toBe(200);
    expect(res.body.promise).toBe('账本写入');
  });
});

describe('POST /api/brain/journey_features — softness 字段', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('接受合法 softness=hard', async () => {
    const fakeRow = { id: 'f1', name: 'RPA引擎', softness: 'hard' };
    mockQuery
      .mockResolvedValueOnce({ rows: [fakeRow] });   // INSERT（body 无 journey_id/area，两个 lookup 跳过）
    const app = await makeApp();
    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/journey_features')
      .send({ name: 'RPA引擎', softness: 'hard' });
    expect(res.status).toBe(201);
    expect(res.body.softness).toBe('hard');
  });

  it('非法 softness 返回 400', async () => {
    const app = await makeApp();
    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/journey_features')
      .send({ name: 'F', softness: 'medium' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/softness must be one of/);
  });
});

describe('PATCH /api/brain/journey_features/:id — softness 字段', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('PATCH softness=soft 成功', async () => {
    const fakeRow = { id: 'f1', name: 'F', softness: 'soft', updated_at: new Date() };
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });
    const app = await makeApp();
    const request = await import('supertest');
    const res = await request.default(app)
      .patch('/api/brain/journey_features/f1')
      .send({ softness: 'soft' });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/brain/journey_step_links — cell 字段', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('写入 feature_id + cell_kind + cell_status=green + assertion_ref（cell 通道，含 step 一致性预查）', async () => {
    const fakeRow = {
      id: 'l1', journey_id: 'j1', step_id: 's1',
      feature_id: 'f1', cell_kind: 'capability', cell_key: '文字识别', cell_status: 'green',
      assertion_ref: 'tests/routes/crm.test.ts',
    };
    // 349 双通道语义：cell 分支先查 step 归属做 journey_id 一致性校验，再 upsert
    mockQuery.mockResolvedValueOnce({ rows: [{ journey_id: 'j1' }] });
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });
    const app = await makeApp();
    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/journey_step_links')
      .send({
        journey_id: 'j1', step_id: 's1',
        feature_id: 'f1', cell_kind: 'capability', cell_key: '文字识别', cell_status: 'green',
        assertion_ref: 'tests/routes/crm.test.ts',
      });
    expect(res.status).toBe(201);
    expect(res.body.cell_status).toBe('green');
    expect(res.body.assertion_ref).toBe('tests/routes/crm.test.ts');
  });

  it('非法 cell_status 返回 400', async () => {
    const app = await makeApp();
    const request = await import('supertest');
    const res = await request.default(app)
      .post('/api/brain/journey_step_links')
      .send({ journey_id: 'j1', step_id: 's1', cell_kind: 'capability', cell_key: 'x', cell_status: 'yellow' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cell_status must be one of/);
  });
});

describe('PATCH /api/brain/journey_step_links/:id — cell 状态回写', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('回写 cell_status=green + assertion_ref 成功（fail-closed：必须带 assertion_ref）', async () => {
    const fakeRow = { id: 'l1', cell_status: 'green', assertion_ref: 'tests/foo.test.js' };
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow] });
    const app = await makeApp();
    const request = await import('supertest');
    const res = await request.default(app)
      .patch('/api/brain/journey_step_links/l1')
      .send({ cell_status: 'green', assertion_ref: 'tests/foo.test.js' });
    expect(res.status).toBe(200);
  });

  it('回写 cell_status=green 无 assertion_ref → 422（fail-closed，决策 df1ccf5a §③）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ assertion_ref: null }] });
    const app = await makeApp();
    const request = await import('supertest');
    const res = await request.default(app)
      .patch('/api/brain/journey_step_links/l1')
      .send({ cell_status: 'green' });
    expect(res.status).toBe(422);
  });

  it('无 fields 时返回 400', async () => {
    const app = await makeApp();
    const request = await import('supertest');
    const res = await request.default(app)
      .patch('/api/brain/journey_step_links/l1')
      .send({});
    expect(res.status).toBe(400);
  });

  it('不存在的 id 返回 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const app = await makeApp();
    const request = await import('supertest');
    const res = await request.default(app)
      .patch('/api/brain/journey_step_links/nope')
      .send({ cell_status: 'red' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/brain/features/:id/blast-radius', () => {
  beforeEach(() => { mockQuery.mockReset(); });

  it('返回 feature 元信息 + blast_radius 行 + affected_journeys', async () => {
    const blastRows = [
      {
        link_id: 'l1', cell_kind: '底座引用', cell_status: 'green',
        assertion_ref: 'tests/crm.test.ts',
        step_id: 's1', step_name: 'CRM档案建立', promise: '联系人信息写入 CRM',
        step_number: 7, journey_id: 'j1', journey_name: 'Line04 智能客服', home: 'biz',
      },
    ];
    const featureRow = { id: 'f1', name: 'CRM联系人档案', kind: 'feature', softness: 'hard', thickness: 'thin' };
    mockQuery
      .mockResolvedValueOnce({ rows: blastRows })     // JOIN query
      .mockResolvedValueOnce({ rows: [featureRow] }); // feature lookup
    const app = await makeApp();
    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/features/f1/blast-radius');
    expect(res.status).toBe(200);
    expect(res.body.feature.name).toBe('CRM联系人档案');
    expect(res.body.blast_radius).toHaveLength(1);
    expect(res.body.blast_radius[0].promise).toBe('联系人信息写入 CRM');
    expect(res.body.affected_journeys).toContain('Line04 智能客服');
  });

  it('feature 不存在时返回 404', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })   // JOIN query (empty)
      .mockResolvedValueOnce({ rows: [] });  // feature lookup (empty)
    const app = await makeApp();
    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/features/ghost/blast-radius');
    expect(res.status).toBe(404);
  });

  it('引用为空时 blast_radius=[] affected_journeys=[]', async () => {
    const featureRow = { id: 'f2', name: '孤儿件', kind: 'feature', softness: null, thickness: 'thin' };
    mockQuery
      .mockResolvedValueOnce({ rows: [] })            // JOIN query (no refs)
      .mockResolvedValueOnce({ rows: [featureRow] }); // feature lookup
    const app = await makeApp();
    const request = await import('supertest');
    const res = await request.default(app).get('/api/brain/features/f2/blast-radius');
    expect(res.status).toBe(200);
    expect(res.body.blast_radius).toHaveLength(0);
    expect(res.body.affected_journeys).toHaveLength(0);
  });
});
