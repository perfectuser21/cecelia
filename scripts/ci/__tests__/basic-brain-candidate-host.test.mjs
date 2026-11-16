import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../../..');
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;

function cleanupFixture(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'brain-candidate-host-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'bin'));
  const log = join(dir, 'docker.jsonl');
  writeFileSync(join(dir, 'bin/docker'), `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DOCKER_LOG, JSON.stringify(args) + '\\n');
const command = args[0] === '--context' ? args.slice(2) : args;
if (command[0] === 'context') { console.log('ssh://administrator@mac-studio'); process.exit(0); }
if (process.env.DISCONNECTED === '1') { console.error('Cannot connect to the Docker daemon'); process.exit(1); }
if (command[0] === 'ps') console.log('cecelia-admission-brain');
if (command[0] === 'inspect' && command.includes('--format')) console.log('admission-v1');
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
    DOCKER_LOG: log, BRAIN_CANDIDATE_DOCKER_CONTEXT: 'mac-studio', ...overrides };
  const run = body => spawnSync('bash', ['-c', `set -euo pipefail; source ${shellQuote(join(root, 'scripts/lib/brain-staging.sh'))}; ${body}`], { env, encoding: 'utf8' });
  return { run, commands: () => readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) };
}

test('候选清理只访问所配 Mac Docker，生产默认 daemon 不得收到候选 stop/rm', t => {
  const f = cleanupFixture(t);
  const result = f.run('stage_remove_container cecelia-admission-brain');
  assert.equal(result.status, 0, result.stderr);
  const stops = f.commands().filter(args => args.includes('stop'));
  assert.deepEqual(stops, [['--context', 'mac-studio', 'stop', 'cecelia-admission-brain']]);
  assert.equal(f.commands().some(args => args[0] === 'rm'), false);
});

test('候选 Docker 断链必须清理失败，不能当作容器不存在', t => {
  const f = cleanupFixture(t, { DISCONNECTED: '1' });
  assert.notEqual(f.run('stage_remove_container cecelia-admission-brain').status, 0);
});

const image = `sha256:${'b'.repeat(64)}`, oldImage = `sha256:${'d'.repeat(64)}`;
const request = '11111111-2222-3333-4444-555555555555';
const dockerFixture = String.raw`
import fs from 'node:fs';
import path from 'node:path';
const original = process.argv.slice(2), e = process.env, fault = e.FAULT || '';
fs.appendFileSync(e.DOCKER_LOG, JSON.stringify(original) + '\n');
let a = original, host = 'local';
if (a[0] === '--context') { host = a[1]; a = a.slice(2); }
const fail = message => { console.error(message); process.exit(42); };
if (a[0] === 'context') {
  if (fault === 'context-missing') fail('context not found');
  console.log(fault === 'context-tcp' ? 'tcp://mac-studio:2375' : 'ssh://administrator@mac-studio');
  process.exit(0);
}
if (a[0] === 'info') process.exit(0);
const stateFile = path.join(e.STATE_DIR, host + '.json');
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state));
const option = name => a[a.indexOf(name) + 1];
const contains = text => a.some(value => value.includes(text));
const result = value => { console.log(value); process.exit(0); };
const receipt = () => fs.existsSync(e.RECEIPT) ? JSON.parse(fs.readFileSync(e.RECEIPT, 'utf8')) : null;
const enforceCandidate = () => { if (host !== e.EXPECTED_CANDIDATE_HOST) fail('candidate went to production daemon'); };
const enforceProduction = () => { if (host !== 'local') fail('production went to candidate daemon'); };
if (a[0] === 'build') {
  enforceCandidate();
  if (fault === 'build') fail('build failed');
  const sha = option('--build-arg').replace('GIT_SHA=', '');
  state.images[e.IMAGE] = { sha, platform: 'linux/amd64' };
  state.source = fs.readFileSync(path.join(a.at(-1), 'marker.txt'), 'utf8');
  if (fs.existsSync(path.join(a.at(-1), 'UNTRACKED_SECRET'))) fail('dirty source leak');
  for (let n = 0; n < a.length; n++) if (a[n] === '-t') state.tags[a[n + 1]] = e.IMAGE;
  if (a.includes('--iidfile')) fs.writeFileSync(option('--iidfile'), e.IMAGE + '\n');
  if (fault === 'tag-race') for (const tag of Object.keys(state.tags)) state.tags[tag] = e.OLD_IMAGE;
  save(); process.exit(0);
}
if (a[0] === 'image') {
  if (a[1] === 'inspect') {
    const ref = a.at(-1), id = state.tags[ref] || ref, value = state.images[id];
    if (!value) fail('No such image');
    const prefix = host === 'local' ? 'local-' : 'remote-';
    const tamper = !state.tags[ref] && id === e.IMAGE;
    const format = option('--format');
    if (format === '{{.Id}}') result(tamper && fault === prefix + 'id' ? e.OLD_IMAGE : id);
    if (format.includes('Architecture')) result(tamper && fault === prefix + 'platform' ? 'linux/arm64' : value.platform);
    if (format.includes('Config.Env')) result('GIT_SHA=' + (tamper && fault === prefix + 'sha' ? 'c'.repeat(40) : value.sha));
    if (format.includes('RepoTags')) result(Object.keys(state.tags).filter(tag => state.tags[tag] === id).join('\n'));
  }
  if (a[1] === 'save') {
    enforceCandidate();
    if (fault === 'save') fail('save failed');
    if (!state.images[a[2]]) fail('unknown immutable image');
    result(JSON.stringify({ id: a[2], image: state.images[a[2]] }));
  }
  if (a[1] === 'load') {
    enforceProduction();
    const input = fs.readFileSync(0, 'utf8');
    if (fault === 'load') fail('load failed');
    // 消费端即使错误地返回成功，上游 save 失败仍必须由 pipefail 拒绝。
    if (!input) process.exit(0);
    const loaded = JSON.parse(input); state.images[loaded.id] = loaded.image; save(); process.exit(0);
  }
  if (a[1] === 'prune') { enforceProduction(); process.exit(0); }
  if (a[1] === 'rm') { delete state.tags[a[2]]; save(); process.exit(0); }
}
if (a[0] === 'tag') { enforceProduction(); state.tags[a[2]] = a[1]; save(); process.exit(0); }
if (a[0] === 'images') result('1GB');
if (a[0] === 'ps') {
  if (contains('cecelia-bluegreen-sidecar')) { enforceProduction(); result(''); }
  enforceCandidate();
  if (fault === 'cleanup-list' && state.verified) fail('candidate connection lost');
  const name = option('--filter').replace('name=^/', '').replace('$', '');
  result(state.containers[name] ? name : '');
}
if (a[0] === 'network') {
  enforceCandidate();
  if (a[1] === 'ls') {
    if (fault === 'cleanup-network' && state.verified) fail('network transport lost');
    result(state.network ? 'cecelia-admission' : '');
  }
  if (a[1] === 'create') { state.network = e.REQUEST; save(); result('network'); }
  if (a[1] === 'inspect') result(contains('staging.request') ? state.network : 'admission-v1');
  if (a[1] === 'rm') {
    if (receipt()?.status === 'success') fail('success receipt preceded cleanup');
    state.network = null; save(); process.exit(0);
  }
}
if (a[0] === 'run') {
  enforceCandidate();
  if (contains('src/migrate.js')) {
    if (fault === 'migrate') fail('migration failed');
    state.migrated = true; save(); process.exit(0);
  }
  state.containers[option('--name')] = e.REQUEST; save(); result('container');
}
if (a[0] === 'inspect') {
  enforceCandidate();
  if (!state.containers[a[1]]) fail('No such container');
  if (contains('staging.request')) result(fault === 'owner' ? 'another-request' : state.containers[a[1]]);
  if (contains('cecelia.staging')) result(fault === 'label' ? 'unowned' : 'admission-v1');
  if (contains('State.Health')) result('healthy');
  if (contains('{{.Image}}')) result(e.IMAGE);
}
if (a[0] === 'stop' || a[0] === 'rm') {
  enforceCandidate();
  if (fault === 'cleanup-stop' && state.verified) fail('stop failed');
  if (receipt()?.status === 'success') fail('success receipt preceded cleanup');
  if (a[0] === 'rm') { delete state.containers[a.at(-1)]; save(); }
  process.exit(0);
}
if (a[0] === 'exec') {
  const name = a[1] === '-i' ? a[2] : a[1];
  if (name === 'cecelia-node-brain') {
    enforceProduction();
    if (contains('pg_total_relation_size')) result('100000000');
    if (contains('pg_dump')) { if (fault === 'dump') fail('dump failed'); result('snapshot'); }
    fail('unexpected production exec');
  }
  enforceCandidate();
  if (contains('pg_isready')) process.exit(0);
  if (contains('df')) result('Filesystem 1024-blocks Used Available Capacity Mounted\nfixture 30000000 5000000 25000000 10% /');
  if (contains('pg_restore')) { fs.readFileSync(0); if (fault === 'restore') fail('restore failed'); process.exit(0); }
  if (contains('/health')) result(JSON.stringify({status:'healthy',git_sha:fault === 'health' ? 'c'.repeat(40) : e.EXPECTED_SHA,version:'1.0.0',runtime:{isolated:true,background_automation:false}}));
  if (contains('tick/status')) result('{"enabled":false}');
  if (contains('/tasks?')) result('[]');
  if (contains('current_database')) {
    state.verified = true; save();
    result(JSON.stringify({database:fault === 'db-readback' ? 'cecelia' : 'cecelia_staging',host:'stage-db',tasks_table:true}));
  }
}
fail('unexpected docker command: ' + JSON.stringify(original));
`;

function fixture(t, fault = '', context = 'mac-studio') {
  const dir = mkdtempSync(join(tmpdir(), 'brain-candidate-runtime-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const path of ['bin', 'state', 'fixture-hooks', 'repo/scripts/lib', 'repo/packages/brain', 'repo/logs']) mkdirSync(join(dir, path), { recursive: true });
  const repo = join(dir, 'repo');
  for (const file of ['brain-build.sh', 'staging-verify.sh', 'lib/brain-staging.sh', 'lib/brain-candidate-docker.sh']) copyFileSync(join(root, 'scripts', file), join(repo, 'scripts', file));
  writeFileSync(join(dir, 'bin/docker'), `#!${process.execPath}\n${dockerFixture}`, { mode: 0o755 });
  for (const name of ['sleep', 'flock']) writeFileSync(join(dir, 'bin', name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(dir, 'bin/df'), '#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 30000000 5000000 25000000 10%% /\\n"\n', { mode: 0o755 });
  writeFileSync(join(repo, 'packages/brain/package.json'), '{"version":"1.0.0"}');
  writeFileSync(join(repo, 'packages/brain/Dockerfile'), 'FROM scratch\n');
  writeFileSync(join(repo, 'marker.txt'), 'frozen-source');
  writeFileSync(join(repo, '.gitignore'), '.brain-build-tmp/\nlogs/\n');
  const git = (...args) => {
    const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  // 仅测试私有仓库使用空 hooks；不得继承宿主生产仓的发布/分支 hook。
  git('config', 'core.hooksPath', join(dir, 'fixture-hooks'));
  git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'fixture');
  git('add', '.'); git('commit', '-qm', 'fixture');
  const sha = git('rev-parse', 'HEAD');
  git('init', '-q', '--bare', join(dir, 'origin.git')); git('remote', 'add', 'origin', join(dir, 'origin.git')); git('push', '-q', 'origin', 'main');
  writeFileSync(join(repo, 'marker.txt'), 'dirty-source'); writeFileSync(join(repo, 'UNTRACKED_SECRET'), 'private');
  const initial = { images: { [oldImage]: { sha: 'a'.repeat(40), platform: 'linux/amd64' }, [image]: { sha, platform: 'linux/amd64' } },
    tags: { 'cecelia-brain:1.0.0': oldImage, 'cecelia-brain:latest': oldImage }, containers: {}, network: null };
  for (const host of ['local', 'mac-studio']) writeFileSync(join(dir, 'state', host + '.json'), JSON.stringify(initial));
  const env = { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, DOCKER_LOG: join(dir, 'docker.jsonl'), STATE_DIR: join(dir, 'state'),
    IMAGE: image, OLD_IMAGE: oldImage, EXPECTED_SHA: sha, EXPECTED_VERSION: '1.0.0', REQUEST: request, STAGING_REQUEST_ID: request,
    BRAIN_CANDIDATE_DOCKER_CONTEXT: context, EXPECTED_CANDIDATE_HOST: context || 'local', FAULT: fault, RECEIPT: join(repo, 'logs/brain-staging-receipt.json') };
  const run = body => spawnSync('bash', ['-c', body], { cwd: repo, env, encoding: 'utf8', timeout: 30000 });
  return { dir, repo, env, sha, run,
    state: host => JSON.parse(readFileSync(join(dir, 'state', host + '.json'), 'utf8')),
    commands: () => existsSync(env.DOCKER_LOG) ? readFileSync(env.DOCKER_LOG, 'utf8').trim().split('\n').map(JSON.parse) : [],
    receipt: () => existsSync(env.RECEIPT) ? JSON.parse(readFileSync(env.RECEIPT, 'utf8')) : null };
}
const runBuild = f => f.run('bash scripts/brain-build.sh');
const runStage = f => f.run(`set -euo pipefail; SCRIPT_DIR="$PWD/scripts"; ROOT_DIR="$PWD"; source scripts/lib/brain-staging.sh; brain_release_lock; stage_candidate "$EXPECTED_SHA" "$IMAGE" 1.0.0`);

