import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createLocalResourceAdmission } from './local-resource-admission.cjs';

const require = createRequire(import.meta.url);
const directory = fileURLToPath(new URL('.', import.meta.url));
const installer = readFileSync(new URL('./install-fleet-worker.sh', import.meta.url), 'utf8');
// Execute the production preflight without changing host users or services.
const preflight = installer.match(/<<'NODE'\n('use strict';\n\nconst probePath = process\.argv\[2\];[\s\S]*?)\nNODE/)[1];
const GIB = 1024 ** 3;
const digest = 'sha256:' + 'a'.repeat(64);
const report = () => ({
  orbstack: { version: '2.2.1' }, docker: { available: true },
  runner: { image_digest: digest }, runtime_resources: { postgres: { available: true } },
  resources: { disk_free_bytes: 11 * GIB, disk_used_percent: 95, memory_bytes: 16 * GIB },
  worktree: { root_ready: true }, container: { probe_succeeded: true },
});
async function installResult(health) {
  let stderr = '';
  const process = {
    argv: ['node', '-', '/fixture/node-probe.cjs', digest, '450', '450', '10', directory + 'install-prerequisites.cjs'],
    env: { CECELIA_FLEET_DATA_ROOT: '/fixture/data', TMPDIR: '/fixture/tmp' },
    setgroups() {}, setgid() {}, setuid() {},
    stderr: { write(value) { stderr += value; } }, exit(code) { this.exitCode = code; },
  };
  vm.runInNewContext(preflight, { process, require: (name) => name === '/fixture/node-probe.cjs'
    ? { probeFleetWorkerHealth: async () => health } : require(name) }, { timeout: 1000 });
  await new Promise(resolve => setImmediate(resolve));
  return { code: process.exitCode ?? 0, stderr };
}

describe('保护安装与任务执行各自的磁盘前置', () => {
  it('95%占用但仍有11GiB时能安装保护，实际启动准入继续拒绝', async () => {
    expect(await installResult(report())).toEqual({ code: 0, stderr: '' });
    const samples = new Map([
      ['sysctl -n hw.ncpu', '8'], ['sysctl -n hw.memsize', String(16 * GIB)],
      ['sysctl -n vm.loadavg', '{ 1.0 0.8 0.6 }'],
      ['memory_pressure -Q', 'System-wide memory free percentage: 60%'],
      ['docker info --format {{json .}}', JSON.stringify({ NCPU: 8, MemTotal: 12 * GIB })],
      ['df -kP /fixture/data', 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/test 239362496 187781316 11468200 95% /fixture/data'],
    ]);
    const admit = createLocalResourceAdmission({
      workerId: 'xian-mac-m1', platform: 'darwin', diskPaths: ['/fixture/data'],
      loadProfile: () => ({ machine_id: 'xian-mac-m1', resources: {
        cpu_cores: 6, memory_gib: 8, disk_min_free_gib: 10,
        disk_max_used_percent: 85, cpu_pressure_max_percent: 90, memory_pressure_max_percent: 90,
      } }),
      runCommand: async (file, args) => ({ stdout: samples.get([file, ...args].join(' ')) }),
    });
    await expect(admit()).rejects.toMatchObject({ statusCode: 429, message: 'attempt_local_resources_unavailable' });
  });
  it.each([
    { disk_free_bytes: 9 * GIB }, { disk_free_bytes: undefined }, { disk_free_bytes: Infinity },
    { disk_used_percent: undefined }, { disk_used_percent: NaN }, { disk_used_percent: Infinity },
    { disk_used_percent: -1 }, { disk_used_percent: 101 },
  ])('缺采样、无效值或低于安装余量仍拒绝 %j', async (patch) => {
    const health = report(); Object.assign(health.resources, patch);
    expect(await installResult(health)).toEqual({ code: 1, stderr: 'prerequisite_disk\n' });
  });
  it.each(['orbstack', 'docker', 'runner', 'postgres', 'memory', 'repository_access', 'container'])(
    '保留%s前置失败', async (kind) => {
      const health = report(); health.resources.disk_used_percent = 50;
      if (kind === 'orbstack') health.orbstack.version = 'unavailable';
      if (kind === 'docker') health.docker.available = false;
      if (kind === 'runner') health.runner.image_digest = 'wrong';
      if (kind === 'postgres') health.runtime_resources.postgres.available = false;
      if (kind === 'memory') health.resources.memory_bytes = 4 * GIB;
      if (kind === 'repository_access') health.worktree.root_ready = false;
      if (kind === 'container') health.container.probe_succeeded = false;
      const expected = kind === 'runner' ? 'runner_digest' : kind;
      expect(await installResult(health)).toEqual({ code: 1, stderr: `prerequisite_${expected}\n` });
    },
  );
});
