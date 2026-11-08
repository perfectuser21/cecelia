import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ directory: null, refresh: null, readError: null, malformed: false,
  fetch: vi.fn(), forbidden: vi.fn() }));
vi.mock('../execution-directory/directory.js', async original => ({
  ...await original(),
  current: () => {
    if (io.readError) throw io.readError;
    if (io.malformed) return { nodes: null };
    return io.directory.current();
  },
}));
vi.mock('../machine-registry.js', () => ({ workerBridgeUrlFor: id => {
  if (!['owned-a', 'owned-b'].includes(id)) { io.forbidden('worker-url'); throw Error('未知测试worker'); }
  return `http://${id}.owned.invalid:5231`;
} }));
vi.mock('../db.js', () => ({ default: { query: (...args) => {
  io.forbidden('db', ...args); return Promise.reject(Error('禁止真实DB'));
} } }));
vi.mock('node:child_process', () => Object.fromEntries(
  ['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork'].map(name => [name, (...args) => {
    io.forbidden(name, ...args); throw Error('禁止宿主进程');
  }]),
));
import { createExecutionDirectory } from '../execution-directory/directory.js';

const NOW = new Date('2026-11-05T00:00:00Z');
let cache;
function response(id) {
  return { ok: true, status: 200, json: async () => ({
    schema_version: 'fleet-node-health/v1', machine_id: id, observed_at: new Date().toISOString(),
    resources: { cpu_cores: 10, memory_bytes: 16 * 1024 ** 3,
      cpu_pressure_percent: 0, memory_pressure_percent: 0,
      disk_free_bytes: 40 * 1024 ** 3, disk_used_percent: 50 },
  }) };
}
async function publish(ids) {
  const pool = { query: vi.fn(async () => ({ rows: ids.map(canonical_id => ({ canonical_id, name: canonical_id })) })) };
  return io.directory.refresh({ pool });
}
async function seed(ids = ['owned-a']) {
  await publish(ids);
  cache.startFleetRefresh();
  await vi.advanceTimersByTimeAsync(0);
}
function pending() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function expectRemoved() {
  expect(cache.getRemoteCapacity('owned-a')).toBeNull();
  expect(cache.isServerOnline('owned-a')).toBe(false);
  expect(cache.getFleetStatus()).toEqual([]);
  expect(cache.getTotalEffectiveSlots()).toBe(0);
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  io.directory = createExecutionDirectory({ ttlMs: 300_000 });
  io.readError = null; io.malformed = false;
  io.forbidden.mockClear();
  io.fetch.mockReset().mockImplementation(async url => {
    const match = /^http:\/\/(owned-[ab])\.owned\.invalid:5231\/health$/.exec(String(url));
    if (!match) { io.forbidden('fetch-url'); throw Error('禁止非owned网络'); }
    return response(match[1]);
  });
  vi.stubGlobal('fetch', io.fetch);
  const schedule = globalThis.setInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation((callback, ms, ...args) => {
    if (ms === 30_000) io.refresh = callback; // 捕获真实注册的刷新函数，不导出/复制生产实现。
    return schedule(callback, ms, ...args);
  });
  cache = await import('../fleet-resource-cache.js');
});
afterEach(() => {
  try { expect(io.forbidden).not.toHaveBeenCalled(); }
  finally {
    cache?.stopFleetRefresh();
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  }
});

