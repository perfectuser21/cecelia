import { describe, expect, it } from 'vitest';
import { internalServiceHeaders } from '../internal-service-auth.js';

describe('internalServiceHeaders', () => {
  it('配置内部 token 时写入规范 Bearer header 并保留原 headers', () => {
    expect(internalServiceHeaders(
      { 'Content-Type': 'application/json' },
      { CECELIA_INTERNAL_TOKEN: '  trusted-token  ' },
    )).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer trusted-token',
    });
  });

  it('token 缺失时不伪造 Authorization header', () => {
    expect(internalServiceHeaders(
      { Accept: 'application/json' },
      { CECELIA_INTERNAL_TOKEN: '   ' },
    )).toEqual({ Accept: 'application/json' });
  });
});
