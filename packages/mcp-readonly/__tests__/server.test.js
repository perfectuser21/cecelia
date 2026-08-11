// packages/mcp-readonly/__tests__/server.test.js
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server.js';

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
