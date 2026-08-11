import { afterEach, describe, expect, it, vi } from 'vitest';
import { internalAuthOrLoopback } from './internal-auth.js';

function response() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

afterEach(() => {
  delete process.env.CECELIA_INTERNAL_TOKEN;
  delete process.env.NODE_ENV;
});

describe('internalAuthOrLoopback', () => {
  it('token 未配置时只允许同机 loopback 调用', () => {
    const next = vi.fn();
    const localRes = response();
    internalAuthOrLoopback({ headers: {}, socket: { remoteAddress: '::ffff:127.0.0.1' } }, localRes, next);
    expect(next).toHaveBeenCalledOnce();

    const remoteRes = response();
    internalAuthOrLoopback({ headers: {}, socket: { remoteAddress: '100.64.0.8' } }, remoteRes, vi.fn());
    expect(remoteRes.status).toHaveBeenCalledWith(503);
  });

  it('token 配置后 loopback 也必须携带凭据，防止前端代理穿透', () => {
    process.env.CECELIA_INTERNAL_TOKEN = 'secret';
    const denied = response();
    internalAuthOrLoopback({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }, denied, vi.fn());
    expect(denied.status).toHaveBeenCalledWith(401);
  });

  it('production 即使漏配 token 也拒绝 loopback，防止代理穿透', () => {
    process.env.NODE_ENV = 'production';
    const denied = response();
    internalAuthOrLoopback({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }, denied, vi.fn());
    expect(denied.status).toHaveBeenCalledWith(503);
  });

  it('token 配置后远端调用必须携带正确凭据', () => {
    process.env.CECELIA_INTERNAL_TOKEN = 'secret';
    const denied = response();
    internalAuthOrLoopback({ headers: {}, socket: { remoteAddress: '192.168.97.1' } }, denied, vi.fn());
    expect(denied.status).toHaveBeenCalledWith(401);

    const next = vi.fn();
    internalAuthOrLoopback({
      headers: { authorization: 'Bearer secret' }, socket: { remoteAddress: '192.168.97.1' },
    }, response(), next);
    expect(next).toHaveBeenCalledOnce();
  });
});
