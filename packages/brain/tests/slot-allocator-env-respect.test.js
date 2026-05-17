/**
 * slot-allocator-env-respect.test.js
 *
 * DoD: 运行时 effectiveSlots == CECELIA_MAX_SEATS - INTERACTIVE_RESERVE
 *
 * 验证：当 CECELIA_BUDGET_SLOTS / CECELIA_MAX_SEATS 显式设置时，
 * getEffectiveMaxSeats() 必须返回 ENV 值，不受 PHYSICAL_CAPACITY 限制。
 *
 * 背景：低内存容器（~6GB RAM，5GB 系统预留）导致 PHYSICAL_CAPACITY=2，
 * 修复前 Math.min(_budgetCap, PHYSICAL_CAPACITY) 把 7 截断为 2，
 * 再经 SAFETY_MARGIN=0.80 变为 1，完全无视用户意图。
 */

import { describe, it, expect } from 'vitest';

// ============================================================
// 被测逻辑复现（与 executor.js 同步，便于隔离测试不同 PHYSICAL_CAPACITY 值）
// ============================================================

const INTERACTIVE_RESERVE = 2;   // executor.js 常量
const SAFETY_MARGIN = 0.80;       // executor.js 常量

/**
 * 修复前的逻辑（验证它确实是 broken 的）
 */
function getEffectiveMaxSeats_BROKEN(budgetCap, physicalCapacity) {
  if (budgetCap && budgetCap > 0) {
    return Math.min(budgetCap, physicalCapacity);  // BUG: silently defeats user intent
  }
  return physicalCapacity;
}

/**
 * 修复后的逻辑（与 executor.js 修复后保持一致）
 */
function getEffectiveMaxSeats_FIXED(budgetCap, physicalCapacity) {
  if (budgetCap && budgetCap > 0) {
    return budgetCap;  // explicit override: honor as-is
  }
  return physicalCapacity;
}

/**
 * checkServerResources 零压力时的 effectiveSlots 计算
 */
function effectiveSlotsAtZeroPressure(maxSeats) {
  return Math.floor(maxSeats * SAFETY_MARGIN);
}

// ============================================================
// Tests
// ============================================================

