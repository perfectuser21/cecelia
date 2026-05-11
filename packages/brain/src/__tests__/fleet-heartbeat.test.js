/**
 * fleet-heartbeat.test.js
 *
 * TDD — fleet 心跳可信度逻辑
 *
 * C1 (Red):
 *   (a) 5 分钟内有成功采集 → online=true, offline_reason=null
 *   (b) 10+ 分钟无成功采集 → online=false, offline_reason='no_ping_grace_exceeded'
 *   (c) 采集抛异常（首次）→ online=false, offline_reason='fetch_failed'
 */

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
  collectRemoteUnixStats: vi.fn(() => Promise.resolve({
    status: 'online',
    cpu: { cores: 10, usagePercent: 20 },
    memory: { totalGB: 14, usedGB: 7, usagePercent: 50 },
  })),
  default: { get: vi.fn() },
}));

vi.mock('../platform-utils.js', () => ({
  calculatePhysicalCapacity: vi.fn(() => 8),
}));

describe('fleet heartbeat 可信度判定', () => {
  let fleetCache;
  let mockCollectRemote;

  beforeEach(async () => {
    vi.useFakeTimers();
    const infraMod = await import('../routes/infra-status.js');
    mockCollectRemote = infraMod.collectRemoteUnixStats;
    // 默认成功
    mockCollectRemote.mockResolvedValue({
      status: 'online',
      cpu: { cores: 10, usagePercent: 20 },
      memory: { totalGB: 14, usedGB: 7, usagePercent: 50 },
    });
    fleetCache = await import('../fleet-resource-cache.js');
  });

  afterEach(() => {
    fleetCache.stopFleetRefresh();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('(a) 5 分钟内有成功采集 → online=true, offline_reason=null, last_ping_at 有值', async () => {
    fleetCache.startFleetRefresh();
    await vi.advanceTimersByTimeAsync(100);

    const status = fleetCache.getFleetStatus();
    const xian = status.find(s => s.id === 'xian-mac-m4');

    expect(xian).toBeDefined();
    expect(xian.online).toBe(true);
    expect(xian.offline_reason).toBeNull();
    expect(typeof xian.last_ping_at).toBe('number');
    expect(xian.last_ping_at).toBeGreaterThan(0);
  });

  it('(b) 10+ 分钟无成功采集 → online=false, offline_reason=no_ping_grace_exceeded', async () => {
    // 首次采集成功
    fleetCache.startFleetRefresh();
    await vi.advanceTimersByTimeAsync(100);

    // 之后远端开始失败
    mockCollectRemote.mockRejectedValue(new Error('SSH timeout'));

    // 推进 11 分钟（超过默认 10 分钟 grace）— 每 30s 刷新一次
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);

    const status = fleetCache.getFleetStatus();
    const xian = status.find(s => s.id === 'xian-mac-m4');

    expect(xian).toBeDefined();
    expect(xian.online).toBe(false);
    expect(xian.offline_reason).toBe('no_ping_grace_exceeded');
  });

  it('(c) 首次采集就失败 → online=false, offline_reason=fetch_failed', async () => {
    mockCollectRemote.mockRejectedValue(new Error('Connection refused'));

    fleetCache.startFleetRefresh();
    await vi.advanceTimersByTimeAsync(100);

    const status = fleetCache.getFleetStatus();
    const xian = status.find(s => s.id === 'xian-mac-m4');

    expect(xian).toBeDefined();
    expect(xian.online).toBe(false);
    expect(xian.offline_reason).toBe('fetch_failed');
  });

  it('getFleetStatus 每条记录都包含 last_ping_at + offline_reason 字段', async () => {
    fleetCache.startFleetRefresh();
    await vi.advanceTimersByTimeAsync(100);

    const status = fleetCache.getFleetStatus();
    expect(status.length).toBeGreaterThan(0);
    for (const s of status) {
      expect(s).toHaveProperty('last_ping_at');
      expect(s).toHaveProperty('offline_reason');
    }
  });
});
