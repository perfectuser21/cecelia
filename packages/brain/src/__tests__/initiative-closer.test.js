import { describe, it, expect } from 'vitest';
import { getMaxActiveInitiatives, MAX_ACTIVE_INITIATIVES } from '../initiative-closer.js';
describe('worker容量公式', () => {
  it('随槽位增加而单调且无槽位输入仍有有效容量', () => {
    expect(getMaxActiveInitiatives(0)).toBeGreaterThan(0);
    expect(getMaxActiveInitiatives(20)).toBeGreaterThanOrEqual(getMaxActiveInitiatives(1));
    expect(MAX_ACTIVE_INITIATIVES).toBe(9);
  });
});
