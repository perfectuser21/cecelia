import { describe, it, expect, vi } from 'vitest';
import { bearerAuth } from '../src/auth.js';

function mockReqRes(authHeader) {
  const req = { headers: { authorization: authHeader } };
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('bearerAuth', () => {
  const middleware = bearerAuth('correct-token-value');

  it('合法 token 放行', () => {
    const { req, res, next } = mockReqRes('Bearer correct-token-value');
    middleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('缺失 token 返回 401', () => {
    const { req, res, next } = mockReqRes(undefined);
    middleware(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });

  it('错误 token 返回 401', () => {
    const { req, res, next } = mockReqRes('Bearer wrong-token');
    middleware(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('畸形 header（无 Bearer 前缀）返回 401', () => {
    const { req, res, next } = mockReqRes('correct-token-value');
    middleware(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('空字符串 token 返回 401', () => {
    const { req, res, next } = mockReqRes('Bearer ');
    middleware(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

// fail-closed 回归测试：expectedToken 未配置（服务器端 MCP_BEARER_TOKEN 环境变量
// 没接线）时，之前的实现会在 safeCompare() 内部对 undefined 调用 Buffer.from()
// 抛出未捕获 TypeError（500 崩溃），而不是明确的 401 拒绝。这里覆盖 undefined 和
// 空字符串两种"未配置"取值，且都用一个看起来合法的 Bearer header 触发（最容易
// 命中崩溃分支的场景——如果没有 token 直接短路 401，根本走不到 safeCompare）。
describe('bearerAuth fail-closed（expectedToken 未配置）', () => {
  it('expectedToken 为 undefined 时，带 token 的请求返回 401 而不是抛异常', () => {
    const middleware = bearerAuth(undefined);
    const { req, res, next } = mockReqRes('Bearer some-token');
    expect(() => middleware(req, res, next)).not.toThrow();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });

  it("expectedToken 为空字符串 '' 时，带 token 的请求返回 401 而不是抛异常", () => {
    const middleware = bearerAuth('');
    const { req, res, next } = mockReqRes('Bearer some-token');
    expect(() => middleware(req, res, next)).not.toThrow();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });
});
