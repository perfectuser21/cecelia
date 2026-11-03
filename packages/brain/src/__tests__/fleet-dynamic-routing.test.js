import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', async () => (await import('./helpers/deny-child-process.js')).default);
vi.mock('node:child_process', async () => (await import('./helpers/deny-child-process.js')).default);

// 节点目录和 HTTP 是输入边界，资源解析、容量计算与缓存读取均使用生产实现。
vi.mock('../execution-directory/directory.js', () => ({
  current: () => ({ nodes: [
    { canonical_id: 'fixture-online', name: '在线测试节点' },
    { canonical_id: 'fixture-offline', name: '离线测试节点' },
  ] }),
}));
vi.mock('../machine-registry.js', () => ({
  workerBridgeUrlFor: id => `http://${id}.invalid:5231`,
}));

describe('fleet-resource-cache — 真实动态容量', () => {
  let fleet;
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (url === 'http://fixture-offline.invalid:5231/health') throw new Error('连接失败');
      expect(url).toBe('http://fixture-online.invalid:5231/health');
      return { ok: true, json: async () => ({
        schema_version: 'fleet-node-health/v1', machine_id: 'fixture-online',
        observed_at: '2026-01-01T00:00:00Z',
        resources: { cpu_cores: 8, memory_bytes: 32 * 1024 ** 3,
          cpu_pressure_percent: 40, memory_pressure_percent: 25,
          disk_free_bytes: 100 * 1024 ** 3, disk_used_percent: 30 },
      }) };
    }));
    fleet = await import('../fleet-resource-cache.js');
    fleet.startFleetRefresh();
    // 刷新是生产代码的异步启动行为；等真实缓存填入，再检查结果。
    await new Promise(resolve => setImmediate(resolve));
    expect(fleet.getRemoteCapacity('fixture-online')).not.toBeNull();
  });
  afterEach(() => {
    fleet?.stopFleetRefresh();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('真实资源样本经容量公式计算出12物理槽与7可用槽', () => {
    expect(fleet.getRemoteCapacity('fixture-online')).toEqual({
      online: true, effectiveSlots: 7, physicalCapacity: 12, pressure: 0.4,
      last_ping_at: Date.now(), offline_reason: null, admission_reason: null,
    });
  });
  it('采集失败的节点关闭容量并记录离线原因', () => {
    expect(fleet.getRemoteCapacity('fixture-offline')).toEqual({
      online: false, effectiveSlots: 0, physicalCapacity: 0, pressure: 1,
      last_ping_at: null, offline_reason: 'fetch_failed', admission_reason: 'worker_health_unavailable',
    });
    expect(fleet.isServerOnline('fixture-offline')).toBe(false);
  });
  it('真实汇总保留两个节点与各自资源状态', () => {
    expect(fleet.getFleetStatus()).toHaveLength(2);
    expect(fleet.getFleetStatus()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'fixture-online', online: true, physicalCapacity: 12,
        effectiveSlots: 7, pressure: 0.4, cpu: { cores: 8, usagePercent: 40 } }),
      expect.objectContaining({ id: 'fixture-offline', online: false, effectiveSlots: 0 }),
    ]));
    expect(fleet.getTotalEffectiveSlots()).toBe(7);
    expect(fleet.isServerOnline('fixture-online')).toBe(true);
  });
  it('不存在的节点不能贡献在线状态或容量', () => {
    expect(fleet.getRemoteCapacity('unknown')).toBeNull();
    expect(fleet.isServerOnline('unknown')).toBe(false);
  });
  it('90秒没有新样本时在线节点关闭容量', () => {
    vi.setSystemTime(new Date('2026-01-01T00:01:30Z'));
    expect(fleet.getRemoteCapacity('fixture-online')).toEqual(expect.objectContaining({
      online: false, effectiveSlots: 0, pressure: 1, admission_reason: 'worker_health_stale',
    }));
    expect(fleet.getFleetStatus().find(node => node.id === 'fixture-online')).toEqual(expect.objectContaining({
      online: false, effectiveSlots: 0, offline_reason: 'no_ping_grace_exceeded',
    }));
    expect(fleet.getTotalEffectiveSlots()).toBe(0);
    expect(fleet.isServerOnline('fixture-online')).toBe(false);
  });
});
