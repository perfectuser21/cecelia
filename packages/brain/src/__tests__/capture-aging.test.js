/**
 * capture-aging.js 配对测试
 * 覆盖 FR-7: 账龄哨兵基础行为
 */
import { describe, it, expect } from 'vitest';
import { runCaptureAging } from '../capture-aging.js';

describe('capture-aging: runCaptureAging', () => {
  it('是一个可调用的异步函数', () => {
    expect(typeof runCaptureAging).toBe('function');
    expect(runCaptureAging.constructor.name).toBe('AsyncFunction');
  });

  it('使用空池调用不抛出（处理 0 条记录）', async () => {
    const mockPool = {
      query: async () => ({ rows: [] }),
    };
    let threw = false;
    try {
      await runCaptureAging(mockPool);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
