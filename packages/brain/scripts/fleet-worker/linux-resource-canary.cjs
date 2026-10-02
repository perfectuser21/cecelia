'use strict';
// 仅验证采样容器自身，不能作为宿主/执行池授权证明。
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const run = promisify(execFile);
const image = process.env.LINUX_RESOURCE_CANARY_IMAGE;
const canaryId = randomUUID();
let containerId;
const command = args => run('docker', args, { encoding: 'utf8', timeout: 25000, maxBuffer: 65536 });
async function inspect(id) {
  try { return JSON.parse((await command(['inspect', id])).stdout)[0]; }
  catch (error) { if (/no such (object|container)/i.test(String(error.stderr))) return null; throw error; }
}
async function main() {
  assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/);
  const program = `
    const assert = require('node:assert/strict');
    require('/probe/linux-resource-probe.cjs').sampleLinuxResources({diskPaths:['/tmp']}).then(report => {
      assert.equal(report.status, 'observed');
      assert.equal(report.cpu_cores, 0.5);
      assert.equal(report.memory_limit_bytes, 128 * 1024 ** 2);
      assert.ok(report.memory_available_bytes >= 0 && report.memory_available_bytes <= report.memory_limit_bytes);
      assert.equal(report.execution, false); assert.equal(report.pool_verified, false);
      assert.equal(report.ancestry_visible, false);
      console.log(JSON.stringify(report));
    }).catch(() => { console.error('linux_canary_assertion_failed'); process.exitCode=1; });`;
  const args = ['create', '--name', `cecelia-linux-probe-${canaryId}`, '--label', `cecelia.linux-probe.canary=${canaryId}`,
    '--network=none', '--cpus=0.5', '--memory=128m', '--memory-swap=128m', '--pids-limit=64',
    '--read-only', '--tmpfs=/tmp:rw,noexec,nosuid,size=8m', '--user=1000:1000', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--log-driver=none'];
  for (const file of ['linux-cgroup.cjs', 'linux-resource-probe.cjs']) {
    args.push('--mount', `type=bind,src=${path.join(__dirname, file)},dst=/probe/${file},readonly`);
  }
  const created = (await command([...args, '--entrypoint=node', image, '-e', program])).stdout.trim();
  assert.match(created, /^[a-f0-9]{64}$/); containerId = created;
  const config = await inspect(containerId);
  assert.equal(config.Config.Labels['cecelia.linux-probe.canary'], canaryId);
  assert.equal(config.HostConfig.NanoCpus, 500000000); assert.equal(config.HostConfig.Memory, 134217728);
  assert.equal(config.HostConfig.MemorySwap, 134217728); assert.equal(config.HostConfig.PidsLimit, 64);
  assert.equal(config.HostConfig.NetworkMode, 'none'); assert.equal(config.Mounts.length, 2);
  assert.ok(config.Mounts.every(m => m.Type === 'bind' && m.RW === false && m.Destination.startsWith('/probe/')));
  const report = JSON.parse((await command(['start', '-a', containerId])).stdout.trim());
  const finished = await inspect(containerId);
  assert.equal(finished.State.ExitCode, 0); assert.equal(finished.State.Running, false);
  console.log(JSON.stringify({ result: 'PASS', canary_id: canaryId, container_id: containerId, image,
    scope: 'observer_cgroup', cpu_cores: report.cpu_cores, memory_limit_bytes: report.memory_limit_bytes,
    execution: false, pool_verified: false, model_calls: 0 }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (!containerId) return;
  const existing = await inspect(containerId);
  if (existing?.Id !== containerId || existing.Config.Labels['cecelia.linux-probe.canary'] !== canaryId) return;
  if (existing.State.Running) await command(['stop', '--time', '3', containerId]);
  await command(['rm', containerId]); assert.equal(await inspect(containerId), null);
});
