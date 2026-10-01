import { expect, it } from 'vitest';
import probe from '../../../packages/brain/scripts/fleet-worker/node-probe.cjs';
import { evaluateBaseAdmission } from '../../../packages/brain/src/orchestrator/fleet-node/node-admission.js';
import { getDeploymentNodeProfile } from '../../../packages/brain/src/orchestrator/fleet-node/node-profile.js';

it('F1造完真验：Linux观测不借现有Mac身份获得执行容量', async () => {
  let commands = 0;
  const now = Date.now();
  const report = await probe.probeFleetWorkerHealth({ platform: 'linux', machineId: 'us-mac-m4', now: () => now,
    execFileFn: async () => { commands++; throw Error('unexpected command'); },
    linuxResourceOptions: { readText: async () => { throw Error('scope unavailable'); } }, diskPaths: ['/tmp'] });
  expect(commands).toBe(0);
  expect(report.linux_observation.execution).toBe(false);
  expect(report.resources.cpu_cores).toBe(0);
  // 即使观测副本出现很大的数值，也不能代替经授权的核心容量。
  report.linux_observation.cpu_cores = 128; report.linux_observation.memory_available_bytes = 2 ** 40;
  const admission = evaluateBaseAdmission(report, { profile: getDeploymentNodeProfile('us-mac-m4'), nowMs: now });
  expect(admission.base_admitted).toBe(false); expect(admission.dispatch_ready).toBe(false);
});

it('可信Linux安装器在宿主平台不符时零副作用拒绝，不提供授权入口', async () => {
  const { installLinuxPool } = await import('../../../packages/brain/scripts/fleet-worker/linux-pool-installer.cjs');
  let commands = 0;
  await expect(installLinuxPool({}, { platform: 'darwin', getuid: () => 0,
    runCommand: async () => { commands++; } })).rejects.toThrow('linux_pool_install_root_linux_required');
  expect(commands).toBe(0);
});
