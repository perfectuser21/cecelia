import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../routes/infra-status.js', () => ({
  SERVERS: [{ id: 'us-mac-m4', role: 'worker' }],
  COMPUTE_SERVERS: ['us-mac-m4'],
}));
vi.mock('../machine-registry.js', () => ({ workerBridgeUrlFor: () => 'http://worker.test' }));
vi.mock('../platform-utils.js', () => ({ calculatePhysicalCapacity: () => 8 }));

function report() {
  return {
    schema_version: 'fleet-node-health/v1', machine_id: 'us-mac-m4',
    observed_at: new Date().toISOString(),
    resources: {
      cpu_cores: 10, memory_bytes: 16 * 1024 ** 3,
      cpu_pressure_percent: 20, memory_pressure_percent: 40,
      disk_free_bytes: 40 * 1024 ** 3, disk_used_percent: 60,
    },
  };
}

describe('资源报告必须可信且不能通过重复读取延寿', () => {
  let fleet;
  let health;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T08:00:00Z'));
    health = report();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => health })));
    fleet = await import('../fleet-resource-cache.js');
  });
  afterEach(() => {
    fleet.stopFleetRefresh();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  async function collect() {
    fleet.startFleetRefresh();
    await vi.advanceTimersByTimeAsync(1);
  }
  function assertDenied() {
    expect(fleet.getRemoteCapacity('us-mac-m4')).toMatchObject({ online: false, effectiveSlots: 0 });
    expect(fleet.getFleetStatus()[0]).toMatchObject({ online: false, effectiveSlots: 0 });
    expect(fleet.isServerOnline('us-mac-m4')).toBe(false);
    expect(fleet.getTotalEffectiveSlots()).toBe(0);
  }

  it.each([
    ['缺身份', h => { delete h.machine_id; }],
    ['异机报告', h => { h.machine_id = 'xian-mac-m1'; }],
    ['错误协议', h => { h.schema_version = 'unknown/v0'; }],
    ['缺采样时间', h => { delete h.observed_at; }],
    ['非法日期', h => { h.observed_at = 'not-a-date'; }],
    ['未来超界', h => { h.observed_at = new Date(Date.now() + 30_002).toISOString(); }],
    ['过期报告', h => { h.observed_at = new Date(Date.now() - 90_000).toISOString(); }],
    ['缺CPU压力', h => { delete h.resources.cpu_pressure_percent; }],
    ['缺内存压力', h => { delete h.resources.memory_pressure_percent; }],
    ['CPU字符串', h => { h.resources.cpu_pressure_percent = '20'; }],
    ['内存null', h => { h.resources.memory_pressure_percent = null; }],
    ['内存NaN', h => { h.resources.memory_pressure_percent = NaN; }],
    ['内存无限大', h => { h.resources.memory_bytes = Infinity; }],
    ['零内存', h => { h.resources.memory_bytes = 0; }],
    ['负CPU', h => { h.resources.cpu_cores = -1; }],
    ['零CPU', h => { h.resources.cpu_cores = 0; }],
    ['压力负值', h => { h.resources.cpu_pressure_percent = -1; }],
    ['压力超界', h => { h.resources.memory_pressure_percent = 101; }],
    ['缺磁盘数据', h => { delete h.resources.disk_free_bytes; }],
    ['磁盘负值', h => { h.resources.disk_free_bytes = -1; }],
    ['磁盘百分比超界', h => { h.resources.disk_used_percent = 101; }],
  ])('%s不能产生可用容量', async (_name, mutate) => {
    mutate(health);
    await collect();
    assertDenied();
    expect(fleet.getFleetStatus()[0].admission_reason).toMatch(/^worker_health_/);
  });

  it.each([0, 16.3, 100])('合法压力%s保持原容量公式', async pressure => {
    health.resources.cpu_pressure_percent = pressure;
    health.resources.memory_pressure_percent = pressure;
    await collect();
    expect(fleet.getRemoteCapacity('us-mac-m4')).toMatchObject({
      online: true, effectiveSlots: Math.floor(8 * (1 - pressure / 100)),
    });
  });

  it('允许30秒内时钟偏差及重复有效样本', async () => {
    health.observed_at = new Date(Date.now() + 30_000).toISOString();
    await collect();
    expect(fleet.isServerOnline('us-mac-m4')).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fleet.isServerOnline('us-mac-m4')).toBe(true);
    expect(fleet.getFleetStatus()[0].observed_at).toBe(health.observed_at);
  });

  it('重复有效样本可读取，但从采样时刻达到90秒时所有出口立即拒派', async () => {
    health.observed_at = new Date(Date.now() - 80_000).toISOString();
    await collect();
    expect(fleet.isServerOnline('us-mac-m4')).toBe(true);
    fleet.stopFleetRefresh();
    await vi.advanceTimersByTimeAsync(9_999);
    assertDenied();
    expect(fleet.getFleetStatus()[0].admission_reason).toBe('worker_health_stale');
  });

  it('每30秒HTTP成功不能把同一旧报告重新变成新报告', async () => {
    await collect();
    await vi.advanceTimersByTimeAsync(90_000);
    assertDenied();
    health = report();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fleet.isServerOnline('us-mac-m4')).toBe(true);
  });

  it('新的坏报告立即停派并保留最后可信采集时间', async () => {
    await collect();
    const last = fleet.getFleetStatus()[0].last_ping_at;
    delete health.resources.memory_pressure_percent;
    await vi.advanceTimersByTimeAsync(30_000);
    assertDenied();
    expect(fleet.getFleetStatus()[0].last_ping_at).toBe(last);
  });
});
