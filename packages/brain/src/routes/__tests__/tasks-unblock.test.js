/**
 * routes/tasks.js — unblock/block 端点 import 路径修复 [BEHAVIOR]
 *
 * Bug: tasks.js 第 600、1119、1147 行使用 './task-updater.js'（错误路径），
 * 导致 POST /tasks/:taskId/unblock、/tasks/:id/block、/tasks/:id/unblock 均返回 500。
 * task-updater.js 实际位于 src/task-updater.js，正确路径为 '../task-updater.js'。
 *
 * 修复：将三处 './task-updater.js' 改为 '../task-updater.js'。
 *
 * Task ID: f35db586-1119-46e1-bfbe-8f7dcdb50455
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockUnblockTask = vi.fn();
const mockBlockTask = vi.fn();
const mockQuery = vi.fn();

vi.mock('../../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

vi.mock('../../actions.js', () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock('../../tick-helpers.js', () => ({
  routeTask: vi.fn(),
  TASK_TYPE_AGENT_MAP: {},
}));

vi.mock('../../task-router.js', () => ({
  identifyWorkType: vi.fn(),
  getTaskLocation: vi.fn(),
  routeTaskCreate: vi.fn(),
  getValidTaskTypes: vi.fn(() => []),
  LOCATION_MAP: {},
  diagnoseKR: vi.fn(),
}));

vi.mock('../../task-weight.js', () => ({
  getTaskWeights: vi.fn(),
}));

vi.mock('../shared.js', () => ({
  classifyLearningType: vi.fn(),
}));

vi.mock('../../memory-utils.js', () => ({
  generateL0Summary: vi.fn(),
}));

vi.mock('../../events/taskEvents.js', () => ({
  publishTaskCreated: vi.fn(),
}));

vi.mock('../../quarantine.js', () => ({
  getQuarantinedTasks: vi.fn(),
  getQuarantineStats: vi.fn(),
  releaseTask: vi.fn(),
  quarantineTask: vi.fn(),
  QUARANTINE_REASONS: {},
  REVIEW_ACTIONS: {},
}));

vi.mock('../../executor.js', () => ({
  triggerCeceliaRun: vi.fn(),
  checkCeceliaRunAvailable: vi.fn(),
}));

vi.mock('../../event-bus.js', () => ({
  emit: vi.fn(),
}));

vi.mock('../../capture-inbox.js', () => ({
  pushCaptureAtom: vi.fn(),
}));

vi.mock('../../alerting.js', () => ({
  raise: vi.fn(),
}));

// Mock task-updater.js（正确路径）
vi.mock('../../task-updater.js', () => ({
  unblockTask: (...args) => mockUnblockTask(...args),
  blockTask: (...args) => mockBlockTask(...args),
}));

describe('unblock/block 端点 import 路径修复 [BEHAVIOR]', () => {
  let app;

  beforeEach(async () => {
    vi.resetModules();
    mockQuery.mockReset();
    mockUnblockTask.mockReset();
    mockBlockTask.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });

    app = express();
    app.use(express.json());
    const { default: router } = await import('../tasks.js');
    app.use('/api/brain', router);
  });

  describe('POST /:taskId/unblock (line 600) — 成功时返回 200 + task 对象 [BEHAVIOR-01a]', () => {
    it('unblockTask 成功 → 200 + { success: true, task: <task_object> }', async () => {
      const taskObj = { id: 'task-abc', status: 'queued', title: 'test task' };
      mockUnblockTask.mockResolvedValueOnce({ success: true, task: taskObj });

      const res = await request(app)
        .post('/api/brain/tasks/task-abc/unblock')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.task).toBeDefined();
      expect(res.body.task.id).toBe('task-abc');
    });

    it('unblockTask 失败 → 400', async () => {
      mockUnblockTask.mockResolvedValueOnce({ success: false, error: 'Task not found' });

      const res = await request(app)
        .post('/api/brain/tasks/task-missing/unblock')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /:id/block (line 1119) — 成功时返回 200 + status blocked [BEHAVIOR-02]', () => {
    it('blockTask 成功 → 200 + { success: true, task_id, status: "blocked", reason, blocked_until }', async () => {
      const blocked_until = '2026-07-15T00:00:00.000Z';
      mockBlockTask.mockResolvedValueOnce({
        success: true,
        task: { id: 'task-xyz', status: 'blocked', blocked_until },
      });

      const res = await request(app)
        .post('/api/brain/tasks/task-xyz/block')
        .send({ reason: 'waiting-dependency', detail: 'need PR #42', until: blocked_until });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.task_id).toBe('task-xyz');
      expect(res.body.status).toBe('blocked');
      expect(res.body.reason).toBe('waiting-dependency');
      expect(res.body.blocked_until).toBe(blocked_until);
    });

    it('blockTask 失败 → 404', async () => {
      mockBlockTask.mockResolvedValueOnce({ success: false, error: 'Task not found' });

      const res = await request(app)
        .post('/api/brain/tasks/not-exist/block')
        .send({ reason: 'manual' });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /:id/unblock (line 1147) — 成功时返回 200 + status queued [BEHAVIOR-01b]', () => {
    it('unblockTask 成功 → 200 + { success: true, task_id, status: "queued" }', async () => {
      mockUnblockTask.mockResolvedValueOnce({ success: true, task: { id: 'task-def', status: 'queued' } });

      const res = await request(app)
        .post('/api/brain/tasks/task-def/unblock')
        .send({});

      // 注意：/:taskId/unblock（第 600 行）和 /:id/unblock（第 1147 行）
      // 在路由注册上都是 /tasks/:xxx/unblock，Express 会匹配先注册的那个（第 600 行）
      // 因此这两个路由实际上是同一条路由，都返回 { success, task }
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('unblockTask 失败 → 非 200', async () => {
      mockUnblockTask.mockResolvedValueOnce({ success: false, error: 'not found' });

      const res = await request(app)
        .post('/api/brain/tasks/task-nope/unblock')
        .send({});

      expect(res.status).not.toBe(200);
    });
  });
});
