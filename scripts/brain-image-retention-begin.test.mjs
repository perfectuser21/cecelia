import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { createStore } from './brain-image-retention/storage.mjs';
import { US_MACHINE_ID } from './brain-image-retention/policy.mjs';
import { beginWithContentionRetry } from './brain-image-retention/begin.mjs';
import { createDeploymentLedger } from './brain-image-retention/ledger.mjs';

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

const busy = () => Object.assign(new Error('IMAGE_RETENTION_BUSY'), { code: 'IMAGE_RETENTION_BUSY' });

test('真实锁持续占用到预算：明确超时且inode、台账、holder及Docker均不变', async t => {
  const f = await fixture(t), request = { deployment_id: randomUUID(), version: '1.0.2', git_sha: targetSha };
  const ledger = createDeploymentLedger({ store: f.store,
    docker: { snapshot: () => assert.fail('超时等待者不能进入Docker快照') } });
  await f.store.withLock(async lease => {
    const path = join(f.store.root, 'operation.lock'), before = await lstat(path);
    const bytes = await readFile(join(f.store.root, 'ledger.json'), 'utf8');
    await assert.rejects(beginWithContentionRetry(ledger, request, { waitMs: 80 }),
      { code: 'IMAGE_RETENTION_BUSY_TIMEOUT' });
    await lease.assertHeld();
    const after = await lstat(path);
    assert.deepEqual([after.dev, after.ino], [before.dev, before.ino], '超时不得删除或替换holder锁');
    assert.equal(await readFile(join(f.store.root, 'ledger.json'), 'utf8'), bytes);
    assert.deepEqual((await readdir(f.store.root)).sort(), ['config.json', 'ledger.json', 'operation.lock']);
    assert.equal(await readIfPresent(f.env.BEGIN_DOCKER_LOG), '');
  });
  await f.store.withLock(lease => lease.assertHeld());
});

test('永久错误原对象立即透传；错误消息包含BUSY不能触发重试', async () => {
  for (const code of ['UNTRUSTED_LOCK', 'LOCK_UNAVAILABLE', 'LOCK_IDENTITY_CHANGED',
    'DEPLOYMENT_PENDING', 'DEPLOYMENT_CONFLICT', 'INVALID_DEPLOYMENT', undefined]) {
    const error = Object.assign(new Error('IMAGE_RETENTION_BUSY'), { code });
    let attempts = 0;
    await assert.rejects(beginWithContentionRetry({ begin: async () => { attempts += 1; throw error; } }, {},
      { sleep: () => assert.fail('永久错误不能等待') }), caught => caught === error);
    assert.equal(attempts, 1);
  }
});

test('预算0仅立即尝试一次，成功正常返回，BUSY明确超时', async () => {
  const result = {}, request = {};
  assert.equal(await beginWithContentionRetry({ begin: async body => {
    assert.equal(body, request); return result;
  } }, request, { waitMs: 0 }), result);
  let attempts = 0;
  await assert.rejects(beginWithContentionRetry({ begin: async () => { attempts += 1; throw busy(); } }, request,
    { waitMs: 0, sleep: () => assert.fail('预算0不能sleep') }), { code: 'IMAGE_RETENTION_BUSY_TIMEOUT' });
  assert.equal(attempts, 1);
});

test('非法等待预算在任何begin调用前拒绝', async () => {
  for (const waitMs of [-1, 30001, 1.5, NaN, Infinity, '1000', null]) {
    await assert.rejects(beginWithContentionRetry({ begin: () => assert.fail('非法预算不能调用begin') }, {},
      { waitMs }), { code: 'INVALID_BEGIN_WAIT_BUDGET' });
  }
});