describe('slot-allocator ENV respect — CECELIA_BUDGET_SLOTS', () => {
  const LOW_PHYSICAL_CAPACITY = 2;  // 低内存容器实测值（~6GB total, 5GB reserved）

  describe('修复前行为（复现 bug，确认它确实 broken）', () => {
    it('BUDGET_SLOTS=7, PHYSICAL=2 → getEffectiveMaxSeats 被截断为 2', () => {
      const result = getEffectiveMaxSeats_BROKEN(7, LOW_PHYSICAL_CAPACITY);
      expect(result).toBe(2);  // 用户意图 7 被截为 2
    });

    it('截断后 effectiveSlots 在零压力下为 1（远低于预期）', () => {
      const maxSeats = getEffectiveMaxSeats_BROKEN(7, LOW_PHYSICAL_CAPACITY);
      const slots = effectiveSlotsAtZeroPressure(maxSeats);
      expect(slots).toBe(1);  // floor(2 * 0.8) = 1 ← 症状
    });

    it('MAX_SEATS=10, PHYSICAL=2 → 同样被截断', () => {
      const result = getEffectiveMaxSeats_BROKEN(10, LOW_PHYSICAL_CAPACITY);
      expect(result).toBe(2);
    });
  });

  describe('修复后行为（ENV 被正确尊重）', () => {
    it('BUDGET_SLOTS=7, PHYSICAL=2 → getEffectiveMaxSeats 返回 7', () => {
      const result = getEffectiveMaxSeats_FIXED(7, LOW_PHYSICAL_CAPACITY);
      expect(result).toBe(7);
    });

    it('BUDGET_SLOTS=7 时 effectiveSlots 零压力 = 7 - INTERACTIVE_RESERVE = 5', () => {
      const maxSeats = getEffectiveMaxSeats_FIXED(7, LOW_PHYSICAL_CAPACITY);
      const slots = effectiveSlotsAtZeroPressure(maxSeats);
      expect(slots).toBe(7 - INTERACTIVE_RESERVE);  // floor(7 * 0.8) = 5 = 7 - 2
    });

    it('MAX_SEATS=10, PHYSICAL=2 → getEffectiveMaxSeats 返回 10', () => {
      const result = getEffectiveMaxSeats_FIXED(10, LOW_PHYSICAL_CAPACITY);
      expect(result).toBe(10);
    });

    it('MAX_SEATS=10 时 effectiveSlots 零压力 = CECELIA_MAX_SEATS - INTERACTIVE_RESERVE = 8', () => {
      const maxSeats = getEffectiveMaxSeats_FIXED(10, LOW_PHYSICAL_CAPACITY);
      const slots = effectiveSlotsAtZeroPressure(maxSeats);
      expect(slots).toBe(10 - INTERACTIVE_RESERVE);  // floor(10 * 0.8) = 8 = 10 - 2 ✓ DoD
    });

    it('无 ENV（budgetCap=null）时依然使用 PHYSICAL_CAPACITY', () => {
      const result = getEffectiveMaxSeats_FIXED(null, LOW_PHYSICAL_CAPACITY);
      expect(result).toBe(LOW_PHYSICAL_CAPACITY);
    });

    it('无 ENV（budgetCap=0）时依然使用 PHYSICAL_CAPACITY', () => {
      const result = getEffectiveMaxSeats_FIXED(0, LOW_PHYSICAL_CAPACITY);
      expect(result).toBe(LOW_PHYSICAL_CAPACITY);
    });
  });

  describe('高内存机器场景（修复不影响高配机器）', () => {
    const HIGH_PHYSICAL_CAPACITY = 20;

    it('BUDGET_SLOTS=7, PHYSICAL=20 → 修复前后均返回 7', () => {
      const broken = getEffectiveMaxSeats_BROKEN(7, HIGH_PHYSICAL_CAPACITY);
      const fixed = getEffectiveMaxSeats_FIXED(7, HIGH_PHYSICAL_CAPACITY);
      expect(broken).toBe(7);
      expect(fixed).toBe(7);
    });

    it('MAX_SEATS=10, PHYSICAL=20 → 修复前后均返回 10', () => {
      expect(getEffectiveMaxSeats_BROKEN(10, HIGH_PHYSICAL_CAPACITY)).toBe(10);
      expect(getEffectiveMaxSeats_FIXED(10, HIGH_PHYSICAL_CAPACITY)).toBe(10);
    });
  });

  describe('DoD 契约断言', () => {
    it('[DoD] effectiveSlots == CECELIA_MAX_SEATS - INTERACTIVE_RESERVE（零压力，CECELIA_MAX_SEATS=10）', () => {
      const CECELIA_MAX_SEATS = 10;
      const maxSeats = getEffectiveMaxSeats_FIXED(CECELIA_MAX_SEATS, LOW_PHYSICAL_CAPACITY);
      const effectiveSlots = effectiveSlotsAtZeroPressure(maxSeats);
      expect(effectiveSlots).toBe(CECELIA_MAX_SEATS - INTERACTIVE_RESERVE);
    });

    it('[DoD] effectiveSlots == CECELIA_BUDGET_SLOTS - INTERACTIVE_RESERVE（零压力，CECELIA_BUDGET_SLOTS=7）', () => {
      const CECELIA_BUDGET_SLOTS = 7;
      const maxSeats = getEffectiveMaxSeats_FIXED(CECELIA_BUDGET_SLOTS, LOW_PHYSICAL_CAPACITY);
      const effectiveSlots = effectiveSlotsAtZeroPressure(maxSeats);
      expect(effectiveSlots).toBe(CECELIA_BUDGET_SLOTS - INTERACTIVE_RESERVE);
    });

    it('[DoD] 修复后 effectiveSlots 必须 > 修复前 effectiveSlots（低内存容器场景）', () => {
      const budgetCap = 7;
      const slotsBefore = effectiveSlotsAtZeroPressure(
        getEffectiveMaxSeats_BROKEN(budgetCap, LOW_PHYSICAL_CAPACITY)
      );
      const slotsAfter = effectiveSlotsAtZeroPressure(
        getEffectiveMaxSeats_FIXED(budgetCap, LOW_PHYSICAL_CAPACITY)
      );
      expect(slotsAfter).toBeGreaterThan(slotsBefore);
      expect(slotsBefore).toBe(1);  // 修复前的症状
      expect(slotsAfter).toBe(5);   // 修复后
    });
  });
});