for (const fault of ['', 'tag-race']) test(`远端构建冻结源码、linux/amd64、iidfile，镜像按 ID 回 US 后才更新 tag：${fault || '成功'}`, t => {
  const f = fixture(t, fault), result = runBuild(f);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(f.state('mac-studio').source, 'frozen-source');
  assert.equal(f.state('local').tags['cecelia-brain:1.0.0'], image);
  const commands = f.commands(), build = commands.find(a => a.includes('build'));
  assert.deepEqual(build.slice(0, 5), ['--context', 'mac-studio', 'build', '--platform', 'linux/amd64']);
  assert.ok(build.includes('--iidfile'));
  assert.deepEqual(commands.find(a => a.includes('save')), ['--context', 'mac-studio', 'image', 'save', image]);
  const load = commands.findIndex(a => a[0] === 'image' && a[1] === 'load');
  const update = commands.findIndex(a => a[0] === 'tag' && a[2] === 'cecelia-brain:1.0.0');
  assert.ok(update > load);
  assert.equal(commands.some(a => a[0] === 'build'), false);
});

for (const fault of ['context-missing', 'context-tcp', 'build', 'remote-id', 'remote-sha', 'remote-platform', 'save', 'load', 'local-id', 'local-sha', 'local-platform']) {
  test(`远端构建 ${fault} 拒绝晋升，保留 US 原发布 tag`, t => {
    const f = fixture(t, fault), result = runBuild(f);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(f.state('local').tags['cecelia-brain:1.0.0'], oldImage);
    assert.equal(f.state('local').tags['cecelia-brain:latest'], oldImage);
    assert.equal(f.commands().some(a => a[0] === 'build'), false);
  });
}

