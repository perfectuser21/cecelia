import { describe, expect, it } from 'vitest';

import captureAtomsRouter from '../capture-atoms.js';
import evalRouter from '../eval.js';

function hasRouterMiddleware(router) {
  return router.stack.some(layer => !layer.route && typeof layer.handle === 'function');
}

describe('database and filesystem route rate limits', () => {
  it('capture atoms 在所有数据库端点前安装 router 级限流', () => {
    expect(hasRouterMiddleware(captureAtomsRouter)).toBe(true);
  });

  it('skill eval 在上传、文件与数据库端点前安装 router 级限流', () => {
    expect(hasRouterMiddleware(evalRouter)).toBe(true);
  });
});
