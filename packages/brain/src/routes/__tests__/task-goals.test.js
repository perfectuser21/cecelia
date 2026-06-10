/**
 * routes/task-goals.js 单元测试
 *
 * 配套 PR 2b-1（task-goals.js 的 KR 进度查询 oi.status='completed' 改 'done'）。
 * 测真实 express router 结构（无 DB、无 mock）：路由注册是该模块的对外契约。
 */

import { describe, it, expect } from 'vitest';
import router from '../task-goals.js';

/** 收集 router 注册的路由 path（去重）。 */
function routePaths(r) {
  return r.stack.filter(l => l.route).map(l => l.route.path);
}

describe('routes/task-goals — router 结构', () => {
  it('默认导出是可挂载的 express router（函数 + stack）', () => {
    expect(typeof router).toBe('function');
    expect(Array.isArray(router.stack)).toBe(true);
  });

  it('注册了 KR 列表 /、审计 /audit 与单条 /:id 路由', () => {
    const paths = routePaths(router);
    expect(paths).toContain('/');
    expect(paths).toContain('/audit');
    expect(paths).toContain('/:id');
  });

  it('/:id 同时支持 GET 与 PATCH（读取 + 状态更新）', () => {
    const idLayers = router.stack.filter(l => l.route && l.route.path === '/:id');
    const methods = idLayers.flatMap(l => Object.keys(l.route.methods));
    expect(methods).toContain('get');
    expect(methods).toContain('patch');
  });
});
