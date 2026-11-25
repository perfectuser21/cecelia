import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { createStore } from './brain-image-retention/storage.mjs';
import { US_MACHINE_ID } from './brain-image-retention/policy.mjs';

const run = promisify(execFile);
const previousSha = 'a'.repeat(40), targetSha = 'd'.repeat(40);
const image = `sha256:${'b'.repeat(64)}`, container = 'c'.repeat(64);

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'retention-begin-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ledgerRoot = join(root, 'ledger'), bin = join(root, 'bin');
  await mkdir(ledgerRoot, { mode: 0o700 });
  await mkdir(bin);
  const scripts = join(root, 'scripts');
  await cp(new URL('./brain-image-retention/', import.meta.url), join(scripts, 'brain-image-retention'), { recursive: true });
  const shell = join(scripts, 'lib', 'brain-image-retention.sh');
  await mkdir(dirname(shell), { recursive: true });
  await copyFile(new URL('./lib/brain-image-retention.sh', import.meta.url), shell);

  // 隔离fixture只替换容器数据卷的挂载位置，保留真实runtime及dev/daemon身份校验。
  const runtimePath = join(scripts, 'brain-image-retention', 'runtime.mjs');
  const runtimeSource = await readFile(runtimePath, 'utf8');
  assert.equal(runtimeSource.split("'/run/cecelia-docker-data'").length, 2);
  await writeFile(runtimePath, runtimeSource.replace("'/run/cecelia-docker-data'", JSON.stringify(ledgerRoot)));

  const config = { schema_version: 1, machine_registry_id: US_MACHINE_ID,
    daemon_id: 'isolated-begin-daemon', docker_root_dir: ledgerRoot, volume_dev: (await stat(ledgerRoot)).dev };
  const initialLedger = { schema_version: 1, generation: 7, pending: null, successes: [] };
  const store = createStore(ledgerRoot);
  await store.withLock(async lease => {
    await store.save('config.json', config, lease);
    await store.save('ledger.json', initialLedger, lease);
  });

  await writeFile(join(bin, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.BEGIN_DOCKER_LOG, JSON.stringify(args) + '\\n');
let value;
if (args[0] === 'info') value = ${JSON.stringify({ ID: config.daemon_id, DockerRootDir: ledgerRoot, OSType: 'linux' })};
else if (args[0] === 'image' && args[1] === 'ls') value = ${JSON.stringify(image)};
else if (args[0] === 'container' && args[1] === 'ls') value = ${JSON.stringify(container)};
else if (args[0] === 'image' && args[1] === 'inspect') value = ${JSON.stringify([{ Id: image, RepoTags: ['cecelia-brain:1.0.1'], RepoDigests: [], Created: '2026-01-01T00:00:00Z', Config: { Env: [`GIT_SHA=${previousSha}`] } }])};
else if (args[0] === 'container' && args[1] === 'inspect') value = ${JSON.stringify([{ Id: container, Image: image, Name: '/cecelia-node-brain', State: { Running: true } }])};
else { process.stderr.write('fixture拒绝未批准Docker命令'); process.exit(2); }
process.stdout.write(typeof value === 'string' ? value + '\\n' : JSON.stringify(value));
`, { mode: 0o700 });

  const realFlock = (await run('which', ['flock'])).stdout.trim();
  assert.ok(realFlock.startsWith('/'), '必须找到真实flock二进制');
  // 仅记录真实flock的退出码；每次都执行内核锁，绝不伪造获取成功。
  await writeFile(join(bin, 'flock'), '#!/bin/sh\n"$BEGIN_REAL_FLOCK" "$@"\ncode=$?\nprintf "%s\\n" "$code" >> "$BEGIN_FLOCK_LOG"\nexit "$code"\n', { mode: 0o700 });
  const env = { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`,
    BRAIN_URL: 'http://127.0.0.1:5221', CECELIA_IMAGE_RETENTION_DIR: ledgerRoot,
    BEGIN_REAL_FLOCK: realFlock, BEGIN_FLOCK_LOG: join(root, 'flock.log'), BEGIN_DOCKER_LOG: join(root, 'docker.log') };
  delete env.CECELIA_IMAGE_DEPLOYMENT_ID;
  delete env.CECELIA_IMAGE_EXPECTED_CONTAINER_ID;
  delete env.NODE_TEST_CONTEXT;
  return { root, store, shell, scripts, initialLedger, env };
}

async function readIfPresent(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

async function waitForRealContention(f) {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    if ((await readIfPresent(f.env.BEGIN_FLOCK_LOG)).split('\n').includes('75')) return;
    await delay(10);
  }
  assert.fail('未观测到真实flock竞争退出75；不能以缺模块或fixture错误充当红测试');
}

function invoke(f, entry, id = randomUUID()) {
  const args = entry === 'shell'
    ? ['-euc', 'source "$1"; retention_begin 1.0.2 "$2"; printf "%s\\n" "$CECELIA_IMAGE_DEPLOYMENT_ID"', '_', f.shell, targetSha]
    : [join(f.scripts, 'brain-image-retention', 'cli.mjs'), 'begin', id, '1.0.2', targetSha];
  return run(entry === 'shell' ? 'bash' : process.execPath, args,
    { env: f.env, timeout: 10000, maxBuffer: 1024 * 1024 }).then(
    result => ({ ...result, code: 0 }), error => error);
}

async function assertDeployment(f, result, expectedId) {
  assert.equal(result.code, 0, `begin必须在真实锁释放后继续同次调用；stderr=${result.stderr}`);
  assert.match(result.stdout, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\n$/,
    'stdout只能有单个部署UUID，重试诊断不得污染协议');
  const id = result.stdout.trim();
  if (expectedId) assert.equal(id, expectedId, '重试必须保持原deployment UUID');
  const ledger = await f.store.read('ledger.json');
  assert.equal(ledger.generation, f.initialLedger.generation + 1, '竞争重试不能重复增加代数');
  assert.equal(ledger.pending.deployment_id, id);
  assert.deepEqual(ledger.pending.request, { deployment_id: id, version: '1.0.2', git_sha: targetSha });
  const row = await f.store.read(`deployment-${id}.json`);
  assert.deepEqual(row.request, ledger.pending.request);
  assert.equal(row.receipt, null);
  const calls = (await readIfPresent(f.env.BEGIN_DOCKER_LOG)).trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 5, '只允许一次begin快照，不能重复构建/删除/迁移');
  assert.ok(calls.every(args => args[0] === 'info' || ['ls', 'inspect'].includes(args[1])));
}

test('真实CLI无竞争基线：保真runtime与Docker fixture能建立单个pending', async t => {
  const f = await fixture(t), id = randomUUID();
  await assertDeployment(f, await invoke(f, 'cli', id), id);
});

for (const entry of ['cli', 'shell']) test(`真实${entry}入口遇短暂flock竞争：释放后同次begin成功且代数只增一次`, async t => {
  const f = await fixture(t), id = randomUUID();
  let resultPromise, result;
  try {
    await f.store.withLock(async lease => {
      resultPromise = invoke(f, entry, id);
      await waitForRealContention(f);
      await lease.assertHeld();
      assert.equal(await readIfPresent(f.env.BEGIN_DOCKER_LOG), '', '竞争期间不得进入Docker快照或其他副作用');
      assert.deepEqual(await f.store.read('ledger.json'), f.initialLedger, '锁未取得时不能写pending');
    });
  } finally {
    if (resultPromise) result = await resultPromise;
  }
  await assertDeployment(f, result, entry === 'cli' ? id : undefined);
});
