/**
 * gaps 路由 smoke 测试
 * 全链集成测试需要 DB — 此处仅验证路由挂载和导出格式
 *
 * sprint: 08110022-relay-d96c9fa0 ws5
 */
import { describe, test, expect } from 'vitest';
import express from 'express';
import harnessGapsRouter from '../gaps.js';

describe('gaps route', () => {
  test('harnessGapsRouter 是有效的 Express router', () => {
    expect(harnessGapsRouter).toBeDefined();
    expect(typeof harnessGapsRouter).toBe('function');
  });

  test('router 可挂载到 Express 应用不抛错', () => {
    const app = express();
    expect(() => app.use('/harness', harnessGapsRouter)).not.toThrow();
  });

  test('router 有 stack（有路由注册）', () => {
    expect(harnessGapsRouter.stack).toBeDefined();
    expect(harnessGapsRouter.stack.length).toBeGreaterThan(0);
  });

  test('暴露 repair-task 绑定入口', () => {
    const paths = harnessGapsRouter.stack
      .map((layer) => layer.route?.path)
      .filter(Boolean);
    expect(paths).toContain('/:id/repair-task');
  });

  test('所有 Gap 写入口都挂 internalAuthOrLoopback，匿名远端不能制造阻塞', () => {
    const writeRoutes = harnessGapsRouter.stack.filter((layer) => (
      layer.route && ['post', 'patch'].some((method) => layer.route.methods[method])
    ));
    expect(writeRoutes.map((layer) => layer.route.path)).toEqual(expect.arrayContaining([
      '/', '/:id/repair-task', '/:id/status',
    ]));
    for (const layer of writeRoutes) {
      expect(layer.route.stack.map((handler) => handler.handle.name))
        .toContain('internalAuthOrLoopback');
    }
  });
});