test('sleep后单调deadline重查：刚好到期或oversleep均不能新增尝试', async () => {
  for (const overshoot of [0, 50]) {
    let clock = 0, attempts = 0;
    await assert.rejects(beginWithContentionRetry({ begin: async () => { attempts += 1; throw busy(); } }, {}, {
      waitMs: 80, now: () => clock, sleep: async ms => { assert.equal(ms, 80); clock += ms + overshoot; },
    }), { code: 'IMAGE_RETENTION_BUSY_TIMEOUT' });
    assert.equal(attempts, 1, 'deadline后不能再调用begin，即使该次可能拿锁');
  }
});

test('同一单调预算不重置，每次sleep不超过剩余预算', async () => {
  let clock = 0, attempts = 0;
  const sleeps = [];
  await assert.rejects(beginWithContentionRetry({ begin: async () => { attempts += 1; throw busy(); } }, {}, {
    waitMs: 1500, now: () => clock, sleep: async ms => { sleeps.push(ms); clock += ms; },
  }), { code: 'IMAGE_RETENTION_BUSY_TIMEOUT' });
  assert.deepEqual(sleeps, [1000, 500]);
  assert.equal(attempts, 2);
});

test('时钟冻结也最多31次尝试；默认预算不引入无限重试', async () => {
  let attempts = 0, sleeps = 0;
  await assert.rejects(beginWithContentionRetry({ begin: async () => { attempts += 1; throw busy(); } }, {}, {
    now: () => 0, sleep: async ms => { assert.equal(ms, 1000); sleeps += 1; },
  }), { code: 'IMAGE_RETENTION_BUSY_TIMEOUT' });
  assert.equal(attempts, 31);
  assert.equal(sleeps, 30);
});

test('每次重试保留同一个request，取得锁后的成功不被竞争deadline伪判失败', async () => {
  let clock = 0, attempts = 0;
  const request = Object.freeze({ deployment_id: randomUUID(), version: '1.0.2', git_sha: targetSha }), result = {};
  const actual = await beginWithContentionRetry({ begin: async body => {
    assert.equal(body, request);
    attempts += 1;
    if (attempts < 3) throw busy();
    clock = 100000; // 已进入原事务的快照可超过锁竞争等待预算，不能假报失败。
    return result;
  } }, request, { now: () => clock, sleep: async ms => { clock += ms; } });
  assert.equal(actual, result);
  assert.equal(attempts, 3);
});

test('sleep自己的错误立即原样透传，不当作竞争或重发begin', async () => {
  const error = new Error('sleep故障');
  let attempts = 0;
  await assert.rejects(beginWithContentionRetry({ begin: async () => { attempts += 1; throw busy(); } }, {}, {
    sleep: async () => { throw error; },
  }), caught => caught === error);
  assert.equal(attempts, 1);
});

test('真实同SHA并发begin：第二部署必须被pending拒绝，不能重造身份或重复增代数', async t => {
  const f = await fixture(t);
  let snapshots = 0;
  const docker = { snapshot: async () => {
    snapshots += 1;
    return { images: [{ id: image, git_sha: previousSha, tags: ['cecelia-brain:1.0.1'] }],
      containers: [{ id: container, name: '/cecelia-node-brain', image_id: image, running: true }] };
  } };
  const ledger = createDeploymentLedger({ store: f.store, docker });
  const requests = [randomUUID(), randomUUID()].map(deployment_id => ({ deployment_id, version: '1.0.2', git_sha: targetSha }));
  const results = await Promise.allSettled(requests.map(request => beginWithContentionRetry(ledger, request)));
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  const failed = results.find(x => x.status === 'rejected');
  assert.equal(failed.reason.code, 'DEPLOYMENT_PENDING');
  const winner = requests[results.findIndex(x => x.status === 'fulfilled')];
  const state = await f.store.read('ledger.json');
  assert.deepEqual(state.pending.request, winner);
  assert.equal(state.generation, f.initialLedger.generation + 1);
  assert.equal(snapshots, 1);
  const rows = (await readdir(f.store.root)).filter(name => name.startsWith('deployment-'));
  assert.deepEqual(rows, [`deployment-${winner.deployment_id}.json`]);
});
