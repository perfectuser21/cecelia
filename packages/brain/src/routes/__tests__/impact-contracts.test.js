/**
 * impact-contracts 路由 smoke 测试
 * 全链集成测试需要 DB — 此处仅验证路由挂载和导出格式
 *
 * sprint: 08110022-relay-d96c9fa0 ws2
 */
import { describe, test, expect } from 'vitest';
import express from 'express';
import impactContractsRouter from '../impact-contracts.js';

describe('impact-contracts route', () => {
  test('impactContractsRouter 是有效的 Express router', () => {
    expect(impactContractsRouter).toBeDefined();
    expect(typeof impactContractsRouter).toBe('function');
  });

  test('router 可挂载到 Express 应用不抛错', () => {
    const app = express();
    expect(() => app.use('/api/brain', impactContractsRouter)).not.toThrow();
  });

  test('router 有 stack（有路由注册）', () => {
    expect(impactContractsRouter.stack).toBeDefined();
    expect(impactContractsRouter.stack.length).toBeGreaterThan(0);
  });
});