describe('实际目录发布进入Fleet缓存成员关系', () => {
  it('成功移除一节点，不再在线/留状态或贡献聚合容量，保留节点照常刷新', async () => {
    await seed(['owned-a','owned-b']);
    expect(cache.getTotalEffectiveSlots()).toBe(16);
    await publish(['owned-b']);
    await io.refresh();
    expect(cache.getRemoteCapacity('owned-a')).toBeNull();
    expect(cache.isServerOnline('owned-a')).toBe(false);
    expect(cache.getFleetStatus().map(row => row.id)).toEqual(['owned-b']);
    expect(cache.getTotalEffectiveSlots()).toBe(8);
    expect(io.fetch).toHaveBeenCalledTimes(3);
  });

  it('成功发布空目录清除全部旧容量，且不继续探测旧worker', async () => {
    await seed(); expect(cache.getTotalEffectiveSlots()).toBe(8);
    await publish([]); await io.refresh();
    expectRemoved();
    expect(io.fetch).toHaveBeenCalledTimes(1);
  });

  it('目录TTL过期返回null，不能冒充成功空目录而删缓存', async () => {
    io.directory = createExecutionDirectory({ ttlMs: 10 });
    await seed();
    vi.setSystemTime(new Date(NOW.getTime() + 20));
    expect(io.directory.current()).toBeNull();
    await io.refresh();
    expect(cache.getTotalEffectiveSlots()).toBe(8);
    expect(cache.getFleetStatus()).toHaveLength(1);
    expect(io.fetch).toHaveBeenCalledTimes(1);
  });

  it('目录读取抛错保留缓存并结束本轮，不产生未处理拒绝', async () => {
    await seed(); io.readError = Error('synthetic directory unavailable');
    await expect(io.refresh()).resolves.toBeUndefined();
    expect(cache.getTotalEffectiveSlots()).toBe(8);
    expect(io.fetch).toHaveBeenCalledTimes(1);
  });

  it('缺失nodes数组不当空目录，保留先前成功样本', async () => {
    await seed(); io.malformed = true;
    await io.refresh();
    expect(cache.getTotalEffectiveSlots()).toBe(8);
    expect(cache.getFleetStatus()).toHaveLength(1);
  });

  it('目录刷新失败不改变先前发布成员，Fleet仍按旧权威快照刷新', async () => {
    await seed();
    await expect(io.directory.refresh({ pool: { query: async () => { throw Error('synthetic directory DB down'); } } })).rejects.toThrow('synthetic directory DB down');
    await io.refresh();
    expect(cache.getTotalEffectiveSlots()).toBe(8);
    expect(io.fetch).toHaveBeenCalledTimes(2);
  });

  it('新目录已移除节点，较旧pending健康采样完成也不能重新加入缓存', async () => {
    await seed();
    const old = pending();
    io.fetch.mockImplementationOnce(() => old.promise);
    const olderRound = io.refresh();
    await publish([]); await io.refresh();
    old.resolve(response('owned-a')); await olderRound;
    expectRemoved();
  });

  it('同节点新一轮采样失败后，旧pending成功不能覆盖较新离线状态', async () => {
    await seed();
    const old = pending();
    io.fetch.mockImplementationOnce(() => old.promise);
    const olderRound = io.refresh();
    io.fetch.mockRejectedValueOnce(Error('synthetic worker unavailable'));
    await io.refresh();
    old.resolve(response('owned-a')); await olderRound;
    expect(cache.getRemoteCapacity('owned-a')).toMatchObject({ online: false, effectiveSlots: 0 });
    expect(cache.getTotalEffectiveSlots()).toBe(0);
  });

  it('权威目录已移除旧节点时，即使新节点采样pending也立即停止旧容量', async () => {
    await seed(); await publish(['owned-b']);
    const next = pending(); io.fetch.mockImplementationOnce(() => next.promise);
    const newerRound = io.refresh();
    try { expect(cache.getRemoteCapacity('owned-a')).toBeNull(); }
    finally { next.resolve(response('owned-b')); await newerRound; }
    expect(cache.getTotalEffectiveSlots()).toBe(8);
  });
});

it('同一轮快worker采样仍及时发布，不被慢worker阻塞（原逐节点更新合同）', async () => {
  await seed(['owned-a','owned-b']);
  const slow = pending();
  const busy = response('owned-a');
  const health = await busy.json(); health.resources.cpu_pressure_percent = 100;
  io.fetch.mockImplementationOnce(async () => ({ ...busy, json: async () => health }));
  io.fetch.mockImplementationOnce(() => slow.promise);
  const round = io.refresh();
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.getRemoteCapacity('owned-a')).toMatchObject({ online: true, effectiveSlots: 0 });
    expect(cache.getRemoteCapacity('owned-b')).toMatchObject({ online: true, effectiveSlots: 8 });
  } finally {
    slow.resolve(response('owned-b')); await round;
  }
});
