import { describe, it, expect } from 'vitest';
import { selectLoadBalancedMachine } from './select-load-balanced.js';

// YAGNI 占位：确定性取第一台（调用方已按 name 排序）。本期不做负载/健康探活。
describe('selectLoadBalancedMachine', () => {
  it('多候选 → 返回第一台（确定性）', async () => {
    expect(await selectLoadBalancedMachine([{ name: 'a' }, { name: 'b' }])).toEqual({ name: 'a' });
  });

  it('单候选 → 返回它', async () => {
    expect(await selectLoadBalancedMachine([{ name: 'only' }])).toEqual({ name: 'only' });
  });

  it('空数组 / 非数组 → null', async () => {
    expect(await selectLoadBalancedMachine([])).toBeNull();
    expect(await selectLoadBalancedMachine(null)).toBeNull();
    expect(await selectLoadBalancedMachine(undefined)).toBeNull();
  });
});
