'use strict';
const { sampleLinuxResources } = require('./linux-resource-probe.cjs');
const GIB = 1024n ** 3n;
function fixture() {
  const files = {
    '/proc/self/cgroup': '0::/pool/job\n',
    '/proc/self/mountinfo': '29 23 0:26 / /cg rw - cgroup2 cgroup rw\n',
    '/proc/meminfo': 'MemTotal: 16777216 kB\nMemAvailable: 12582912 kB\n',
    '/sys/devices/system/cpu/online': '0-7\n',
  };
  for (const [dir, max, current, quota, cpus] of [
    ['/cg', 'max', 2, 'max 100000', '0-7'],
    ['/cg/pool', String(8n * GIB), 7, '50000 100000', '0-3'],
    ['/cg/pool/job', String(4n * GIB), 1, '200000 100000', '2-5'],
  ]) Object.assign(files, {
    [dir + '/memory.max']: max, [dir + '/memory.current']: String(BigInt(current) * GIB),
    [dir + '/cpu.max']: quota, [dir + '/cpuset.cpus.effective']: cpus,
    [dir + '/memory.high']: 'max', [dir + '/memory.events']: 'low 0\nhigh 2\nmax 0\noom 0\noom_kill 0\n',
  });
  for (const kind of ['cpu', 'memory', 'io']) files['/proc/pressure/' + kind] = 'some avg10=1.00 avg60=0.00 avg300=0.00 total=10\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n';
  const readText = async filename => {
    if (!(filename in files)) throw Object.assign(Error('missing'), { code: 'ENOENT' });
    return files[filename];
  };
  const statfs = async target => ({ bsize: 4096n, blocks: 10000n, bfree: 4000n, bavail: target === '/data' ? 1000n : 3000n });
  return { files, options: { readText, statfs, now: () => 1720000000000, diskPaths: ['/data', '/tmp'] } };
}
describe('Linux资源观测不授予执行权限', () => {
  it('取所有可见祖先和宿主上界，0.5核不抬高，父层剩余内存也约束子层', async () => {
    const { options } = fixture(); const out = await sampleLinuxResources(options);
    expect(out).toMatchObject({ status: 'observed', scope: 'observer_cgroup', execution: false, pool_verified: false,
      cpu_cores: 0.5, memory_limit_bytes: Number(4n * GIB), memory_available_bytes: Number(GIB),
      disk_free_bytes: 4096000, disk_used_percent: 86 });
    expect(out.psi.memory.some.avg10).toBe(1);
    expect(out.memory_events.high).toBe('2');
    expect(out.gpu.status).toBe('unknown');
    expect(out.ancestry_visible).toBe(false); // namespace根不能证明宿主祖先全部可见。
  });
  it('v2 max明确无上限，宿主MemAvailable约束剩余；超限已有使用量得到0余量', async () => {
    const { files, options } = fixture();
    files['/cg/pool/memory.current'] = String(9n * GIB);
    expect((await sampleLinuxResources(options)).memory_available_bytes).toBe(0);
  });
  it('缺失控制器、读取失败、途中迁移和时钟失真均返回未知', async () => {
    for (const mutation of ['missing', 'denied', 'moved', 'clock']) {
      const { files, options } = fixture();
      if (mutation === 'missing') delete files['/cg/pool/memory.max'];
      if (mutation === 'denied') options.readText = async () => { throw Object.assign(Error('secret-path'), { code: 'EACCES' }); };
      if (mutation === 'moved') { const read = options.readText; let n = 0; options.readText = p => p === '/proc/self/cgroup' && ++n > 1 ? Promise.resolve('0::/other\n') : read(p); }
      if (mutation === 'clock') { let n = 0; options.now = () => n++ ? 1720000005001 : 1720000000000; }
      const out = await sampleLinuxResources(options);
      expect(out.status).toBe('unknown'); expect(out.execution).toBe(false); expect(out.cpu_cores).toBe(0);
      expect(JSON.stringify(out)).not.toContain('secret-path');
    }
  });
  it('PSI明确不支持和读取错误分开，不伪填0压力', async () => {
    const { options } = fixture(); const read = options.readText;
    options.readText = async p => {
      if (p === '/proc/pressure/cpu') throw Object.assign(Error(), { code: 'ENOENT' });
      if (p === '/proc/pressure/io') throw Object.assign(Error(), { code: 'EACCES' });
      return read(p);
    };
    const out = await sampleLinuxResources(options);
    expect(out.psi.cpu).toEqual({ status: 'unsupported' }); expect(out.psi.io).toEqual({ status: 'unknown' });
    expect(out.execution).toBe(false);
  });
  it('v1分离controller和cpuset继承，非层级内存保守未知', async () => {
    const { files, options } = fixture();
    files['/proc/self/cgroup'] = '3:cpu,cpuacct:/job\n4:memory:/job\n5:cpuset:/job\n';
    files['/proc/self/mountinfo'] = ['cpu', 'memory', 'cpuset'].map((v, i) => `${30 + i} 23 0:${30 + i} / /v1/${v} rw - cgroup cgroup rw,${v}`).join('\n');
    for (const suffix of ['', '/job']) {
      const c = '/v1/cpu' + suffix, m = '/v1/memory' + suffix, s = '/v1/cpuset' + suffix;
      files[c + '/cpu.cfs_quota_us'] = suffix ? '50000' : '-1'; files[c + '/cpu.cfs_period_us'] = '100000';
      files[m + '/memory.limit_in_bytes'] = suffix ? String(2n * GIB) : '9223372036854771712';
      files[m + '/memory.usage_in_bytes'] = String(GIB); files[m + '/memory.use_hierarchy'] = '1';
      files[s + '/cpuset.cpus'] = suffix ? '' : '0-3';
    }
    expect(await sampleLinuxResources(options)).toMatchObject({ status: 'observed', cpu_cores: 0.5, memory_available_bytes: Number(GIB), execution: false });
    files['/v1/memory/memory.use_hierarchy'] = '0';
    expect((await sampleLinuxResources(options)).status).toBe('unknown');
  });
});
