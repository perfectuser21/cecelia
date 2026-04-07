/**
 * Brain Endpoint Contract Tests
 *
 * skip-if-offline: tests use mock db pool, no real Brain service needed
 *
 * 验证 Brain 关键 API 端点的请求/响应格式契约。
 * 使用 mock DB pool（supertest + express），不依赖真实 PostgreSQL 或 Brain 服务。
 * 可在 CI ubuntu-latest 无需外部服务的情况下通过。
 *
 * 覆盖以下端点：
 *   GET  /api/brain/tasks          — 任务列表（session-start.sh 依赖）
 *   GET  /api/brain/tasks/:id      — 单任务查询
 *   POST /api/brain/tasks          — 创建任务
 *   PATCH /api/brain/tasks/:id     — 更新任务状态
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Mock DB Pool ──────────────────────────────────────────────────────────

vi.mock('../../db.js', () => ({
  default: { query: vi.fn() },
}));

// Mock domain-detector and quarantine for task-tasks.js dependencies
vi.mock('../../domain-detector.js', () => ({
  detectDomain: vi.fn(() => ({ domain: 'agent_ops' })),
}));

vi.mock('../../quarantine.js', () => ({
  classifyFailure: vi.fn(() => 'unknown'),
  FAILURE_CLASS: {
    NETWORK: 'network',
    RATE_LIMIT: 'rate_limit',
    BILLING_CAP: 'billing_cap',
    AUTH: 'auth',
    RESOURCE: 'resource',
  },
}));

vi.mock('../../task-updater.js', () => ({
  blockTask: vi.fn(),
}));

import pool from '../../db.js';
import taskRouter from '../../routes/task-tasks.js';

// ─── Test App Factory ──────────────────────────────────────────────────────

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/tasks', taskRouter);
  return app;
}

// ─── Test Data ─────────────────────────────────────────────────────────────

const SAMPLE_TASK = {
  id: 'task-contract-001',
  title: 'CI L3 集成测试门禁',
  description: '验证 Brain↔Engine↔API 跨模块测试',
  status: 'in_progress',
  task_type: 'dev',
  priority: 'P2',
  location: 'us',
  trigger_source: 'api',
  domain: 'agent_ops',
  created_at: '2026-03-28T00:00:00Z',
  updated_at: '2026-03-28T00:00:00Z',
  queued_at: '2026-03-28T00:00:00Z',
};

// ─── Test Suite ────────────────────────────────────────────────────────────

describe('Brain Endpoint Contracts — Integration (mock DB)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── GET /api/brain/tasks — 任务列表（session-start 依赖）─────────────────

  describe('GET /api/brain/tasks — 任务列表契约', () => {
    it('返回任务数组，每个任务包含必需字段', async () => {
      pool.query.mockResolvedValueOnce({ rows: [SAMPLE_TASK] });

      const res = await request(makeApp())
        .get('/api/brain/tasks')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0]).toMatchObject({
        id: expect.any(String),
        title: expect.any(String),
        status: expect.any(String),
      });
    });

    it('支持 status=in_progress 过滤（session-start 查进行中任务）', async () => {
      pool.query.mockResolvedValueOnce({ rows: [SAMPLE_TASK] });

      const res = await request(makeApp())
        .get('/api/brain/tasks?status=in_progress&limit=5')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      // 验证 DB 查询包含 status 过滤
      const dbCall = pool.query.mock.calls[0];
      expect(dbCall[0]).toContain('status');
    });

    it('支持 status=queued&task_type=dev 过滤（session-start 查开发队列）', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(makeApp())
        .get('/api/brain/tasks?status=queued&task_type=dev&limit=3')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('Brain DB 异常时返回 500（不静默失败）', async () => {
      pool.query.mockRejectedValueOnce(new Error('DB connection error'));

      const res = await request(makeApp())
        .get('/api/brain/tasks')
        .expect(500);

      expect(res.body).toHaveProperty('error');
    });
  });

  // ─── GET /api/brain/tasks/:id — 单任务查询 ───────────────────────────────

  describe('GET /api/brain/tasks/:id — 单任务契约', () => {
    it('返回单个任务对象，包含 id / title / status / task_type', async () => {
      pool.query.mockResolvedValueOnce({ rows: [SAMPLE_TASK] });

      const res = await request(makeApp())
        .get('/api/brain/tasks/task-contract-001')
        .expect(200);

      expect(res.body).toMatchObject({
        id: expect.any(String),
        title: expect.any(String),
        status: expect.any(String),
        task_type: expect.any(String),
      });
    });

    it('任务不存在时返回 404', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(makeApp())
        .get('/api/brain/tasks/nonexistent-id')
        .expect(404);
    });
  });

  // ─── POST /api/brain/tasks — 创建任务 ────────────────────────────────────

  describe('POST /api/brain/tasks — 创建任务契约', () => {
    it('成功创建任务，返回 201 和包含 id 的任务对象', async () => {
      const newTask = { id: 'task-new-001', ...SAMPLE_TASK, status: 'queued' };
      pool.query.mockResolvedValueOnce({ rows: [newTask] });

      const res = await request(makeApp())
        .post('/api/brain/tasks')
        .send({
          title: 'CI L3 集成测试门禁',
          description: '验证 Brain↔Engine↔API',
          task_type: 'dev',
          trigger_source: 'api',
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('title');
      expect(res.body).toHaveProperty('status');
    });

    it('缺少 title 时返回 400 — 必填字段校验', async () => {
      await request(makeApp())
        .post('/api/brain/tasks')
        .send({ task_type: 'dev' }) // 缺 title
        .expect(400);
    });

    it('空 title 时返回 400', async () => {
      await request(makeApp())
        .post('/api/brain/tasks')
        .send({ title: '  ', task_type: 'dev' }) // 空白 title
        .expect(400);
    });
  });

  // ─── PATCH /api/brain/tasks/:id — 更新任务 ───────────────────────────────

  describe('PATCH /api/brain/tasks/:id — 更新任务契约', () => {
    it('更新 status 成功返回更新后的任务', async () => {
      const updated = { ...SAMPLE_TASK, status: 'completed' };
      // PATCH handler 先 SELECT 当前状态（状态机保护），再 UPDATE
      pool.query.mockResolvedValueOnce({ rows: [{ status: 'queued' }] }); // SELECT current status
      pool.query.mockResolvedValueOnce({ rows: [updated] }); // UPDATE ... RETURNING *

      const res = await request(makeApp())
        .patch('/api/brain/tasks/task-contract-001')
        .send({ status: 'completed' })
        .expect(200);

      expect(res.body.status).toBe('completed');
    });

    it('任务不存在时返回 404', async () => {
      // 状态机保护的 SELECT 返回空行 → 直接 404
      pool.query.mockResolvedValueOnce({ rows: [] });

      await request(makeApp())
        .patch('/api/brain/tasks/nonexistent-id')
        .send({ status: 'completed' })
        .expect(404);
    });
  });
});
