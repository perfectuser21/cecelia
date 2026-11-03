import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server.js';
import { createMcpPgFixture } from '../helpers/mcp-pg-fixture.js';

let fixture;
beforeAll(async () => { fixture = await createMcpPgFixture(); });
afterAll(async () => { await fixture?.close(); });
const makeApp = () => createApp({ databasePool: fixture.readonlyPool, bearerToken: 'test-token' });
const call = (app, method, params = {}, id = 1) => request(app).post('/mcp')
  .set('Authorization', 'Bearer test-token').set('Accept', 'application/json, text/event-stream')
  .send({ jsonrpc: '2.0', id, method, params });
function rpc(res) {
  expect(res.status, res.text).toBe(200);
  const data = res.text.split('\n').find(line => line.startsWith('data: '));
  expect(data, '真实MCP响应必须包含SSE数据帧').toBeDefined();
  const result = JSON.parse(data.slice(6));
  expect(result.error).toBeUndefined();
  expect(result.result.isError).not.toBe(true);
  return result.result;
}
const payload = res => JSON.parse(rpc(res).content[0].text);

describe('合法MCP请求经过真实只读PG，不能条件skip', () => {
  it('get_schema_version走完整MCP调用，返回真实schema版本号', async () => {
    const res = await call(makeApp(), 'tools/call', { name: 'get_schema_version', arguments: {} });
    expect(payload(res)).toEqual({ current_version: 405 });
  });

  it('连续6次调用全部成功，四类查询返回当前代真实数据', async () => {
    const app = makeApp();
    rpc(await call(app, 'tools/list'));
    for (const type of ['value_stream', 'capability', 'crosscut']) {
      const result = payload(await call(app, 'tools/call', { name: 'get_map_nodes', arguments: { node_type: type } }));
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({ run_id: fixture.activeRun, node_type: type });
    }
    const edges = payload(await call(app, 'tools/call', { name: 'get_map_edges', arguments: { edge_type: 'contains' } }));
    expect(edges.rows).toHaveLength(1);
    expect(edges.rows[0]).toMatchObject({ run_id: fixture.activeRun, edge_type: 'contains' });
    rpc(await call(app, 'tools/list'));
  });

  it('4个tools调用并发全部获得合法MCP响应与真实查询结果', async () => {
    const app = makeApp();
    const results = await Promise.all(['value_stream', 'capability', 'crosscut'].map((type, index) =>
      call(app, 'tools/call', { name: 'get_map_nodes', arguments: { node_type: type } }, index + 1))
      .concat(call(app, 'tools/list', {}, 4)));
    for (const res of results.slice(0, 3)) {
      const result = payload(res);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].run_id).toBe(fixture.activeRun);
    }
    rpc(results[3]);
  });

  it('同一个app连续25次MCP请求全部200，无限流或共享transport退化', async () => {
    const app = makeApp();
    for (let id = 1; id <= 25; id++) rpc(await call(app, 'tools/list', {}, id));
  });
});
