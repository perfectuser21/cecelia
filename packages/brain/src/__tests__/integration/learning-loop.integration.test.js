/**
 * Integration Test: 知识留存 Learning Loop
 *
 * 验证核心行为：
 *   1. design-doc（日志/学习记录）持久化与检索
 *   2. strategic-decision 创建 → decisions/match 语义检索
 *
 * 链路：
 *   POST /api/brain/design-docs → 创建 diary 条目
 *   GET  /api/brain/design-docs/:id → 内容持久化验证
 *   GET  /api/brain/design-docs?type=diary → 列表过滤验证
 *   POST /api/brain/strategic-decisions → 创建决策
 *   POST /api/brain/decisions/match → 关键词匹配召回
 *
 * 路由：
 *   packages/brain/src/routes/design-docs.js
 *   packages/brain/src/routes/strategic-decisions.js
 *   packages/brain/src/routes/decisions.js（factory → matchDecisions 直调）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { matchDecisions } from '../../routes/decisions.js';

const { Pool } = pg;
const pool = new Pool({ ...DB_DEFAULTS, max: 3 });

let app;
const docIds = [];
const decisionIds = [];

beforeAll(async () => {
  const [docsMod, decisionsMod] = await Promise.all([
    import('../../routes/design-docs.js'),
    import('../../routes/strategic-decisions.js'),
  ]);
  app = express();
  app.use(express.json());
  app.use('/api/brain/design-docs', docsMod.default);
  app.use('/api/brain/strategic-decisions', decisionsMod.default);
});

afterAll(async () => {
  if (docIds.length) {
    await pool.query('DELETE FROM design_docs WHERE id = ANY($1::bigint[])', [docIds]);
  }
  if (decisionIds.length) {
    await pool.query('DELETE FROM decisions WHERE id = ANY($1::bigint[])', [decisionIds]);
  }
  await pool.end();
});

// ─── design-doc 持久化 ────────────────────────────────────────────────────────

describe('Learning Loop: design-doc 日志持久化', () => {
  let docId;
  const testContent = `[l3-test] 学到：集成测试必须在真实 DB 环境下运行，${Date.now()}`;

  it('POST design-docs → 201 + id', async () => {
    const res = await request(app)
      .post('/api/brain/design-docs')
      .send({
        type: 'diary',
        title: `[l3-test] learning-loop diary ${Date.now()}`,
        content: testContent,
        status: 'draft',
        author: 'test-agent',
      })
      .expect(201);

    expect(res.body.data).toBeDefined();
    expect(res.body.data.id).toBeDefined();
    docId = res.body.data.id;
    docIds.push(docId);
  });

  it('GET design-docs/:id → 内容与创建一致', async () => {
    const res = await request(app)
      .get(`/api/brain/design-docs/${docId}`)
      .expect(200);

    expect(res.body.data.id).toBe(docId);
    expect(res.body.data.content).toBe(testContent);
    expect(res.body.data.type).toBe('diary');
  });

  it('GET design-docs?type=diary → 列表包含刚创建的条目', async () => {
    const res = await request(app)
      .get('/api/brain/design-docs?type=diary&limit=50')
      .expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.find((d) => d.id === docId);
    expect(found).toBeDefined();
    expect(found.type).toBe('diary');
  });
});

// ─── strategic-decision 创建 + decisions/match 召回 ──────────────────────────

describe('Learning Loop: decision 创建 + 语义匹配召回', () => {
  const uniqueKeyword = `l3test-deployment-${Date.now()}`;
  let decisionId;

  it('POST strategic-decisions → 创建决策', async () => {
    const res = await request(app)
      .post('/api/brain/strategic-decisions')
      .send({
        topic: uniqueKeyword,
        decision: `始终使用蓝绿发布（${uniqueKeyword}）`,
        reason: 'integration test — learning loop verification',
        status: 'active',
        category: 'deployment',
        priority: 'P2',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.topic).toBe(uniqueKeyword);
    decisionId = res.body.data.id;
    decisionIds.push(decisionId);
  });

  it('decisions/match — 包含关键词的 PRD 能召回该决策', async () => {
    // 直接调用 matchDecisions，注入 pool 避免 decisions.js 内部另起连接
    const prd = `## 部署策略\n本 PRD 涉及 ${uniqueKeyword} 相关的发布流程设计。`;
    const result = await matchDecisions(prd, [uniqueKeyword], pool);

    expect(result.matched).toBeDefined();
    expect(Array.isArray(result.matched)).toBe(true);
    const hit = result.matched.find((m) => m.source_id === decisionId || m.decision_topic === uniqueKeyword);
    expect(hit).toBeDefined();
    expect(hit.decision).toContain(uniqueKeyword);
  });

  it('GET strategic-decisions → 列表包含该决策', async () => {
    const res = await request(app)
      .get('/api/brain/strategic-decisions?status=active&limit=100')
      .expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
    const found = res.body.data.find((d) => d.id === decisionId);
    expect(found).toBeDefined();
    expect(found.topic).toBe(uniqueKeyword);
  });
});

// ─── 参数校验 ─────────────────────────────────────────────────────────────────

describe('Learning Loop: 参数校验', () => {
  it('POST design-docs 缺 type → 400 或错误响应', async () => {
    const res = await request(app)
      .post('/api/brain/design-docs')
      .send({ title: 'no-type' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('POST strategic-decisions 缺 topic → 400', async () => {
    const res = await request(app)
      .post('/api/brain/strategic-decisions')
      .send({ decision: 'no topic provided' })
      .expect(400);
    expect(res.body.success).toBe(false);
  });
});
