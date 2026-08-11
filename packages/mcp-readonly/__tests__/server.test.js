// packages/mcp-readonly/__tests__/server.test.js
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp, makeTrackedQuery } from '../server.js';
import { AlertTracker } from '../src/alerting.js';

describe('POST /mcp 鉴权', () => {
  it('无 token 调用 /mcp 返回 401', async () => {
    const app = createApp({ skipDbInit: true, bearerToken: 'test-token' });
    const res = await request(app).post('/mcp').send({});
    expect(res.status).toBe(401);
  });

  it('错误 token 返回 401', async () => {
    const app = createApp({ skipDbInit: true, bearerToken: 'test-token' });
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer wrong')
      .send({});
    expect(res.status).toBe(401);
  });
});

// makeTrackedQuery 此前完全没有单测覆盖（code-review 发现的 Important 问题）。
// 核心行为要保证两点：①失败/成功如实转发给 AlertTracker；②DB 故障时 Bark
// 告警是 fire-and-forget——不能因为 sendBark 内部卡住（真实场景是 8s 网络
// 超时）就拖慢 trackedQuery 本该立刻 reject 的失败传播，这正是 DB 已经不可用、
// 调用方最需要快速拿到失败结果去做降级处理的时刻。
describe('makeTrackedQuery（DB 故障告警埋点）', () => {
  it('查询成功时透传结果并调用 recordDbSuccess', async () => {
    const tracker = { recordDbSuccess: vi.fn(), recordDbFailure: vi.fn() };
    const rawQuery = vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] });
    const trackedQuery = makeTrackedQuery(rawQuery, tracker);

    const result = await trackedQuery({}, 'SELECT 1', []);

    expect(result).toEqual({ rows: [{ ok: 1 }] });
    expect(tracker.recordDbSuccess).toHaveBeenCalledOnce();
    expect(tracker.recordDbFailure).not.toHaveBeenCalled();
  });

  it('查询失败时原样 throw，并调用 recordDbFailure', async () => {
    const tracker = { recordDbSuccess: vi.fn(), recordDbFailure: vi.fn().mockResolvedValue(undefined) };
    const rawQuery = vi.fn().mockRejectedValue(new Error('db down'));
    const trackedQuery = makeTrackedQuery(rawQuery, tracker);

    await expect(trackedQuery({}, 'SELECT 1', [])).rejects.toThrow('db down');
    expect(tracker.recordDbFailure).toHaveBeenCalledOnce();
    expect(tracker.recordDbSuccess).not.toHaveBeenCalled();
  });

  it('DB持续故障、Bark发送卡住不返回时，trackedQuery仍立即reject（fire-and-forget，不等sendBark）', async () => {
    let releaseBark;
    const barkPending = new Promise((resolve) => {
      releaseBark = resolve;
    });
    const sendBark = vi.fn(() => barkPending);
    const tracker = new AlertTracker({ sendBark });
    const rawQuery = vi.fn().mockRejectedValue(new Error('db down'));
    const trackedQuery = makeTrackedQuery(rawQuery, tracker);

    // 先打两次，还没到 recordDbFailure 的阈值（3次），不会碰 sendBark
    await expect(trackedQuery({}, 'SELECT 1', [])).rejects.toThrow('db down');
    await expect(trackedQuery({}, 'SELECT 1', [])).rejects.toThrow('db down');

    const start = Date.now();
    // 第3次达到阈值，AlertTracker 内部会调用 sendBark——它返回的 Promise 被
    // 卡住永远不 resolve。如果 trackedQuery 内部是 `await tracker.recordDbFailure()`
    // 才 throw，这一句会一路等到 sendBark resolve（本测试里等于挂到 vitest
    // 默认超时才失败）；只有真正 fire-and-forget，reject 才会在几毫秒内发生。
    await expect(trackedQuery({}, 'SELECT 1', [])).rejects.toThrow('db down');
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(sendBark).toHaveBeenCalledOnce();

    releaseBark(); // 清理，避免遗留 pending promise
  });
});

// StreamableHTTPServerTransport（sessionIdGenerator: undefined，无状态模式）响应体
// 是 text/event-stream 格式（"event: message\ndata: {...}\n\n"），不是裸 JSON——
// 从 supertest 的 res.text 里把 JSON-RPC payload 挑出来。
function parseSseJsonRpc(text) {
  const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
  if (!dataLine) {
    throw new Error(`响应体里没找到 SSE data 行：${text}`);
  }
  return JSON.parse(dataLine.slice('data: '.length));
}

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

// 之前只测过鉴权失败路径（401），6 个工具"真的能被调用成功"此前只靠人工读代码验证过。
// 这里用合法 token 走一次完整 MCP JSON-RPC 调用（tools/call），证明工具真的挂到位、
// 能查到真实数据返回，不只是"路由存在"。跟 db.test.js 用一样的 TEST_DATABASE_URL
// 约定：本地/CI 没设这个环境变量时自动跳过，不阻塞无库环境。
describe.skipIf(!TEST_DB_URL)('POST /mcp 合法 token 完整工具调用（真实DB）', () => {
  it('get_schema_version 走完整 MCP 调用，返回真实 schema 版本号', async () => {
    const prevUrl = process.env.MCP_READONLY_DATABASE_URL;
    process.env.MCP_READONLY_DATABASE_URL = TEST_DB_URL;
    let app;
    try {
      app = createApp({ bearerToken: 'test-token' });
    } finally {
      process.env.MCP_READONLY_DATABASE_URL = prevUrl;
    }

    const res = await request(app)
      .post('/mcp')
      .set('Authorization', 'Bearer test-token')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_schema_version', arguments: {} },
      });

    expect(res.status).toBe(200);
    const rpc = parseSseJsonRpc(res.text);
    expect(rpc.result.isError).not.toBe(true);
    const payload = JSON.parse(rpc.result.content[0].text);
    expect(payload).toHaveProperty('current_version');
    expect(typeof payload.current_version).toBe('number');
  });
});

describe('GET/DELETE /mcp 协议方法覆盖（bug: 之前只注册了POST，MCP客户端握手用到的GET/DELETE直接404）', () => {
  it('鉴权通过后 GET /mcp 返回 405（不是404），且是合法的JSON-RPC错误信封', async () => {
    const app = createApp({ skipDbInit: true, bearerToken: 'test-token' });
    const res = await request(app).get('/mcp').set('Authorization', 'Bearer test-token');
    expect(res.status).toBe(405);
    const body = JSON.parse(res.text);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.error).toBeDefined();
  });

  it('鉴权通过后 DELETE /mcp 返回 405（不是404），且是合法的JSON-RPC错误信封', async () => {
    const app = createApp({ skipDbInit: true, bearerToken: 'test-token' });
    const res = await request(app).delete('/mcp').set('Authorization', 'Bearer test-token');
    expect(res.status).toBe(405);
    const body = JSON.parse(res.text);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.error).toBeDefined();
  });

  it('无 token 的 GET /mcp 仍然先被鉴权中间件拦截，返回401而不是405', async () => {
    const app = createApp({ skipDbInit: true, bearerToken: 'test-token' });
    const res = await request(app).get('/mcp');
    expect(res.status).toBe(401);
  });
});
