'use strict';
const { createLocalResourceAdmission } = require('./local-resource-admission.cjs');
const registry = require('../../config/fleet-node-profiles.json');
const profile = registry.profiles.find((entry) => entry.machine_id === 'us-mac-m4');
function fixture(overrides = {}) {
  const outputs = {
    'sysctl -n hw.ncpu': '8',
    'sysctl -n hw.memsize': String(16 * 1024 ** 3),
    'sysctl -n vm.loadavg': '{ 1.20 0.80 0.50 }',
    'memory_pressure -Q': 'System-wide memory free percentage: 60%',
    'df -kP /controlled': 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/test 100000000 10000000 90000000 10% /controlled',
    'docker info --format {{json .}}': JSON.stringify({ NCPU: 8, MemTotal: 12 * 1024 ** 3 }),
    ...overrides,
  };
  const runCommand = vi.fn(async (file, args) => {
    const value = outputs[[file, ...args].join(' ')];
    if (value instanceof Error) throw value;
    return { stdout: value ?? '' };
  });
  return { runCommand, guard: createLocalResourceAdmission({
    workerId: 'us-mac-m4', diskPaths: ['/controlled'], platform: 'darwin',
    loadProfile: () => profile, runCommand,
  }) };
}
describe('本机即时资源准入', () => {
  it('使用整机策略且只运行只读轻量命令，不缓存旧采样', async () => {
    const { guard, runCommand } = fixture();
    await guard(); await guard();
    expect(runCommand).toHaveBeenCalledTimes(12);
    expect(runCommand.mock.calls.every(([, , options]) => options.timeout > 0 && options.shell === false)).toBe(true);
    expect(runCommand.mock.calls.some(([, args]) => args.includes('run'))).toBe(false);
  });
  it.each([
    ['sysctl -n hw.ncpu', '0'], ['sysctl -n hw.ncpu', '-8'],
    ['sysctl -n hw.memsize', ''], ['sysctl -n vm.loadavg', '{ -1.2 0 0 }'],
    ['sysctl -n vm.loadavg', '{ 8.0 0 0 }'],
    ['memory_pressure -Q', 'System-wide memory free percentage: 200%'],
    ['memory_pressure -Q', 'System-wide memory free percentage: -1%'],
    ['memory_pressure -Q', 'System-wide memory free percentage: 9%'],
    ['memory_pressure -Q', 'unknown'],
    ['df -kP /controlled', 'Filesystem\n/dev/test 10000 9900 100 99% /controlled'],
    ['df -kP /controlled', 'Filesystem\n/dev/test 10000 0 -1 0% /controlled'],
    ['docker info --format {{json .}}', '{}'],
    ['docker info --format {{json .}}', 'not json'],
    ['docker info --format {{json .}}', '{"NCPU":8,"MemTotal":0}'],
    ['docker info --format {{json .}}', new Error('EAGAIN sensitive stderr')],
  ])('%s返回非法或高压值时拒绝', async (key, value) => {
    await expect(fixture({ [key]: value }).guard()).rejects.toMatchObject({
      message: 'attempt_local_resources_unavailable', statusCode: 429,
    });
  });
  it('任一采样命令失败都不能按零压力放行', async () => {
    const { runCommand } = fixture();
    for (let failure = 0; failure < 6; failure++) {
      let count = 0;
      const guard = createLocalResourceAdmission({ workerId: 'us-mac-m4', diskPaths: ['/controlled'],
        platform: 'darwin', loadProfile: () => profile,
        runCommand: (...args) => count++ === failure ? Promise.reject(new Error('timeout')) : runCommand(...args),
      });
      await expect(guard()).rejects.toMatchObject({ statusCode: 429 });
    }
  });
  it('缺失策略、机器身份不符或未知平台均拒绝', async () => {
    for (const options of [{ loadProfile: () => null }, { workerId: 'unknown' }, { platform: 'linux' }]) {
      const guard = createLocalResourceAdmission({ workerId: 'us-mac-m4', diskPaths: ['/controlled'],
        platform: 'darwin', loadProfile: () => profile, runCommand: fixture().runCommand, ...options });
      await expect(guard()).rejects.toMatchObject({ statusCode: 429 });
    }
  });
});
