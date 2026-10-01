'use strict';
const { probeFleetWorkerHealth } = require('./node-probe.cjs');
const { createFleetWorkerServer } = require('./fleet-worker.cjs');
const { createLocalResourceAdmission } = require('./local-resource-admission.cjs');
const request = require('supertest');

it('Linux健康探针不运行Mac命令或创建自检容器，观测不授予容量', async () => {
  const execFileFn = vi.fn(async () => ({ stdout: '' }));
  const report = await probeFleetWorkerHealth({ platform: 'linux', machineId: 'pending-linux', execFileFn,
    makeTempDirFn: async () => { throw Error('no side effects'); }, fetchFn: async () => ({ ok: false }),
    linuxResourceOptions: { readText: async () => { throw Error('unknown'); } }, diskPaths: ['/tmp'] });
  expect(execFileFn).not.toHaveBeenCalled();
  expect(report.linux_observation).toMatchObject({ status: 'unknown', execution: false, pool_verified: false });
  expect(report.resources).toMatchObject({ cpu_cores: 0, memory_bytes: 0, disk_used_percent: 100 });
  expect(report.container.probe_succeeded).toBe(false);
});

it('真实HTTP投影保留Linux有界观测但不能透传授权字段或任意正文', async () => {
  const linux = { schema_version: 'linux-resource-observation/v1', observed_at: '2026-10-01T00:00:00.000Z',
    status: 'observed', cpu_cores: 0.5, memory_limit_bytes: 1024, memory_available_bytes: 256,
    disk_free_bytes: 1000, disk_used_percent: 50, ancestry_visible: true,
    scope: 'verified_pool', execution: true, pool_verified: true, secret: 'must-not-leak',
    psi: { memory: { status: 'observed', scope: 'verified_pool', some: { avg10: 2, avg60: 1, avg300: 0, total_us: '123' }, full: null } } };
  const server = createFleetWorkerServer({ probeHealth: async () => ({ linux_observation: linux, os: { version: 'Linux' } }) });
  const response = await request(server).get('/health');
  expect(response.status).toBe(200);
  expect(response.body.linux_observation).toMatchObject({ cpu_cores: 0.5, scope: 'observer_cgroup', execution: false, pool_verified: false });
  expect(response.body.linux_observation.psi.memory.some.avg10).toBe(2);
  expect(response.body.linux_observation.psi.memory.scope).toBe('system');
  expect(response.text).not.toContain('must-not-leak');
  expect(response.body.resources.cpu_cores).toBe(0);
});

it('观测通过不改变Linux实际启动拒绝', async () => {
  const runCommand = vi.fn();
  await expect(createLocalResourceAdmission({ platform: 'linux', workerId: 'pending-linux', diskPaths: ['/tmp'], runCommand })()).rejects.toThrow('attempt_local_resources_unavailable');
  expect(runCommand).not.toHaveBeenCalled();
});
