import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

it('Linux验收canary只能走root完整宿主入口，不能由普通采样请求启动', async () => {
  const { runLinuxPoolCanary } = await import('../../../packages/brain/scripts/fleet-worker/linux-pool-canary.cjs');
  let commands = 0;
  await expect(runLinuxPoolCanary({ nonce: 'a'.repeat(64) }, { platform: 'linux', getuid: () => 501,
    lockHeld: true, runCommand: async () => { commands++; } })).rejects.toThrow('linux_pool_canary_unconfirmed');
  expect(commands).toBe(0);
});

it('脚本容器事实证明不提供授权；缺持久身份即拒绝，不能复用pool-canary名字绕过', async () => {
  const { collectLinuxScriptProof } = await import('../../../packages/brain/scripts/fleet-worker/linux-pool-proof.cjs');
  let commands = 0;
  await expect(collectLinuxScriptProof({ profile: {}, identity: {}, containerId: 'a'.repeat(64),
    deps: { runCommand: async () => { commands++; } } })).rejects.toThrow('linux_script_proof_unavailable');
  expect(commands).toBe(0);
});

it('Linux接入自动准备工具链和账号的真实产物合同持续验收，仍仅pending', () => {
  const script = fileURLToPath(new URL('../../../packages/brain/scripts/fleet-worker/linux-pool-bootstrap.test.py', import.meta.url));
  expect(() => execFileSync('python3', [script, 'BootstrapTests.test_missing_account_and_old_host_node_need_no_manual_setup'],
    { encoding: 'utf8', timeout: 30000 })).not.toThrow();
});
