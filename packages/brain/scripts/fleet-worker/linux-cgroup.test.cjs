'use strict';
const { parseCpuSet, intersectCpuSets, parseCpuMax, parseMemoryLimit, parsePsi, locateHierarchy } = require('./linux-cgroup.cjs');

describe('Linux cgroup 有界解析', () => {
  it('CPU列表去重且实际求交，不以数量最小值冒充交集', () => {
    expect(parseCpuSet('0-3,2-5,8')).toEqual([[0, 5], [8, 8]]);
    expect(intersectCpuSets(parseCpuSet('0-2,6'), parseCpuSet('2-4,7'))).toEqual([[2, 2]]);
    expect(() => parseCpuSet('3-1')).toThrow('linux_resource_invalid');
    expect(() => parseCpuSet('0-999999999')).toThrow('linux_resource_invalid');
  });
  it('CPU分数不抬高；v1 -1/v2 max是无上限，损坏不是无限制', () => {
    expect(parseCpuMax('50000 100000')).toBe(0.5);
    expect(parseCpuMax('max 100000')).toBe(Infinity);
    expect(parseCpuMax('-1 100000', 1)).toBe(Infinity);
    for (const raw of ['-1 100000', '1000 0', 'NaN 100000', '1 2 3']) expect(() => parseCpuMax(raw)).toThrow('linux_resource_invalid');
  });
  it('内存整数和v1无限哨兵不经过不精确的浮点转换', () => {
    expect(parseMemoryLimit('1073741824')).toBe(1073741824n);
    expect(parseMemoryLimit('max')).toBe(null);
    expect(parseMemoryLimit('9223372036854771712', 1)).toBe(null);
    expect(parseMemoryLimit('9223372036854771712', 2)).toBe(9223372036854771712n);
    for (const raw of ['-1', '1e9', '1.5', '']) expect(() => parseMemoryLimit(raw)).toThrow('linux_resource_invalid');
  });
  it('PSI保留some/full独立压力，不把压力当CPU利用率', () => {
    const p = parsePsi('some avg10=2.00 avg60=1.20 avg300=0.20 total=1234\nfull avg10=0.01 avg60=0.00 avg300=0.00 total=5\n');
    expect(p.some.avg10).toBe(2); expect(p.full.total_us).toBe('5');
    expect(parsePsi('some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n').full).toBe(null);
    expect(() => parsePsi('some avg10=101 avg60=0 avg300=0 total=0')).toThrow('linux_resource_invalid');
    expect(() => parsePsi('')).toThrow('linux_resource_invalid');
  });
  it('v2 挂载转义、路径映射与完整可见祖先', () => {
    const mount = '29 23 0:26 / /sys/fs/cgroup\\040pool rw - cgroup2 cgroup rw\n';
    const h = locateHierarchy('0::/jobs/a\n', mount, 'memory');
    expect(h).toMatchObject({ version: 2, rootVisible: true, mount: '/sys/fs/cgroup pool' });
    expect(h.paths).toEqual(['/sys/fs/cgroup pool/jobs/a', '/sys/fs/cgroup pool/jobs', '/sys/fs/cgroup pool']);
  });
  it('v1 controllers分开映射，挂载子树绝不声称可见全祖先', () => {
    const mounts = '29 23 0:26 /parent /cg/memory rw - cgroup cgroup rw,memory\n30 23 0:27 / /cg/cpu rw - cgroup cgroup rw,cpu,cpuacct\n';
    const membership = '5:memory:/parent/job\n4:cpu,cpuacct:/job\n';
    expect(locateHierarchy(membership, mounts, 'memory')).toEqual({ version: 1, rootVisible: false, mount: '/cg/memory', paths: ['/cg/memory/job', '/cg/memory'] });
    expect(locateHierarchy(membership, mounts, 'cpu').paths).toEqual(['/cg/cpu/job', '/cg/cpu']);
  });
  it('拒绝路径逃逸、模糊挂载和不存在的controller', () => {
    const mount = '29 23 0:26 / /cg rw - cgroup2 cgroup rw\n';
    expect(() => locateHierarchy('0::/../escape\n', mount, 'memory')).toThrow('linux_resource_invalid');
    expect(() => locateHierarchy('0::/x\n', mount + mount, 'memory')).toThrow('linux_resource_invalid');
    expect(() => locateHierarchy('3:cpu:/x\n', '29 23 0:26 / /cg rw - cgroup cgroup rw,cpu\n', 'memory')).toThrow('linux_resource_invalid');
  });
  it('混合v1/v2时显式v1 controller优先；cgroup成员路径不按mountinfo规则解码', () => {
    const membership = '0::/unified\n3:cpu:/job\\040literal\n';
    const mounts = '29 23 0:26 / /v2 rw - cgroup2 cgroup rw\n30 23 0:27 / /v1 rw - cgroup cgroup rw,cpu\n';
    expect(locateHierarchy(membership, mounts, 'cpu').paths[0]).toBe('/v1/job\\040literal');
  });
});
