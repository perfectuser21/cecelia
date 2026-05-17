/**
 * routes/harness-callback.test.js — LangGraph 修正 Sprint Stream 1
 *
 * 单元测试 callback router：
 *   POST /api/brain/harness/callback/:containerId
 *   - 200 + 调用 graph resume（成功路径）
 *   - 404 当 containerId 无对应 thread
 *   - 500 当 graph resume 抛错
 *   - 400 当 body 缺 result 字段
 *
 * 通过 vi.mock 隔离 db pool / lookup / langgraph，避免起真服务。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock @langchain/langgraph 的 Command 构造函数（验证调用即可）
vi.mock('@langchain/langgraph', () => ({
  Command: vi.fn().mockImplementation((args) => ({ __command: true, args })),
}));

// Mock harness-thread-lookup（默认返回 null，individual test 可重写）
vi.mock('../../lib/harness-thread-lookup.js', () => ({
  lookupHarnessThread: vi.fn(),
}));

// Mock db.js（router 内 fallback 时可能引用）
vi.mock('../../db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
}));

describe('routes/harness-callback (LangGraph Stream 1)', () => {
  let app;
  let lookupHarnessThread;

  beforeEach(async () => {
    vi.clearAllMocks();
    const lookupMod = await import('../../lib/harness-thread-lookup.js');
    lookupHarnessThread = lookupMod.lookupHarnessThread;

    const routerMod = await import('../harness-callback.js');
    app = express();
    app.use(express.json());
    app.use('/api/brain', routerMod.default);
  });

  it('POST /:containerId 200 + 调用 graph resume（成功路径）', async () => {
    const invokeMock = vi.fn().mockResolvedValue({ ok: true });
    lookupHarnessThread.mockResolvedValueOnce({
      compiledGraph: { invoke: invokeMock },
      threadId: 'harness-initiative:abc123:1',
    });

    const res = await request(app)
      .post('/api/brain/harness/callback/container-xyz')
      .send({ result: 'completed', exit_code: 0, stdout: 'done' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(lookupHarnessThread).toHaveBeenCalledWith('container-xyz');
    expect(invokeMock).toHaveBeenCalledTimes(1);
    // 验证传给 invoke 的第一个参数是 Command 实例（携带 resume payload）
    const [cmdArg, configArg] = invokeMock.mock.calls[0];
    expect(cmdArg.__command).toBe(true);
    expect(cmdArg.args.resume).toMatchObject({
      result: 'completed',
      exit_code: 0,
      stdout: 'done',
    });
    expect(configArg.configurable.thread_id).toBe('harness-initiative:abc123:1');
  });

  it('containerId 找不到 thread → 404', async () => {
    lookupHarnessThread.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/brain/harness/callback/unknown-container')
      .send({ result: 'completed', exit_code: 0 });

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('graph resume 抛错 → 500', async () => {
    const invokeMock = vi.fn().mockRejectedValueOnce(new Error('graph kaboom'));
    lookupHarnessThread.mockResolvedValueOnce({
      compiledGraph: { invoke: invokeMock },
      threadId: 'thread-broken',
    });

    const res = await request(app)
      .post('/api/brain/harness/callback/container-bad')
      .send({ result: 'completed', exit_code: 0 });

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('graph kaboom');
  });

  it('body 缺 result 字段 → 400', async () => {
    const res = await request(app)
      .post('/api/brain/harness/callback/anything')
      .send({ exit_code: 0 });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/result/i);
  });

  it('exports default Router', async () => {
    const mod = await import('../harness-callback.js');
    expect(typeof mod.default).toBe('function');
    const stack = mod.default.stack || [];
    const paths = stack.map((l) => l.route?.path).filter(Boolean);
    expect(paths.some((p) => p.includes(':containerId'))).toBe(true);
  });
});
