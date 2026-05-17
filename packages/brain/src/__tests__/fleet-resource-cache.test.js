import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../routes/infra-status.js', () => ({
  SERVERS: [
    { id: 'us-mac-m4', name: 'US Mac', tailscaleIp: '100.71.151.105', role: '主力研发机', isLocal: true },
    { id: 'xian-mac-m4', name: 'Xian M4', tailscaleIp: '100.86.57.69', role: 'Codex', sshUser: 'test' },
    { id: 'xian-mac-m1', name: 'Xian M1', tailscaleIp: '100.103.88.66', role: 'CI', sshUser: 'test' },
  ],
  COMPUTE_SERVERS: ['us-mac-m4', 'xian-mac-m4', 'xian-mac-m1'],
  collectLocalStats: vi.fn(() => ({
    status: 'online',
    cpu: { cores: 10, usagePercent: 15 },
    memory: { totalGB: 16, usedGB: 6, usagePercent: 40 },
  })),
  collectRemoteUnixStats: vi.fn(() => ({
    status: 'online',
    cpu: { cores: 10, usagePercent: 20 },
    memory: { totalGB: 14, usedGB: 7, usagePercent: 50 },
  })),
  default: { get: vi.fn() },
}));

vi.mock('../platform-utils.js', () => ({
  calculatePhysicalCapacity: vi.fn(() => 8),
}));

describe('fleet-resource-cache', () => {
  let fleetCache;

  beforeEach(async () => {
    vi.useFakeTimers();
    fleetCache = await import('../fleet-resource-cache.js');
  });

  afterEach(() => {
    fleetCache.stopFleetRefresh();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('未启动时 getFleetStatus 返回空数组', () => {
    expect(fleetCache.getFleetStatus()).toEqual([]);
  });

  it('未启动时 getRemoteCapacity 返回 null', () => {
    expect(fleetCache.getRemoteCapacity('us-mac-m4')).toBeNull();
  });

  it('未启动时 isServerOnline 返回 false', () => {
    expect(fleetCache.isServerOnline('us-mac-m4')).toBe(false);
  });

  it('启动后返回 3 台机器状态', async () => {
    fleetCache.startFleetRefresh();
    await vi.advanceTimersByTimeAsync(100);
    const status = fleetCache.getFleetStatus();
    expect(status.length).toBe(3);
    expect(status.map(s => s.id)).toEqual(['us-mac-m4', 'xian-mac-m4', 'xian-mac-m1']);
  });

  it('采集后机器 online 且有 effectiveSlots', async () => {
    fleetCache.startFleetRefresh();
    await vi.advanceTimersByTimeAsync(100);
    const cap = fleetCache.getRemoteCapacity('us-mac-m4');
    expect(cap).not.toBeNull();
    expect(cap.online).toBe(true);
    expect(cap.effectiveSlots).toBeGreaterThanOrEqual(0);
    expect(cap.physicalCapacity).toBe(8);
  });

  it('getTotalEffectiveSlots 返回正数', async () => {
    fleetCache.startFleetRefresh();
    await vi.advanceTimersByTimeAsync(100);
    expect(fleetCache.getTotalEffectiveSlots()).toBeGreaterThan(0);
  });

  it('数据过期后 isServerOnline 返回 false', async () => {
    fleetCache.startFleetRefresh();
    await vi.advanceTimersByTimeAsync(100);
    expect(fleetCache.isServerOnline('us-mac-m4')).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(fleetCache.isServerOnline('us-mac-m4')).toBe(false);
  });
});
