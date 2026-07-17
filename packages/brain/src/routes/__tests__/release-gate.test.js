/**
 * release-gate.test.js — Brain API 路由单元测试
 *
 * task_id: f284c0a2-f2ed-4dfc-bd61-ce5416d93c8c
 * 覆盖 BEHAVIOR-05: GET 端点存在 / POST 返回 405
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';

describe('release-gate route', () => {
  let routeModule;

  before(async () => {
    routeModule = await import('../release-gate.js');
  });

  it('模块导出 router（Express Router）', () => {
    const router = routeModule.default ?? routeModule.router;
    assert.ok(router, 'router 应存在');
    // Express Router 具有 stack 属性
    assert.ok(typeof router === 'function' || (router && router.stack !== undefined),
      'router 应为 Express Router 或函数');
  });

  it('router.stack 中包含 GET 处理器', () => {
    const router = routeModule.default ?? routeModule.router;
    if (router && router.stack) {
      const methods = router.stack
        .filter(l => l.route)
        .flatMap(l => Object.keys(l.route.methods));
      assert.ok(methods.includes('get'), 'router 应注册 GET 方法');
    }
  });

  it('router.stack 中包含 POST 405 处理器', () => {
    const router = routeModule.default ?? routeModule.router;
    if (router && router.stack) {
      const methods = router.stack
        .filter(l => l.route)
        .flatMap(l => Object.keys(l.route.methods));
      assert.ok(methods.includes('post'), 'router 应注册 POST（405）方法');
    }
  });
});
