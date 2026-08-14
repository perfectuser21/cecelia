/**
 * eval.test.js — 路由层单元测试（skill-eval 上传 + 状态查询 + 回调端点）
 * Sprint: 07072314-skill-eval-service
 *
 * 范围：routes/eval.js 路由层，mock 掉 validator 和 DB。
 * 与 packages/brain/src/__tests__/eval.test.js（合同测试）互补——
 * 合同测试覆盖 validator 行为，本文件覆盖路由中间件、鉴权、响应格式。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ─── Mock 所有外部依赖（hoisted，在 vi.mock 前运行）────────────────────────

const { mockPool, mockValidateZipBuffer, mockComputeZipHash, mockCheckZipDuplication,
  mockCheckSlotAvailable, mockGetEvalQueuePosition, mockFsPromises, mockRandomUUID, mockCreateTask } = vi.hoisted(() => {
  const mockPool = { query: vi.fn() };
  const mockValidateZipBuffer = vi.fn().mockResolvedValue({ valid: true, entries: ['SKILL.md'] });
  const mockComputeZipHash = vi.fn().mockReturnValue('abc123def456');
  const mockCheckZipDuplication = vi.fn().mockResolvedValue({ isDuplicate: false });
  const mockCheckSlotAvailable = vi.fn().mockResolvedValue({ queueFull: false, pendingCount: 0 });
  const mockGetEvalQueuePosition = vi.fn().mockResolvedValue(1);
  const mockFsPromises = {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('fake zip bytes')),
  };
  const mockRandomUUID = vi.fn().mockReturnValue('test-uuid-1234');
  const mockCreateTask = vi.fn().mockResolvedValue({ task: { id: 'test-uuid-1234' } });
  return {
    mockPool, mockValidateZipBuffer, mockComputeZipHash, mockCheckZipDuplication,
    mockCheckSlotAvailable, mockGetEvalQueuePosition, mockFsPromises, mockRandomUUID, mockCreateTask,
  };
});

vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../actions.js', () => ({ createTask: mockCreateTask }));
vi.mock('../../skill-eval-validator.js', () => ({
  validateZipBuffer: mockValidateZipBuffer,
  computeZipHash: mockComputeZipHash,
  checkZipDuplication: mockCheckZipDuplication,
  checkSlotAvailable: mockCheckSlotAvailable,
  getEvalQueuePosition: mockGetEvalQueuePosition,
}));
vi.mock('fs', () => ({
  default: { promises: mockFsPromises },
  promises: mockFsPromises,
}));
vi.mock('crypto', async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, randomUUID: mockRandomUUID };
});

// ─── 导入被测路由 ────────────────────────────────────────────────────────────
import evalRouter from '../eval.js';

// ─── 构建测试 Express app ────────────────────────────────────────────────────

function buildApp(env = {}) {
  const app = express();
  app.use(express.json());
  // 设置环境变量
  Object.entries(env).forEach(([k, v]) => { process.env[k] = v; });
  app.use('/api/skill-eval', evalRouter);
  return app;
}

// ─── 工具函数：构造合法 zip Buffer（PK\x03\x04 魔数）────────────────────────

function fakeZipBuffer() {
  const buf = Buffer.alloc(100);
  buf[0] = 0x50; buf[1] = 0x4b; buf[2] = 0x03; buf[3] = 0x04;
  return buf;
}

// ─── 测试套件 ────────────────────────────────────────────────────────────────

describe('routes/eval.js — POST /api/skill-eval/upload', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    // 重置为默认成功路径
    mockValidateZipBuffer.mockResolvedValue({ valid: true, entries: ['SKILL.md'] });
    mockComputeZipHash.mockReturnValue('abc123def456');
    mockCheckZipDuplication.mockResolvedValue({ isDuplicate: false });
    mockCheckSlotAvailable.mockResolvedValue({ queueFull: false, pendingCount: 0 });
    mockRandomUUID.mockReturnValue('test-uuid-1234');
    mockCreateTask.mockResolvedValue({ task: { id: 'test-uuid-1234' } });
    mockPool.query.mockResolvedValue({ rows: [] });
    mockFsPromises.mkdir.mockResolvedValue(undefined);
    mockFsPromises.writeFile.mockResolvedValue(undefined);

    // 未配置 token → dev mode（降级通过）
    delete process.env.EVAL_PROXY_TOKEN;
    app = buildApp();
  });

  it('成功上传返回 task_id 和 queue_position', async () => {
    const res = await request(app)
      .post('/api/skill-eval/upload')
      .attach('file', fakeZipBuffer(), { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'my-skill');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      task_id: 'test-uuid-1234',
      queue_position: expect.any(Number),
    });
  });

  it('缺少 skill_name → 400', async () => {
    const res = await request(app)
      .post('/api/skill-eval/upload')
      .attach('file', fakeZipBuffer(), { filename: 'skill.zip', contentType: 'application/zip' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/skill_name/);
  });

  it('无文件上传 → 400', async () => {
    const res = await request(app)
      .post('/api/skill-eval/upload')
      .field('skill_name', 'test-skill');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no file/i);
  });

  it('zip 校验失败 → 422', async () => {
    mockValidateZipBuffer.mockResolvedValue({ valid: false, error: 'invalid zip magic bytes' });

    const res = await request(app)
      .post('/api/skill-eval/upload')
      .attach('file', fakeZipBuffer(), { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'bad-skill');

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/invalid zip/);
  });

  it('队列已满 → 429', async () => {
    mockCheckSlotAvailable.mockResolvedValue({ queueFull: true, pendingCount: 20 });

    const res = await request(app)
      .post('/api/skill-eval/upload')
      .attach('file', fakeZipBuffer(), { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'overflow-skill');

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/queue full/i);
  });

  it('hash 重复且已 completed → 返回历史 report_url', async () => {
    mockCheckZipDuplication.mockResolvedValue({
      isDuplicate: true,
      status: 'completed',
      task_id: 'dup-task-id',
      report_url: 'https://example.com/report.html',
    });

    const res = await request(app)
      .post('/api/skill-eval/upload')
      .attach('file', fakeZipBuffer(), { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'dup-skill');

    expect(res.status).toBe(200);
    expect(res.body.deduped).toBe(true);
    expect(res.body.report_url).toBe('https://example.com/report.html');
  });

  it('配置了 EVAL_PROXY_TOKEN 但请求未携带 token → 403', async () => {
    process.env.EVAL_PROXY_TOKEN = 'secret-token';

    const res = await request(app)
      .post('/api/skill-eval/upload')
      .attach('file', fakeZipBuffer(), { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'test-skill');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/forbidden/);
  });

  it('携带正确 token → 鉴权通过（成功上传）', async () => {
    process.env.EVAL_PROXY_TOKEN = 'correct-token';

    const res = await request(app)
      .post('/api/skill-eval/upload')
      .set('x-eval-proxy-token', 'correct-token')
      .attach('file', fakeZipBuffer(), { filename: 'skill.zip', contentType: 'application/zip' })
      .field('skill_name', 'auth-skill');

    expect(res.status).toBe(200);
    expect(res.body.task_id).toBeDefined();
  });
});

describe('routes/eval.js — GET /api/skill-eval/status/:task_id', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.EVAL_PROXY_TOKEN;
    app = buildApp();
  });

  it('pending 状态返回 queue_position', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        task_id: 'task-abc',
        status: 'pending',
        report_url: null,
        failure_reason: null,
        queue_position: 2,
        created_at: new Date(),
        updated_at: new Date(),
      }],
    });
    mockGetEvalQueuePosition.mockResolvedValue(2);

    const res = await request(app).get('/api/skill-eval/status/task-abc');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(res.body.queue_position).toBe(2);
  });

  it('completed 状态返回 report_url', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        task_id: 'task-done',
        status: 'completed',
        report_url: 'https://example.com/r.html',
        failure_reason: null,
        queue_position: null,
        created_at: new Date(),
        updated_at: new Date(),
      }],
    });

    const res = await request(app).get('/api/skill-eval/status/task-done');

    expect(res.status).toBe(200);
    expect(res.body.report_url).toBe('https://example.com/r.html');
    expect(res.body.queue_position).toBeNull();
  });

  it('task_id 不存在 → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/skill-eval/status/no-such-task');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/);
  });

  it('DB 错误 → 500', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('db connection lost'));

    const res = await request(app).get('/api/skill-eval/status/error-task');

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/internal server error/);
  });
});

describe('routes/eval.js — GET /api/skill-eval/staging/:task_id（worker 拉取 zip 内容）', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFsPromises.readFile.mockResolvedValue(Buffer.from('fake zip bytes'));
    delete process.env.EVAL_PROXY_TOKEN;
    app = buildApp();
  });

  it('找到任务且 staging 文件存在 → 200 返回 zip 字节流', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ staging_path: '/tmp/skill-eval-staging/abc.zip' }],
    });

    const res = await request(app)
      .get('/api/skill-eval/staging/task-abc')
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/zip/);
    expect(Buffer.from(res.body).toString()).toBe('fake zip bytes');
    expect(mockFsPromises.readFile).toHaveBeenCalledWith('/tmp/skill-eval-staging/abc.zip');
  });

  it('task_id 不存在 → 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/skill-eval/staging/no-such-task');

    expect(res.status).toBe(404);
  });

  it('staging_path 记录存在但文件已不在磁盘 → 404', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ staging_path: '/tmp/skill-eval-staging/gone.zip' }],
    });
    mockFsPromises.readFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const res = await request(app).get('/api/skill-eval/staging/task-gone');

    expect(res.status).toBe(404);
  });

  it('配置了 EVAL_PROXY_TOKEN 但请求未携带 token → 403', async () => {
    process.env.EVAL_PROXY_TOKEN = 'secret-token';
    app = buildApp();

    const res = await request(app).get('/api/skill-eval/staging/task-abc');

    expect(res.status).toBe(403);
  });

  it('携带正确 token → 通过鉴权继续处理', async () => {
    process.env.EVAL_PROXY_TOKEN = 'correct-token';
    app = buildApp();
    mockPool.query.mockResolvedValueOnce({
      rows: [{ staging_path: '/tmp/skill-eval-staging/abc.zip' }],
    });

    const res = await request(app)
      .get('/api/skill-eval/staging/task-abc')
      .set('X-Eval-Proxy-Token', 'correct-token');

    expect(res.status).toBe(200);
  });
});

describe('routes/eval.js — POST /api/skill-eval/complete', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.EVAL_PROXY_TOKEN;
    app = buildApp();
    mockPool.query.mockResolvedValue({ rows: [] });
  });

  it('有效 task_id + report_url → 200 ok', async () => {
    const res = await request(app)
      .post('/api/skill-eval/complete')
      .send({ task_id: 'task-123', report_url: 'https://example.com/r.html' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.task_id).toBe('task-123');
  });

  it('缺少 task_id → 400', async () => {
    const res = await request(app)
      .post('/api/skill-eval/complete')
      .send({ report_url: 'https://example.com/r.html' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/task_id/);
  });

  it('缺少 report_url → 400', async () => {
    const res = await request(app)
      .post('/api/skill-eval/complete')
      .send({ task_id: 'task-123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/report_url/);
  });
});
