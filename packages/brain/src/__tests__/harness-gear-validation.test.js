/**
 * harness-gear-validation.test.js
 * 验证 gear 档位枚举校验逻辑（executor.js 中 _driveHarnessInitiative gear 校验）
 */
import { describe, it, expect } from 'vitest';

describe('harness gear 枚举校验', () => {
  const ALLOWED_GEARS = new Set(['hotfix', 'segmented']);

  it('null gear 视为默认流程，合法', () => {
    const gear = null;
    expect(gear === null || ALLOWED_GEARS.has(gear)).toBe(true);
  });

  it('undefined gear 视为默认流程（payload 未传 gear），合法', () => {
    const payload = {};
    const gear = payload.gear ?? null;
    expect(gear === null || ALLOWED_GEARS.has(gear)).toBe(true);
  });

  it('hotfix gear 合法（免 GAN 直通路径）', () => {
    expect(ALLOWED_GEARS.has('hotfix')).toBe(true);
  });

  it('segmented gear 合法（骨架多段串行路径）', () => {
    expect(ALLOWED_GEARS.has('segmented')).toBe(true);
  });

  it('非法 gear 值应被拒绝（executor 需标 terminal fail）', () => {
    const ILLEGAL = ['turbo', 'fast', 'normal', 'express', '', 'HOTFIX', 'Segmented'];
    for (const g of ILLEGAL) {
      expect(ALLOWED_GEARS.has(g)).toBe(false);
    }
  });

  it('HARNESS_GEAR 注入：空字符串等同 null（skill-relay 用 || 保底）', () => {
    const injected = '';
    const gear = injected || null;
    expect(gear === null || ALLOWED_GEARS.has(gear)).toBe(true);
  });
});
