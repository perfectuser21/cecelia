/**
 * captures.js 路由配对测试
 * 覆盖 FR-3/FR-8: 统一进箱端点基础结构
 */
import { describe, it, expect } from 'vitest';
import capturesRouter from '../captures.js';

describe('captures router', () => {
  it('导出一个 express Router（具有 stack 属性）', () => {
    expect(capturesRouter).toBeTruthy();
    expect(typeof capturesRouter).toBe('function');
    expect(Array.isArray(capturesRouter.stack)).toBe(true);
  });

  it('注册了 POST、GET 路由（stack 非空）', () => {
    expect(capturesRouter.stack.length).toBeGreaterThan(0);
    const methods = capturesRouter.stack.map(l => l.route?.methods).filter(Boolean);
    const hasPost = methods.some(m => m.post);
    const hasGet = methods.some(m => m.get);
    expect(hasPost).toBe(true);
    expect(hasGet).toBe(true);
  });
});
