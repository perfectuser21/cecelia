import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';

const boundary = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn(), construct: vi.fn() }));
// 覆盖真实 factory 的动态 import('pg') 默认分支；不向 matchDecisions 注入数组或 pool。
// 这里只验证接口和 SDK 委托语义，不把 record-only 查询当作真实 PG 故障或持久化效果。
vi.mock('pg', () => ({
  Pool: class OwnedPool {
    constructor() {
      boundary.construct();
      this.query = boundary.query;
      this.end = boundary.end;
    }
  },
}));
import createDecisionsMatchRouter from './decisions.js';

beforeEach(() => {
  boundary.construct.mockReset();
  boundary.query.mockReset();
  boundary.end.mockReset().mockResolvedValue(undefined);
});

async function postMatch(body) {
  const app = express();
  app.use(express.json());
  app.post('/api/brain/decisions/match', createDecisionsMatchRouter());
  const server = await new Promise(resolve => {
    const owned = app.listen(0, '127.0.0.1', () => resolve(owned));
  });
  try {
    return await new Promise((resolve, reject) => {
      const text = JSON.stringify(body);
      const request = http.request({
        host: '127.0.0.1', port: server.address().port,
        path: '/api/brain/decisions/match', method: 'POST', agent: false,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) },
      }, response => {
        let result = '';
        response.on('data', chunk => { result += chunk; });
        response.on('end', () => {
          try { resolve({ status: response.statusCode, body: JSON.parse(result) }); }
          catch (error) { reject(error); }
        });
      });
      request.on('error', reject);
      request.setTimeout(2000, () => request.destroy(new Error('owned HTTP 超时')));
      request.end(text);
    });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

const INPUT = { prd: 'owned request', topics: ['database architecture'] };
const DEGRADED = { matched: [], missing: [{ topic: 'database architecture', classification: 'critical' }] };

describe('decisions/match 实际默认连接路径', () => {
  it('缺少输入返回 400，绝不构造数据库连接', async () => {
    expect(await postMatch({})).toEqual({ status: 400, body: { error: 'prd or query field required' } });
    expect(boundary.construct).not.toHaveBeenCalled();
    expect(boundary.query).not.toHaveBeenCalled();
    expect(boundary.end).not.toHaveBeenCalled();
  });

  it('默认 Pool 查询拒绝后保留 HTTP 200 降级封套和缺失主题，而非抛出 500', async () => {
    boundary.query.mockRejectedValue(Object.assign(new Error('owned query unavailable'), { code: '42P01' }));
    expect(await postMatch(INPUT)).toEqual({ status: 200, body: DEGRADED });
    expect(boundary.construct).toHaveBeenCalledTimes(1);
    expect(boundary.query).toHaveBeenCalledTimes(1);
    expect(boundary.query).toHaveBeenCalledWith("SELECT id, topic, decision FROM decisions WHERE status = 'active' LIMIT 500");
  });

  it('默认 Pool 构造拒绝同样降级，不误称有匹配，也不执行查询', async () => {
    boundary.construct.mockImplementation(() => { throw new Error('owned constructor unavailable'); });
    expect(await postMatch(INPUT)).toEqual({ status: 200, body: DEGRADED });
    expect(boundary.construct).toHaveBeenCalledTimes(1);
    expect(boundary.query).not.toHaveBeenCalled();
    expect(boundary.end).not.toHaveBeenCalled();
  });

  it('默认查询成功时匹配决策并委托关闭临时 Pool', async () => {
    boundary.query.mockResolvedValue({ rows: [{
      id: 'owned-decision-id', topic: 'database architecture', decision: 'owned approved decision',
    }] });
    expect(await postMatch(INPUT)).toEqual({ status: 200, body: {
      matched: [{ topic: 'database architecture', decision: 'owned approved decision',
        decision_topic: 'database architecture', confidence: 1, source_id: 'owned-decision-id' }],
      missing: [],
    } });
    expect(boundary.construct).toHaveBeenCalledTimes(1);
    expect(boundary.query).toHaveBeenCalledTimes(1);
    expect(boundary.end).toHaveBeenCalledTimes(1);
    expect(boundary.query.mock.invocationCallOrder[0]).toBeLessThan(boundary.end.mock.invocationCallOrder[0]);
  });
});
