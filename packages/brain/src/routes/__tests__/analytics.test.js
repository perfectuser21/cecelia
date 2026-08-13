import { describe, it, expect } from 'vitest';
import analyticsRouter from '../analytics.js';

// 配套 analytics.js 的路由注册断言（本 sprint 新增 F1 认证读回端点）。
// 端点判定逻辑的行为覆盖见 ../../map/__tests__/f1-certification.test.js（纯逻辑）
// 与 ../../__tests__/integration/f1-capability-certification.integration.test.js（真 PG）。

function registeredGetPaths(router) {
  return router.stack
    .filter((layer) => layer.route && layer.route.methods && layer.route.methods.get)
    .map((layer) => layer.route.path);
}

describe('analytics router — capabilities certification 路由注册', () => {
  it('导出的是可挂载的 express Router', () => {
    expect(typeof analyticsRouter).toBe('function');
    expect(Array.isArray(analyticsRouter.stack)).toBe(true);
  });

  it('注册了 GET /capabilities/:capability/certification（F1 认证读回）', () => {
    const paths = registeredGetPaths(analyticsRouter);
    expect(paths).toContain('/capabilities/:capability/certification');
  });

  it('保留既有 GET /capabilities 列表路由（不回退现有能力路由族）', () => {
    const paths = registeredGetPaths(analyticsRouter);
    expect(paths).toContain('/capabilities');
  });
});
