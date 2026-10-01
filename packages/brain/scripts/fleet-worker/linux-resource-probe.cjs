'use strict';
const fs = require('node:fs/promises');
const { parseCpuSet, intersectCpuSets, parseCpuMax, parseMemoryLimit, parsePsi, locateHierarchy, unsigned } = require('./linux-cgroup.cjs');
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const invalid = () => { throw new Error('linux_resource_invalid'); };
async function readBounded(filename) {
  const handle = await fs.open(filename, 'r');
  try {
    const bytes = Buffer.alloc(65537), { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 65536) invalid();
    return bytes.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
}
function number(value) { if (value < 0n || value > MAX_SAFE) invalid(); return Number(value); }
function memoryInfo(raw) {
  const read = name => {
    const found = raw.match(new RegExp('^' + name + ':\\s+(\\d+) kB$', 'm'));
    if (!found) invalid(); return unsigned(found[1]) * 1024n;
  };
  const total = read('MemTotal'), available = read('MemAvailable');
  if (total === 0n || available > total) invalid();
  return { total, available };
}
function unknown(observedAt) {
  return { schema_version: 'linux-resource-observation/v1', observed_at: observedAt, scope: 'observer_cgroup',
    execution: false, pool_verified: false, status: 'unknown', reason: 'linux_resources_unavailable',
    cpu_cores: 0, memory_limit_bytes: 0, memory_available_bytes: 0, disk_free_bytes: 0, disk_used_percent: 100,
    ancestry_visible: false, psi: {}, memory_events: {}, gpu: { status: 'unknown' } };
}
async function optionalPsi(readText, filename) {
  try { return { status: 'observed', ...parsePsi(await readText(filename)) }; }
  catch (error) { return { status: error.code === 'ENOENT' || error.code === 'ENOTSUP' ? 'unsupported' : 'unknown' }; }
}
function parseEvents(raw) {
  const out = {};
  for (const line of raw.trim().split('\n')) {
    const m = line.match(/^(low|high|max|oom|oom_kill|oom_group_kill|sock_throttled) (\d{1,20})$/);
    if (!m || Object.hasOwn(out, m[1])) invalid();
    out[m[1]] = unsigned(m[2]).toString();
  }
  return out;
}
async function observe(options, started) {
  const read = options.readText ?? readBounded;
  const statfs = options.statfs ?? (filename => fs.statfs(filename, { bigint: true }));
  const [membership, mounts, memText, online] = await Promise.all([
    read('/proc/self/cgroup'), read('/proc/self/mountinfo'), read('/proc/meminfo'), read('/sys/devices/system/cpu/online'),
  ]);
  const host = memoryInfo(memText);
  const memory = locateHierarchy(membership, mounts, 'memory'), cpu = locateHierarchy(membership, mounts, 'cpu');
  const cpuset = locateHierarchy(membership, mounts, 'cpuset');
  let memoryLimit = host.total, available = host.available, quota = Infinity, set = parseCpuSet(online);
  const memoryEvents = {};
  let high = null;
  for (const directory of memory.paths) {
    const v2 = memory.version === 2;
    // 真实v2根没有资源controller文件；仅根且成对缺失可按内核根语义处理。
    let rawLimit, rawUsage;
    try {
      [rawLimit, rawUsage] = await Promise.all([
        read(directory + (v2 ? '/memory.max' : '/memory.limit_in_bytes')),
        read(directory + (v2 ? '/memory.current' : '/memory.usage_in_bytes')),
      ]);
    } catch (error) {
      if (!(v2 && directory === memory.mount && error.code === 'ENOENT')) throw error;
      const results = await Promise.allSettled([read(directory + '/memory.max'), read(directory + '/memory.current')]);
      if (!results.every(r => r.status === 'rejected' && r.reason.code === 'ENOENT')) throw error;
      continue;
    }
    if (!v2 && (await read(directory + '/memory.use_hierarchy')).trim() !== '1') invalid();
    const limit = parseMemoryLimit(rawLimit, memory.version), usage = unsigned(rawUsage);
    if (limit !== null) {
      memoryLimit = memoryLimit < limit ? memoryLimit : limit;
      const remaining = usage > limit ? 0n : limit - usage;
      available = available < remaining ? available : remaining;
    }
    if (v2) {
      const value = parseMemoryLimit(await read(directory + '/memory.high'));
      if (value !== null) high = high === null || value < high ? value : high;
      const events = parseEvents(await read(directory + '/memory.events'));
      // memory.events包含子树，跨祖先取最大而非重复求和。
      for (const [key, value] of Object.entries(events)) if (!(key in memoryEvents) || BigInt(value) > BigInt(memoryEvents[key])) memoryEvents[key] = value;
    }
  }
  for (const directory of cpu.paths) {
    let raw;
    if (cpu.version === 2) {
      try { raw = await read(directory + '/cpu.max'); }
      catch (error) { if (directory === cpu.mount && error.code === 'ENOENT') continue; throw error; }
    } else raw = (await read(directory + '/cpu.cfs_quota_us')).trim() + ' ' + (await read(directory + '/cpu.cfs_period_us')).trim();
    quota = Math.min(quota, parseCpuMax(raw, cpu.version));
  }
  for (const directory of cpuset.paths) {
    let raw;
    try { raw = await read(directory + (cpuset.version === 2 ? '/cpuset.cpus.effective' : '/cpuset.cpus')); }
    catch (error) { if (cpuset.version === 2 && directory === cpuset.mount && error.code === 'ENOENT') continue; throw error; }
    if (cpuset.version === 1 && !raw.trim()) continue; // v1显式继承父集合。
    set = intersectCpuSets(set, parseCpuSet(raw));
  }
  const cpuCount = Math.min(quota, set.reduce((sum, [start, end]) => sum + end - start + 1, 0));
  if (!Number.isFinite(cpuCount) || cpuCount <= 0) invalid();
  const diskPaths = options.diskPaths;
  if (!Array.isArray(diskPaths) || diskPaths.length === 0 || diskPaths.length > 16
    || diskPaths.some(p => typeof p !== 'string' || !p.startsWith('/') || p.includes('\0'))) invalid();
  const disks = await Promise.all([...new Set(diskPaths)].map(async directory => {
    const s = await statfs(directory);
    const { bsize, blocks, bfree, bavail } = s;
    if (![bsize, blocks, bfree, bavail].every(n => typeof n === 'bigint' && n >= 0n)
      || bsize === 0n || blocks === 0n || bfree > blocks || bavail > bfree) invalid();
    const used = blocks - bfree, denominator = used + bavail;
    return { free: number(bsize * bavail), used: denominator === 0n ? 100 : Number((used * 100n + denominator - 1n) / denominator) };
  }));
  const psi = Object.fromEntries(await Promise.all(['cpu', 'memory', 'io'].map(async kind => [kind, await optionalPsi(read, '/proc/pressure/' + kind)])));
  if ((await read('/proc/self/cgroup')) !== membership || (await read('/proc/self/mountinfo')) !== mounts) invalid();
  const finished = (options.now ?? Date.now)();
  if (!Number.isFinite(finished) || finished < started || finished - started >= 5000) invalid();
  return { ...unknown(new Date(started).toISOString()), status: 'observed', reason: 'execution_pool_unverified',
    cpu_cores: cpuCount, memory_limit_bytes: number(memoryLimit), memory_available_bytes: number(available),
    disk_free_bytes: Math.min(...disks.map(d => d.free)), disk_used_percent: Math.max(...disks.map(d => d.used)),
    // mount root '/' 可能只是cgroup namespace根；没有宿主证明时不声称全祖先可见。
    ancestry_visible: false, mount_root_visible: memory.rootVisible && cpu.rootVisible && cpuset.rootVisible,
    memory_high_bytes: high === null ? null : number(high), memory_events: memoryEvents, psi };
}
async function sampleLinuxResources(options = {}) {
  let timer, observedAt = '1970-01-01T00:00:00.000Z';
  try {
    const started = (options.now ?? Date.now)(); observedAt = new Date(started).toISOString();
    return await Promise.race([observe(options, started), new Promise((_, reject) => { timer = setTimeout(() => reject(Error()), 5000); })]);
  } catch { return unknown(observedAt); }
  finally { clearTimeout(timer); }
}
function projectLinuxObservation(source) {
  const base = unknown('1970-01-01T00:00:00.000Z');
  if (!source || typeof source !== 'object') return base;
  const observed = Date.parse(source.observed_at);
  if (Number.isFinite(observed)) base.observed_at = new Date(observed).toISOString();
  const numbers = ['cpu_cores', 'memory_limit_bytes', 'memory_available_bytes', 'disk_free_bytes', 'disk_used_percent'];
  if (source.status !== 'observed' || numbers.some(key => !Number.isFinite(source[key]) || source[key] < 0 || source[key] > Number.MAX_SAFE_INTEGER)
    || source.disk_used_percent > 100 || source.memory_available_bytes > source.memory_limit_bytes) return base;
  for (const key of numbers) base[key] = source[key];
  base.status = 'observed'; base.reason = 'execution_pool_unverified';
  base.mount_root_visible = source.mount_root_visible === true;
  base.memory_high_bytes = Number.isSafeInteger(source.memory_high_bytes) && source.memory_high_bytes >= 0 ? source.memory_high_bytes : null;
  for (const kind of ['cpu', 'memory', 'io']) {
    const pressure = source.psi?.[kind];
    base.psi[kind] = { status: pressure?.status === 'unsupported' ? 'unsupported' : 'unknown' };
    if (pressure?.status !== 'observed') continue;
    try {
      const lines = ['some', 'full'].filter(key => pressure[key] != null).map(key => {
        const v = pressure[key];
        return `${key} avg10=${v.avg10} avg60=${v.avg60} avg300=${v.avg300} total=${v.total_us}`;
      });
      base.psi[kind] = { status: 'observed', ...parsePsi(lines.join('\n')) };
    } catch { /* 无法验证的压力观测保留unknown。 */ }
  }
  for (const key of ['low', 'high', 'max', 'oom', 'oom_kill', 'oom_group_kill', 'sock_throttled']) {
    if (typeof source.memory_events?.[key] === 'string' && /^\d{1,20}$/.test(source.memory_events[key])) base.memory_events[key] = source.memory_events[key];
  }
  return base;
}
module.exports = { sampleLinuxResources, readBounded, projectLinuxObservation };