test('不配置 context 时，原本机构建路径不触发远程搬运', t => {
  const f = fixture(t, '', ''), result = runBuild(f);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.state('local').source, 'frozen-source');
  assert.equal(f.commands().some(a => a.includes('--context') || a.includes('save') || a.includes('load')), false);
});

for (const context of ['mac-studio', '']) test(`隔离验收完整闭环；清理完成后才写成功回执：${context || '默认'}`, t => {
  const f = fixture(t, '', context), result = runStage(f);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(f.receipt().status, 'success');
  assert.equal(f.receipt().phase, 'verified');
  assert.deepEqual(f.receipt().database, { database: 'cecelia_staging', host: 'stage-db', tasks_table: true });
  assert.deepEqual(f.state(context || 'local').containers, {});
  assert.equal(f.state(context || 'local').network, null);
  const commands = f.commands();
  assert.equal(commands.filter(a => a[0] === 'exec' && a[1] === 'cecelia-node-brain').length, 2);
  assert.equal(commands.filter(a => a.some(value => value.includes('cecelia-bluegreen-sidecar')) && a[0] === 'ps').length, 1);
  assert.ok(commands.some(a => a.some(value => value.includes('current_database'))));
});

for (const fault of ['dump', 'restore', 'cleanup-stop', 'cleanup-list', 'cleanup-network', 'owner', 'label']) {
  test(`隔离验收 ${fault} 不得产生成功回执或生产动作`, t => {
    const f = fixture(t, fault), result = runStage(f);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(f.receipt().status, 'failed', result.stderr + result.stdout);
    assert.equal(f.commands().some(a => ['run', 'stop', 'rm'].includes(a[0])), false);
    if (fault === 'dump' || fault === 'restore') assert.equal(f.state('mac-studio').migrated, undefined);
    if (fault === 'owner' || fault === 'label') assert.equal(f.commands().some(a => a.includes('stop')), false);
  });
}

test('候选 context 仅为调用方 shell 变量时，仍显式传入验证子进程', t => {
  const f = fixture(t);
  const result = f.run('set -euo pipefail; export -n BRAIN_CANDIDATE_DOCKER_CONTEXT; SCRIPT_DIR="$PWD/scripts"; ROOT_DIR="$PWD"; source scripts/lib/brain-staging.sh; stage_candidate "$EXPECTED_SHA" "$IMAGE" 1.0.0');
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(f.receipt().status, 'success');
});
