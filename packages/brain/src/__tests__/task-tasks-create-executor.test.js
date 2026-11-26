/**
 * POST /api/brain/tasks — 现役开发路由与 executor/mode 入口校验。
 * 普通用户开发交 codex_dev Agent；headed_manual 明确登记当前有头 dev 会话。
 * mode 仅是执行偏好，不恢复已退役的 Claude 桥接或旧 Kernel 开发编排。
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

const routeFields = {
  task_type: 'dev',
  change_kind: 'bugfix',
  mutation_intent: 'write',
  repo_hint: 'perfectuser21/cecelia',
  map_scope_hint: ['F1'],
  branch: 'cp-executor-contract',
  base_sha: 'a'.repeat(40),
};

beforeEach(() => {
  queryMock.mockReset();
  // 创建链路默认 mock：dedup SELECT 返回空（无重复），INSERT 返回新任务行
  queryMock.mockImplementation(async (sql, values) => {
    if (/WITH authoritative_scope AS/.test(sql)) {
      return { rows: [{ node_key: 'F1' }] };
    }
    if (/INSERT INTO tasks/.test(sql)) {
      return { rows: [{
        id: 'task-new', title: values[0], priority: values[2], task_type: values[3],
        status: values[4], payload: JSON.parse(values[9]), created_at: '2026-07-10T00:00:00Z',
      }] };
    }
    if (/INSERT INTO work_routing_receipts/.test(sql)) return { rows: [{ id: 'receipt-new' }] };
    if (/FROM map_scope_repositories/.test(sql)) {
      return { rows: [{ scope_key: 'cecelia', repo: 'cecelia', adapter_config: { aliases: ['perfectuser21/cecelia'] } }] };
    }
    return { rows: [] };
  });
});

function expectDevelopmentRoute(res, { taskType, mode, pipeline, orchestrator }) {
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(res.body.task_type).toBe(taskType);
  expect(res.body.payload).toMatchObject({ executor: 'codex', mode, orchestrator });
  expect(res.body.payload).not.toHaveProperty('harness_runtime');
  expect(res.body.payload).not.toHaveProperty('harness_mode');
  const inserted = queryMock.mock.calls.find(([sql]) => /INSERT INTO tasks/.test(sql));
  expect(inserted[1][3]).toBe(taskType);
  const receipt = queryMock.mock.calls.find(([sql]) => /INSERT INTO work_routing_receipts/.test(sql));
  expect(receipt[1][5]).toBe(pipeline);
  expect(receipt[1][6]).toBe(taskType);
  expect(receipt[1][12]).toBe(orchestrator);
}

describe('POST /api/brain/tasks — B1 executor/mode 白名单', () => {
  it('外部工作单护照可统一挂号且不进入编码写流程', async () => {
    const res = await request(makeApp()).post('/api/brain/tasks').send({
      title: 'ZJ外部工作单', task_type: 'content-pipeline', domain: 'content', mutation_intent: 'none',
      payload: { owner_repo: 'zenithjoy-workspace', external_job_id: 'zj-job-1' },
    });
    expect(res.status).toBe(201);
    const inserted = queryMock.mock.calls.find(([sql]) => /INSERT INTO tasks/.test(sql));
    expect(inserted[1][3]).toBe('content-pipeline');
    const payload = JSON.parse(inserted[1][9]);
    expect(payload.work_kind).toBe('operations');
    expect(payload.external_job_id).toBe('zj-job-1');
  });

  it('外部护照不能绕过编码write/unknown的change_kind必填保护', async () => {
    for (const mutation_intent of ['write', 'unknown']) {
      queryMock.mockClear();
      const res = await request(makeApp()).post('/api/brain/tasks').send({
        title: '明确代码写入', task_type: 'content-pipeline', mutation_intent,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('change_kind_required');
      expect(queryMock).not.toHaveBeenCalled();
    }
  });

  it('退役业务类型在任何路由和数据库副作用之前拒绝建单', async () => {
    for (const task_type of ['content_publish', 'platform_scraper']) {
      queryMock.mockClear();
      const res = await request(makeApp()).post('/api/brain/tasks').send({
        title: '历史业务请求', ...routeFields, task_type, payload: { headed_manual: 'true' },
      });
      expect(res.status).toBe(410);
      expect(res.body.error).toBe('task_type_retired');
      expect(queryMock).not.toHaveBeenCalled();
    }
  });

  it('有头用户会话显式登记 headed_manual，落 dev 账本并保留 headed 模式', async () => {
    const res = await request(makeApp())
      .post('/api/brain/tasks')
      .send({ title: '有头dev任务', ...routeFields, payload: { executor: 'codex', mode: 'headed', headed_manual: true } });
    expectDevelopmentRoute(res, { taskType: 'dev', mode: 'headed', pipeline: 'headed_development', orchestrator: 'headed-session' });
    expect(res.body.payload.headed_manual).toBe('true');
  });

  it('executor=codex + mode=headed 偏好仍由 Router 归入现役 Codex Agent', async () => {
    const res = await request(makeApp())
      .post('/api/brain/tasks')
      .send({ title: 'codex任务', ...routeFields, payload: { executor: 'codex', mode: 'headed' } });
    expectDevelopmentRoute(res, { taskType: 'codex_dev', mode: 'headed', pipeline: 'agent_development', orchestrator: 'codex-bridge' });
    expect(res.body.payload).not.toHaveProperty('headed_manual');
  });

  it('无头用户开发进入现役 codex_dev Agent，保留 headless 模式', async () => {
    const res = await request(makeApp())
      .post('/api/brain/tasks')
      .send({ title: '无头codex任务', ...routeFields, payload: { executor: 'codex', mode: 'headless' } });
    expectDevelopmentRoute(res, { taskType: 'codex_dev', mode: 'headless', pipeline: 'agent_development', orchestrator: 'codex-bridge' });
    expect(res.body.payload).not.toHaveProperty('headed_manual');
  });

  it.each(['headed', 'headless'])('退役 Claude 桥接请求 mode=%s 在落任务前拒绝', async mode => {
    const res = await request(makeApp()).post('/api/brain/tasks').send({
      title: '退役Claude请求', ...routeFields, payload: { executor: 'claude', mode },
    });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ reason_code: 'no_executor_for_task_type', route: 'claude-retired', task_type: 'codex_dev' });
    expect(queryMock.mock.calls.some(([sql]) => /INSERT INTO tasks|INSERT INTO work_routing_receipts/.test(sql))).toBe(false);
    expect(queryMock.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
  });

  it('mode=xxx 非白名单值 → 仍 400', async () => {
    const res = await request(makeApp())
      .post('/api/brain/tasks')
      .send({ title: '非法mode任务', ...routeFields, payload: { executor: 'codex', mode: 'xxx' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mode must be headless or headed/);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('executor 非 claude/codex → 仍 400（白名单不回归）', async () => {
    const res = await request(makeApp())
      .post('/api/brain/tasks')
      .send({ title: '非法executor任务', ...routeFields, payload: { executor: 'gpt' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/executor must be claude or codex/);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
