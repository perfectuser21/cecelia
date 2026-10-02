import { describe, expect, it } from 'vitest';
import { prepareResourceBudget } from './attempt-resource-budget.js';

const input = (capacity = {}, extra = {}) => ({
  machineId: 'us-mac-m4', role: 'generator',
  capacitySnapshot: {
    verified: true, machine: 'us-mac-m4', expires_at: 2000,
    capacity: { ok: true, role: 'generator', available: 99,
      physical_base_slots: 8, effective_base_slots: 6, ...capacity },
  }, ...extra,
});

describe('加权基础槽预算', () => {
  it('取 profile、物理、有效基础槽最小值，不把角色 available 当基础槽', () => {
    expect(prepareResourceBudget(input(), 1000)).toMatchObject({ valid: true, budget: 6, weight: 4, singleton: false });
    expect(prepareResourceBudget(input({ effective_base_slots: 20 }), 1000).budget).toBe(7);
  });
  it.each([undefined, NaN, -1, '6'])('未知基础槽 %s 不允许新增', (value) => {
    expect(prepareResourceBudget(input({ effective_base_slots: value }), 1000).valid).toBe(false);
  });
  it('锁后过期、错误机器、未知角色、缺失快照都拒绝新增', () => {
    expect(prepareResourceBudget(input(), 2000).valid).toBe(false);
    expect(prepareResourceBudget(input({}, { machineId: 'xian-mac-m4' }), 1000).valid).toBe(false);
    expect(prepareResourceBudget(input({}, { role: 'unknown' }), 1000).valid).toBe(false);
    expect(prepareResourceBudget({ machineId: 'us-mac-m4', role: 'generator' }, 1000).valid).toBe(false);
  });
  it.each(['autonomous_progress_floor', 'manual_capacity_override'])('%s 最后基础槽必须独占', (flag) => {
    expect(prepareResourceBudget(input({ [flag]: true, available: 1, physical_base_slots: 1, effective_base_slots: 1 }), 1000))
      .toMatchObject({ valid: true, budget: 1, weight: 4, singleton: true });
  });
  it('硬零容量不能被 singleton 复活', () => {
    expect(prepareResourceBudget(input({ autonomous_progress_floor: true, available: 1, effective_base_slots: 0 }), 1000).valid).toBe(false);
  });
});
