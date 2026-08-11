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
