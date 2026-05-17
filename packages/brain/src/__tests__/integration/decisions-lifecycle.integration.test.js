/**
 * Strategic Decisions Lifecycle — Integration Test
 *
 * 覆盖 /api/brain/strategic-decisions 完整 CRUD 链路：
 *
 *   POST（创建）→ GET list（查询）→ PUT（更新 rationale）→ PUT status=superseded → GET 验证消失
 *
 * 场景 1: POST 创建决策 → 返回 id + status=active，DB 持久化
 * 场景 2: GET ?status=active 列表包含刚创建的决策（前缀过滤隔离）
 * 场景 3: PUT 更新 reason 字段 → DB 持久化，updated_at 变更
 * 场景 4: PUT 把 status 改为 superseded → 从 active 列表消失
 * 场景 5: teardown afterAll 清理测试数据（不污染 active 决策表）
 *
 * 运行环境：CI e2e-smoke job（含真实 PostgreSQL 服务）
 * 测试数据前缀：[TEST-decisions-lifecycle] 确保不与真实业务数据混淆
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

// ─── 真实 DB 连接池（用于直查 DB 验证持久化）────────────────────────────────

const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });

// 记录本次测试插入的决策 ID，afterAll 统一清理
const insertedDecisionIds = [];

// ─── Express App 工厂（只挂载 strategic-decisions 路由）─────────────────────

async function makeApp() {
  const app = express();
  app.use(express.json());
  const strategicDecisionsRouter = await import('../../routes/strategic-decisions.js').then(m => m.default);
  app.use('/api/brain/strategic-decisions', strategicDecisionsRouter);
  return app;
}

// ─── 测试套件 ────────────────────────────────────────────────────────────────

describe('[TEST-decisions-lifecycle] Strategic Decisions API 完整链路（真实 PostgreSQL）', () => {
  let app;
  let createdDecisionId;

  beforeAll(async () => {
    app = await makeApp();
  }, 20000);

  afterAll(async () => {
    // 清理：将所有测试创建的决策改为 superseded（软删除语义，保留审计）
    if (insertedDecisionIds.length > 0) {
      await testPool.query(
        `UPDATE decisions SET status = 'superseded', updated_at = NOW()
         WHERE id = ANY($1) AND topic LIKE '[TEST-decisions-lifecycle]%'`,
        [insertedDecisionIds]
      );
    }
    await testPool.end();
  });

  // ── 场景 1: 创建决策 → status=active + DB 持久化 ─────────────────────────

  it('场景1: POST 创建决策 — 返回 id + status=active，DB 直查持久化', async () => {
    const res = await request(app)
      .post('/api/brain/strategic-decisions')
      .send({
        topic: '[TEST-decisions-lifecycle] 测试框架选型',
        decision: '使用 vitest 作为 Brain 测试框架',
        reason: '初始 rationale — 与 vite 生态一致，CI 速度快',
        category: 'testing',
        status: 'active',
        priority: 'P2',
        made_by: 'user',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.status).toBe('active');
    expect(res.body.data.topic).toContain('[TEST-decisions-lifecycle]');

    createdDecisionId = res.body.data.id;
    insertedDecisionIds.push(createdDecisionId);

    // 直查 DB 验证持久化
    const dbRes = await testPool.query(
      'SELECT id, status, topic, reason FROM decisions WHERE id = $1',
      [createdDecisionId]
    );
    expect(dbRes.rows).toHaveLength(1);
    expect(dbRes.rows[0].status).toBe('active');
    expect(dbRes.rows[0].topic).toContain('[TEST-decisions-lifecycle]');
  });

  // ── 场景 2: GET ?status=active 列表包含刚创建的决策 ──────────────────────

  it('场景2: GET ?status=active 列表 — 刚创建的决策出现在结果中', async () => {
    expect(createdDecisionId).toBeDefined();

    const res = await request(app)
      .get('/api/brain/strategic-decisions?status=active&limit=200')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    const found = res.body.data.find(d => d.id === createdDecisionId);
    expect(found).toBeDefined();
    expect(found.status).toBe('active');
    expect(found.topic).toContain('[TEST-decisions-lifecycle]');
  });

  // ── 场景 3: PUT 更新 reason 字段 → DB 持久化验证 ─────────────────────────

  it('场景3: PUT 更新 reason — DB 中 reason 字段变更且 updated_at 刷新', async () => {
    expect(createdDecisionId).toBeDefined();

    // 记录更新前的 updated_at
    const beforeRes = await testPool.query(
      'SELECT reason, updated_at FROM decisions WHERE id = $1',
      [createdDecisionId]
    );
    const updatedAtBefore = beforeRes.rows[0].updated_at;
    const oldReason = beforeRes.rows[0].reason;

    const newReason = '更新后的 rationale — 覆盖率提升 30%，运行时间缩短 2x';

    const res = await request(app)
      .put(`/api/brain/strategic-decisions/${createdDecisionId}`)
      .send({ reason: newReason })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(createdDecisionId);
    expect(res.body.data.reason).toBe(newReason);

    // DB 直查验证 reason 已持久化
    const dbRes = await testPool.query(
      'SELECT reason, updated_at FROM decisions WHERE id = $1',
      [createdDecisionId]
    );
    expect(dbRes.rows[0].reason).toBe(newReason);
    expect(dbRes.rows[0].reason).not.toBe(oldReason);
    // updated_at 应被 NOW() 刷新
    expect(new Date(dbRes.rows[0].updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(updatedAtBefore).getTime()
    );
  });

  // ── 场景 4: PUT status=superseded → active 列表中消失 ────────────────────

  it('场景4: PUT status=superseded — 从 GET ?status=active 列表消失', async () => {
    expect(createdDecisionId).toBeDefined();

    const res = await request(app)
      .put(`/api/brain/strategic-decisions/${createdDecisionId}`)
      .send({ status: 'superseded' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('superseded');

    // DB 直查验证状态已更改
    const dbRes = await testPool.query(
      'SELECT status FROM decisions WHERE id = $1',
      [createdDecisionId]
    );
    expect(dbRes.rows[0].status).toBe('superseded');

    // GET active 列表不再包含该决策
    const listRes = await request(app)
      .get('/api/brain/strategic-decisions?status=active&limit=200')
      .expect(200);

    const found = listRes.body.data.find(d => d.id === createdDecisionId);
    expect(found).toBeUndefined();
  });

  // ── 场景 5: 创建缺少必填字段 → 400 错误 ─────────────────────────────────

  it('场景5: POST 缺少 decision 必填字段 — 返回 400', async () => {
    const res = await request(app)
      .post('/api/brain/strategic-decisions')
      .send({
        topic: '[TEST-decisions-lifecycle] 缺少 decision 字段测试',
        category: 'testing',
      })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body).toHaveProperty('error');
  });

  // ── 场景 6: PUT 不存在的 ID → 404 ────────────────────────────────────────

  it('场景6: PUT 不存在的 ID — 返回 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';

    const res = await request(app)
      .put(`/api/brain/strategic-decisions/${fakeId}`)
      .send({ reason: '这条决策不存在' })
      .expect(404);

    expect(res.body.success).toBe(false);
  });
});
