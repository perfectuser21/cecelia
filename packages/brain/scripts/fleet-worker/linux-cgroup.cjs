'use strict';
const path = require('node:path').posix;
const invalid = () => { throw new Error('linux_resource_invalid'); };
function bounded(raw) {
  if (typeof raw !== 'string' || raw.length > 65536 || raw.includes('\0')) invalid();
  return raw;
}
const text = raw => bounded(raw).trim();
function unsigned(raw) {
  const value = text(raw);
  if (!/^\d{1,20}$/.test(value)) invalid();
  return BigInt(value);
}
function parseCpuSet(raw) {
  const tokens = text(raw).split(',');
  if (tokens.length > 4096) invalid();
  const ranges = tokens.map(token => {
    const m = token.match(/^(\d{1,7})(?:-(\d{1,7}))?$/);
    if (!m) invalid();
    const start = Number(m[1]), end = Number(m[2] ?? m[1]);
    if (end < start || end > 1048575) invalid();
    return [start, end];
  }).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of ranges) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
function intersectCpuSets(a, b) {
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i][0], b[j][0]), end = Math.min(a[i][1], b[j][1]);
    if (start <= end) out.push([start, end]);
    if (a[i][1] < b[j][1]) i++; else j++;
  }
  return out;
}
function parseCpuMax(raw, version = 2) {
  const fields = text(raw).split(/\s+/);
  if (fields.length !== 2) invalid();
  const period = unsigned(fields[1]);
  if (period === 0n || period > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
  if ((version === 2 && fields[0] === 'max') || (version === 1 && fields[0] === '-1')) return Infinity;
  const quota = unsigned(fields[0]);
  if (quota === 0n || quota > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
  return Number(quota) / Number(period);
}
function parseMemoryLimit(raw, version = 2) {
  if (version === 2 && text(raw) === 'max') return null;
  const value = unsigned(raw);
  // Linux v1 PAGE_COUNTER_MAX 常见哨兵；它不是实际可调度内存。
  return version === 1 && value >= (1n << 60n) ? null : value;
}
function parsePsi(raw) {
  const result = { some: null, full: null };
  for (const line of text(raw).split('\n')) {
    const m = line.match(/^(some|full) avg10=(\d+(?:\.\d+)?) avg60=(\d+(?:\.\d+)?) avg300=(\d+(?:\.\d+)?) total=(\d{1,20})$/);
    if (!m || result[m[1]]) invalid();
    const values = m.slice(2, 5).map(Number);
    if (values.some(value => !Number.isFinite(value) || value > 100)) invalid();
    result[m[1]] = { avg10: values[0], avg60: values[1], avg300: values[2], total_us: unsigned(m[5]).toString() };
  }
  if (!result.some) invalid();
  return result;
}
function absolute(raw, decode = true) {
  const value = decode ? raw.replace(/\\(040|011|012|134)/g, (_, octal) => String.fromCharCode(parseInt(octal, 8))) : raw;
  if (!decode && value.trim() !== value) invalid();
  if (!value.startsWith('/') || value.includes('\0') || value.split('/').some(p => p === '..' || p === '.')) invalid();
  return path.normalize(value);
}
function locateHierarchy(cgroup, mountinfo, controller) {
  if (!['memory', 'cpu', 'cpuset'].includes(controller)) invalid();
  const memberships = bounded(cgroup).replace(/\n$/, '').split('\n').map(line => {
    const m = line.match(/^(\d+):([^:]*):(\/.*)$/);
    if (!m) invalid();
    return { version: m[1] === '0' && !m[2] ? 2 : 1, controllers: m[2].split(','), member: absolute(m[3], false) };
  });
  const mounts = text(mountinfo).split('\n').map(line => {
    const fields = line.split(' - ');
    if (fields.length !== 2) invalid();
    const before = fields[0].split(' '), after = fields[1].split(' ');
    if (before.length < 6 || after.length < 3) invalid();
    return { type: after[0], root: absolute(before[3]), mount: absolute(before[4]), controllers: after[2].split(',') };
  });
  const candidates = [];
  const explicitV1 = memberships.some(m => m.version === 1 && m.controllers.includes(controller));
  for (const membership of memberships) for (const mount of mounts) {
    if (explicitV1 && membership.version === 2) continue;
    if (membership.version === 2 ? mount.type !== 'cgroup2'
      : mount.type !== 'cgroup' || !membership.controllers.includes(controller) || !mount.controllers.includes(controller)) continue;
    const { member, version } = membership;
    if (mount.root !== '/' && member !== mount.root && !member.startsWith(mount.root + '/')) continue;
    const relative = mount.root === '/' ? member.slice(1) : member.slice(mount.root.length).replace(/^\//, '');
    let directory = path.join(mount.mount, relative);
    const paths = [];
    while (true) {
      if (paths.length >= 128 || (directory !== mount.mount && !directory.startsWith(mount.mount + '/'))) invalid();
      paths.push(directory);
      if (directory === mount.mount) break;
      directory = path.dirname(directory);
    }
    candidates.push({ version, rootVisible: mount.root === '/', mount: mount.mount, paths });
  }
  // 多个匹配挂载或混合controller来源不能靠顺序猜测。
  if (candidates.length !== 1) invalid();
  return candidates[0];
}
module.exports = { parseCpuSet, intersectCpuSets, parseCpuMax, parseMemoryLimit, parsePsi, locateHierarchy, unsigned };
