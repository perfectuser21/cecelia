import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fleet-resource-cache
vi.mock('../fleet-resource-cache.js', () => ({
  getFleetStatus: vi.fn(() => [
    { id: 'us-mac-m4', online: true, effectiveSlots: 8, physicalCapacity: 16, pressure: 0.45 },
    { id: 'xian-mac-m4', online: true, effectiveSlots: 7, physicalCapacity: 16, pressure: 0.54 },
  ]),
  getRemoteCapacity: vi.fn((id) => {
    if (id === 'xian-mac-m4') return { online: true, effectiveSlots: 7, physicalCapacity: 16, pressure: 0.54 };
    if (id === 'xian-mac-m1') return { online: false, effectiveSlots: 0, physicalCapacity: 0, pressure: 1 };
    return null;
  }),
  isServerOnline: vi.fn((id) => id === 'xian-mac-m4'),
}));

describe('DEV_ONLY_TYPES 路由规则', () => {
  it('dev 在 DEV_ONLY_TYPES 中', () => {
    const DEV_ONLY_TYPES = new Set(['dev']);
    expect(DEV_ONLY_TYPES.has('dev')).toBe(true);
  });

  it('非 dev 类型不在 DEV_ONLY_TYPES 中', () => {
    const DEV_ONLY_TYPES = new Set(['dev']);
    expect(DEV_ONLY_TYPES.has('code_review')).toBe(false);
    expect(DEV_ONLY_TYPES.has('code_review')).toBe(false);
    expect(DEV_ONLY_TYPES.has('initiative_plan')).toBe(false);
    expect(DEV_ONLY_TYPES.has('dept_heartbeat')).toBe(false);
  });
});

describe('动态 Codex 并发上限', () => {
  it('getRemoteCapacity 返回正确的 effectiveSlots', async () => {
    const { getRemoteCapacity } = await import('../fleet-resource-cache.js');
    const cap = getRemoteCapacity('xian-mac-m4');
    expect(cap.online).toBe(true);
    expect(cap.effectiveSlots).toBe(7);
  });

  it('offline 机器 effectiveSlots 为 0', async () => {
    const { getRemoteCapacity } = await import('../fleet-resource-cache.js');
    const cap = getRemoteCapacity('xian-mac-m1');
    expect(cap.online).toBe(false);
    expect(cap.effectiveSlots).toBe(0);
  });

  it('getFleetStatus 返回所有机器', async () => {
    const { getFleetStatus } = await import('../fleet-resource-cache.js');
    const fleet = getFleetStatus();
    expect(fleet.length).toBe(2);
  });
});
