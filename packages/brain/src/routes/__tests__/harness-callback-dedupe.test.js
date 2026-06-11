/**
 * routes/harness-callback-dedupe.test.js
 *
 * 复现并回归 P0 编排层 bug：GAN proposer 节点被并发 spawn 5 个容器。
 *
 * 根因：runner(entrypoint.sh) 对 harness 回调用 `curl -m 10` + 5 次重试；本路由同步
 * `await compiledGraph.invoke(resume)`，而 GAN proposer 是阻塞节点(B44)会 hold 请求数分钟，
 * 10s 内无响应 → curl 超时重试 → 每次重试在【同一 thread_id】发起一次新的并发 resume →
 * 每次都跑 proposer 节点 spawn 一个相同 env 的容器（现场 5 个，间隔 20-30s，第 5 次后停止）。
 *
 * 修复：每个 containerId 的回调最多 resume 一次。重复回调（curl 重试）直接 200 ack，不再 invoke。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('@langchain/langgraph', () => ({
  Command: vi.fn().mockImplementation((args) => ({ __command: true, args })),
}));

vi.mock('../../lib/harness-thread-lookup.js', () => ({
  lookupHarnessThread: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
}));

describe('routes/harness-callback 幂等去重（P0 并发重入修复）', () => {
  let app;
  let lookupHarnessThread;
  let resetDedupe;

  beforeEach(async () => {
    vi.clearAllMocks();
    const lookupMod = await import('../../lib/harness-thread-lookup.js');
    lookupHarnessThread = lookupMod.lookupHarnessThread;

    const routerMod = await import('../harness-callback.js');
    resetDedupe = routerMod._resetCallbackDedupeForTests;
    resetDedupe();

    app = express();
    app.use(express.json());
    app.use('/api/brain', routerMod.default);
  });

  it('同一 containerId 的回调重试两次 → 只 resume 一次（去重），第二次返回 deduped', async () => {
    const invokeMock = vi.fn().mockResolvedValue({ ok: true });
    lookupHarnessThread.mockResolvedValue({
      compiledGraph: { invoke: invokeMock },
      threadId: 'harness-initiative:ed860936:1',
    });

    const body = { result: 'completed', exit_code: 0, stdout: 'planner done' };
    const cid = 'harness-planner-ed860936-f7d999d1';

    const res1 = await request(app).post(`/api/brain/harness/callback/${cid}`).send(body);
    const res2 = await request(app).post(`/api/brain/harness/callback/${cid}`).send(body);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res2.body.deduped).toBe(true);
    // 核心断言：同一 containerId 重试只触发一次 graph resume（= 一次 proposer spawn）
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('同一 containerId 5 次重试（现场场景）→ 只 resume 一次', async () => {
    const invokeMock = vi.fn().mockResolvedValue({ ok: true });
    lookupHarnessThread.mockResolvedValue({
      compiledGraph: { invoke: invokeMock },
      threadId: 'harness-initiative:ed860936:1',
    });
    const cid = 'harness-planner-ed860936-f7d999d1';
    const body = { result: 'completed', exit_code: 0 };

    for (let i = 0; i < 5; i++) {
      await request(app).post(`/api/brain/harness/callback/${cid}`).send(body);
    }
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('并发到达的同 containerId 回调 → 只 resume 一次（check-and-set 原子）', async () => {
    const invokeMock = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 40))
    );
    lookupHarnessThread.mockResolvedValue({
      compiledGraph: { invoke: invokeMock },
      threadId: 'harness-initiative:ed860936:1',
    });
    const cid = 'harness-planner-ed860936-concurrent';
    const body = { result: 'completed', exit_code: 0 };

    await Promise.all([
      request(app).post(`/api/brain/harness/callback/${cid}`).send(body),
      request(app).post(`/api/brain/harness/callback/${cid}`).send(body),
      request(app).post(`/api/brain/harness/callback/${cid}`).send(body),
    ]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it('不同 containerId 不互相去重（各自 resume）', async () => {
    const invokeMock = vi.fn().mockResolvedValue({ ok: true });
    lookupHarnessThread.mockResolvedValue({
      compiledGraph: { invoke: invokeMock },
      threadId: 'harness-initiative:ed860936:1',
    });
    const body = { result: 'completed', exit_code: 0 };

    await request(app).post('/api/brain/harness/callback/container-A').send(body);
    await request(app).post('/api/brain/harness/callback/container-B').send(body);

    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('lookup 返回 null（404）时释放 claim，后续回调可重试（不被误去重）', async () => {
    const invokeMock = vi.fn().mockResolvedValue({ ok: true });
    // 第一次 lookup null（404 + 释放 claim），第二次找到 thread 正常 resume
    lookupHarnessThread
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ compiledGraph: { invoke: invokeMock }, threadId: 't:1' });
    const cid = 'harness-planner-transient';
    const body = { result: 'completed', exit_code: 0 };

    const res1 = await request(app).post(`/api/brain/harness/callback/${cid}`).send(body);
    const res2 = await request(app).post(`/api/brain/harness/callback/${cid}`).send(body);

    expect(res1.status).toBe(404);
    expect(res2.status).toBe(200);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
