'use strict';
// 专属随机容器/卷的离线真实 canary；不读宿主 HOME/凭据，不调用模型，不开放生产 API。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID, createHash } = require('node:crypto');
const { createAppServerDocker } = require('./app-server-docker.cjs');
const { createAppServerRunner } = require('./app-server-runner.cjs');
const { profileDigest } = require('./app-server-profile.cjs');
const run = promisify(execFile);
const image = process.env.APP_SERVER_CANARY_IMAGE || 'sha256:aeaf290525a623a2182fdce5376ca914e9de2d0b1bab0ba18d7d07b9ea379033';
const tag = randomUUID(), hash = value => createHash('sha256').update(value).digest('hex');
const profile = { image, cpus: 1, memoryBytes: 536870912, pidsLimit: 64, user: '1000:1000', tmpBytes: 33554432,
  network: 'none', homeKey: hash(`${tag}:home`), workspaceKey: hash(`${tag}:workspace`) };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appserver-canary-'));
const docker = createAppServerDocker();
const bootId = randomUUID(), machineId = 'canary-machine', workerId = 'canary-worker';
const generations = [], volumes = [];
const command = args => run('docker', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1048576 });
const runner = createAppServerRunner({ stateRoot: root, machineId, workerId, bootId, profiles: { canary: profile }, docker,
  assertLocalResources: async () => {} }); // 本机准入拒绝由单测覆盖；canary固定低配额隔离资源。
const input = () => ({ reservation_id: randomUUID(), intent_id: randomUUID(), launch_generation: 1,
  machine_id: machineId, worker_id: workerId, worker_boot_id: bootId, owner_key: `openclaw-${profile.homeKey}`,
  profile: 'canary', config_digest: profileDigest(profile) });
async function initialize(identity) {
  const stream = await runner.attach({ ...identity, stream_id: randomUUID() });
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('appserver_canary_initialize_timeout')), 15000);
    stream.once('close', () => { clearTimeout(timer); reject(new Error('appserver_canary_stream_closed')); });
    stream.once('error', () => { clearTimeout(timer); reject(new Error('appserver_canary_stream_error')); });
    stream.stdout.on('data', frame => {
      for (const line of frame.toString().split('\n').filter(Boolean)) {
        const value = JSON.parse(line);
        if (value.id === 1) { clearTimeout(timer); resolve(value); }
      }
    });
  });
  stream.stdin.write(JSON.stringify({ id: 1, method: 'initialize', params: {
    clientInfo: { name: 'cecelia_appserver_canary', title: 'Cecelia offline canary', version: '1.0.0' },
  } }) + '\n');
  const value = await response;
  assert.ok(value.result && !value.error, 'initialize must return a result');
  stream.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  return stream;
}
async function main() {
  for (const [kind, key] of [['home', profile.homeKey], ['workspace', profile.workspaceKey]]) {
    const name = `cecelia-appserver-${kind}-${key}`;
    await command(['volume', 'create', '--label', `cecelia.appserver.kind=${kind}`, '--label', `cecelia.appserver.key=${key}`,
      '--label', `cecelia.appserver.canary=${tag}`, name]); volumes.push(name);
  }
  await command(['run', '--rm', `--name=cecelia-appserver-canary-init-${tag}`, `--label=cecelia.appserver.canary=${tag}`,
    '--network=none', '--user=0:0', '--read-only', '--entrypoint=/bin/sh',
    `--mount=type=volume,src=${volumes[0]},dst=/home/runner`, `--mount=type=volume,src=${volumes[1]},dst=/workspace`,
    image, '-c', 'mkdir -p /home/runner/.codex && chown 1000:1000 /home/runner /home/runner/.codex /workspace']);
  for (let generation = 0; generation < 2; generation++) {
    const identity = input(); const state = await runner.start(identity); generations.push({ identity, state });
    assert.equal(state.status, 'running');
    const inspected = JSON.parse((await command(['inspect', state.container_id])).stdout)[0];
    assert.equal(inspected.HostConfig.Memory, profile.memoryBytes); assert.equal(inspected.HostConfig.MemorySwap, profile.memoryBytes);
    assert.equal(inspected.HostConfig.NanoCpus, 1e9); assert.equal(inspected.HostConfig.PidsLimit, 64);
    assert.equal(inspected.HostConfig.LogConfig.Type, 'none'); assert.equal(inspected.Config.Tty, false);
    assert.equal(inspected.HostConfig.ReadonlyRootfs, true); assert.equal(inspected.HostConfig.NetworkMode, 'none');
    assert.equal(inspected.Config.User, '1000:1000'); assert.deepEqual(inspected.HostConfig.CapDrop, ['ALL']);
    assert.equal(inspected.Mounts.filter(m => m.Type === 'bind').length, 0);
    assert.ok(inspected.Mounts.every(m => m.Type === 'volume' && volumes.includes(m.Name)));
    const connection = await initialize(identity);
    if (generation === 0) await command(['exec', state.container_id, 'node', '-e',
      'require("fs").writeFileSync("/home/runner/canary-marker",process.argv[1])', tag]);
    else assert.equal((await command(['exec', state.container_id, 'cat', '/home/runner/canary-marker'])).stdout, tag);
    connection.kill();
    await runner.cancel({ ...identity, container_id: state.container_id, challenge: randomUUID() });
    assert.equal(await docker.inspect(state.container_id), null);
    assert.equal(JSON.parse((await command(['volume', 'inspect', volumes[0]])).stdout)[0].Name, volumes[0]);
  }
  console.log(JSON.stringify({ result: 'PASS', image, generations: 2, initialize: true, bounded_stdio: true,
    resource_limits: true, home_preserved: true, host_mounts: 0, model_calls: 0 }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  runner.close();
  for (const { identity, state } of generations) {
    const existing = await docker.inspect(state.container_id).catch(() => null);
    if (existing && existing.labels['cecelia.appserver.reservation_id'] === identity.reservation_id) await docker.remove(existing.id);
  }
  for (const name of volumes) {
    const resource = JSON.parse((await command(['volume', 'inspect', name])).stdout)[0];
    if (resource.Labels['cecelia.appserver.canary'] === tag) await command(['volume', 'rm', name]);
  }
  fs.rmSync(root, { recursive: true, force: true });
});
