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
});
