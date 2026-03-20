/**
 * decomp-checker-domain.test.js
 *
 * [已废弃] createInitiativePlanTask 函数已从 decomposition-checker.js 中删除。
 * initiative_plan 路径已改用 pr_plans 路径。
 * 此测试文件保留以确认函数已不可导入。
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));
vi.mock('../capacity.js', () => ({
  computeCapacity: vi.fn().mockResolvedValue({ used: 0, max: 10 }),
  isAtCapacity: vi.fn().mockResolvedValue(false),
}));
vi.mock('../task-quality-gate.js', () => ({
  validateTaskDescription: vi.fn().mockReturnValue({ valid: true, reasons: [] }),
}));

describe('createInitiativePlanTask — 已废弃', () => {
  it('createInitiativePlanTask 不再从 decomposition-checker.js 导出', async () => {
    const mod = await import('../decomposition-checker.js');
    expect(mod.createInitiativePlanTask).toBeUndefined();
  });

  it('hasExistingInitiativePlanTask 不再从 decomposition-checker.js 导出', async () => {
    const mod = await import('../decomposition-checker.js');
    expect(mod.hasExistingInitiativePlanTask).toBeUndefined();
  });
});
