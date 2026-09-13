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

// ── 2026-09-13 容量喂数改 worker HTTP（handoff 202609131958 next_steps#1）──
// 病：collectServerStats 对 us-mac-m4 走 isLocal 采【Brain 所在机=us-vps】数据，
// 把 VPS 被 openclaw 邻居顶高的压力记在 MMV 头上 → effectiveSlots=0 → tick 恒
// pool_c_full 永不自动派发；西安两台 ssh 采集自容器失败恒 offline。
// 修法：COMPUTE workers 一律经 fleet-worker :5231 /health HTTP 采集
//（machine-registry.workerBridgeUrlFor 解析地址），ssh/isLocal 路径退役。
describe('容量采集走 worker HTTP（弃 ssh/isLocal）', () => {
  let fleetCache;
  let infra;
  const HEALTH = {
    'us-mac-m4': {
      schema_version: 'fleet-node-health/v1', machine_id: 'us-mac-m4',
      resources: {
        cpu_cores: 10, memory_bytes: 16 * 1024 ** 3,
        cpu_pressure_percent: 16.3, memory_pressure_percent: 54,
      },
    },
    'xian-mac-m4': {
      schema_version: 'fleet-node-health/v1', machine_id: 'xian-mac-m4',
      resources: {
        cpu_cores: 10, memory_bytes: 16 * 1024 ** 3,
        cpu_pressure_percent: 20, memory_pressure_percent: 30,
      },
    },
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const hit = Object.keys(HEALTH).find((id) => String(url).includes(id === 'us-mac-m4' ? '100.71.151.105' : '100.86.57.69'));
      if (!hit) throw new Error('ECONNREFUSED');
      return { ok: true, status: 200, json: async () => HEALTH[hit] };
    }));
    infra = await import('../routes/infra-status.js');
    fleetCache = await import('../fleet-resource-cache.js');
  });

  afterEach(() => {
    fleetCache.stopFleetRefresh();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('stats 来自 worker /health 映射，且不再触碰 ssh/local 采集', async () => {
    fleetCache.startFleetRefresh();
    await vi.advanceTimersByTimeAsync(100);
    const cap = fleetCache.getRemoteCapacity('us-mac-m4');
    expect(cap.online).toBe(true);
    expect(cap.stats.cpu.cores).toBe(10);
    expect(cap.stats.cpu.usagePercent).toBeCloseTo(16.3, 1);
    expect(cap.stats.memory.usagePercent).toBe(54);
    expect(cap.stats.memory.totalGB).toBeCloseTo(16, 1);
    // 病根路径必须一次都没被调用（isLocal 采到调度器自身=毒源）
    expect(infra.collectLocalStats).not.toHaveBeenCalled();
    expect(infra.collectRemoteUnixStats).not.toHaveBeenCalled();
  });

  it('worker HTTP 不可达 → offline:fetch_failed（fail-closed，不回落毒源）', async () => {
    fleetCache.startFleetRefresh();
    await vi.advanceTimersByTimeAsync(100);
    const m1 = fleetCache.getRemoteCapacity('xian-mac-m1'); // HEALTH 未配 → fetch 抛
    expect(m1.online).toBe(false);
    expect(m1.offline_reason).toBe('fetch_failed');
    expect(infra.collectLocalStats).not.toHaveBeenCalled();
  });

  it('聚合 effectiveSlots 按 worker 真实压力计算（不再被调度器邻居污染成 0）', async () => {
    fleetCache.startFleetRefresh();
    await vi.advanceTimersByTimeAsync(100);
    // physicalCapacity mock=8：us-mac-m4 maxPressure=0.54→floor(8*0.46)=3；
    // xian-mac-m4 maxPressure=0.30→floor(8*0.70)=5；m1 offline=0 → 总 8
    expect(fleetCache.getTotalEffectiveSlots()).toBe(8);
  });
});
