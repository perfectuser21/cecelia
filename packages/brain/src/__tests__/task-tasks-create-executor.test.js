/**
 * POST /api/brain/tasks — B1 executor/mode 白名单回归测试（T6 88e0b448 终审补测）
 *
 * 背景：路由条令（07-08）规定 Claude=有头/Codex=无头都可派，B1 校验段
 * 曾对 executor=claude + mode=headed 返回 400，解锁后缺 route 层测试兜底。
 * 本文件锁死四个组合：
 *   claude+headed 合法 / codex+headed 合法 / claude+headless 合法 / mode 非白名单值仍 400。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const queryMock = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...a) => queryMock(...a) } }));

vi.mock('../domain-detector.js', () => ({
  detectDomain: () => ({ domain: 'growth' }),
}));

vi.mock('../task-updater.js', () => ({
  blockTask: vi.fn(),
}));

vi.mock('../quarantine.js', () => ({
  classifyFailure: vi.fn(),
  FAILURE_CLASS: { NETWORK: 'network', RATE_LIMIT: 'rate_limit', BILLING_CAP: 'billing_cap', AUTH: 'auth', RESOURCE: 'resource' },
}));

const { default: taskTasksRouter } = await import('../routes/task-tasks.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/tasks', taskTasksRouter);
  return app;
}

beforeEach(() => {
  queryMock.mockReset();
  // 创建链路默认 mock：dedup SELECT 返回空（无重复），INSERT 返回新任务行
  queryMock.mockImplementation(async (sql) => {
    if (/INSERT INTO tasks/.test(sql)) {
      return { rows: [{ id: 'task-new', title: 't', status: 'queued', task_type: 'harness_initiative', priority: 'P2', payload: {}, created_at: '2026-07-10T00:00:00Z' }] };
    }
    if (/INSERT INTO work_routing_receipts/.test(sql)) return { rows: [{ id: 'receipt-new' }] };
    return { rows: [] };
  });
});

describe('POST /api/brain/tasks — B1 executor/mode 白名单', () => {
  it('executor=claude + mode=headed → 不再 400（有头 claude 已解锁）', async () => {
    const res = await request(makeApp())
      .post('/api/brain/tasks')
      .send({ title: '有头dev任务', repo_hint: 'perfectuser21/cecelia', payload: { executor: 'claude', mode: 'headed' } });
    expect(res.status).toBe(201);
    expect(res.body.error).toBeUndefined();
  });

  it('executor=codex + mode=headed → 由 Router 统一进入 Kernel Harness', async () => {
    const res = await request(makeApp())
      .post('/api/brain/tasks')
      .send({ title: 'codex任务', repo_hint: 'perfectuser21/cecelia', payload: { executor: 'codex', mode: 'headed' } });
    expect(res.status).toBe(201);
    expect(res.body.task_type).toBe('harness_initiative');
  });

  it('executor=claude + mode=headless → 合法', async () => {
    const res = await request(makeApp())
      .post('/api/brain/tasks')
      .send({ title: '无头claude任务', repo_hint: 'perfectuser21/cecelia', payload: { executor: 'claude', mode: 'headless' } });
    expect(res.status).toBe(201);
  });

  it('mode=xxx 非白名单值 → 仍 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/tasks')
      .send({ title: '非法mode任务', payload: { executor: 'claude', mode: 'xxx' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mode must be headless or headed/);
  });

  it('executor 非 claude/codex → 仍 400（白名单不回归）', async () => {
    const res = await request(makeApp())
      .post('/api/brain/tasks')
      .send({ title: '非法executor任务', payload: { executor: 'gpt' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/executor must be claude or codex/);
  });
});
