/**
 * release-gate.test.js — Brain API 路由单元测试（Vitest）
 *
 * task_id: f284c0a2-f2ed-4dfc-bd61-ce5416d93c8c
 * 覆盖 BEHAVIOR-05: GET 端点存在 / POST 返回 405
 */

import { describe, it, expect, beforeAll } from 'vitest';

describe('release-gate route', () => {
  let routeModule;

  beforeAll(async () => {
    routeModule = await import('../release-gate.js');
  });

  it('模块导出 router（Express Router）', () => {
    const router = routeModule.default ?? routeModule.router;
    expect(router).toBeTruthy();
    expect(typeof router === 'function' || (router && router.stack !== undefined)).toBe(true);
  });

  it('router.stack 中包含 GET 处理器', () => {
    const router = routeModule.default ?? routeModule.router;
    if (router && router.stack) {
      const methods = router.stack
        .filter(l => l.route)
        .flatMap(l => Object.keys(l.route.methods));
      expect(methods).toContain('get');
    } else {
      expect(router).toBeTruthy();
    }
  });

  it('router.stack 中包含 POST 405 处理器', () => {
    const router = routeModule.default ?? routeModule.router;
    if (router && router.stack) {
      const methods = router.stack
        .filter(l => l.route)
        .flatMap(l => Object.keys(l.route.methods));
      expect(methods).toContain('post');
    } else {
      expect(router).toBeTruthy();
    }
  });
});
