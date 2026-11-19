import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, existsSync, realpathSync } from 'node:fs';
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
const command = ['--context','--host'].includes(args[0]) ? args.slice(2) : args;
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
if (['--context','--host'].includes(a[0])) { host = a[0] === '--host' ? 'mac-studio' : a[1]; a = a.slice(2); }
const fail = message => { console.error(message); process.exit(42); };
if (a[0] === 'context') {
  if (fault === 'context-missing') fail('context not found');
  console.log(fault === 'context-tcp' ? 'tcp://mac-studio:2375' : 'ssh://administrator@mac-studio');
  process.exit(0);
}
if (a[0] === 'info') { if(fault==='info-failed-text'&&fs.existsSync(e.RECEIPT)){console.log(host==='local'?'production-daemon':'candidate-daemon');process.exit(42);} console.log(host === 'local' || fault === 'same-daemon' ? 'production-daemon' : (fault === 'daemon-drift' && fs.existsSync(e.RECEIPT) ? 'changed-daemon' : 'candidate-daemon')); process.exit(0); }
const stateFile = path.join(e.STATE_DIR, host + '.json');
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state));
const option = name => a[a.indexOf(name) + 1];
const contains = text => a.some(value => value.includes(text));
const result = value => { console.log(value); process.exit(0); };
const receipt = () => fs.existsSync(e.RECEIPT) ? JSON.parse(fs.readFileSync(e.RECEIPT, 'utf8')) : null;
const enforceCandidate = () => { if (host !== e.EXPECTED_CANDIDATE_HOST) fail('candidate went to production daemon'); };
const enforceProduction = () => { if (host !== 'local') fail('production went to candidate daemon'); };
if (a[0] === 'buildx') {
  enforceCandidate();
  if (fault === 'buildx-missing') fail('buildx plugin missing');
  if (a[1] === 'version') result('github.com/docker/buildx v0.31.1');
  if (a[1] !== 'build' || !a.includes('--load')) fail('cross-platform build must load immutable image');
  if (!a.includes('--builder') || option('--builder') !== (e.BRAIN_CANDIDATE_DOCKER_CONTEXT || 'default')) fail('selected builder escaped candidate endpoint');
  a = a.slice(1);
} else if (a[0] === 'build' && host !== 'local') {
  fail('remote legacy builder forbidden');
}
if (a[0] === 'build') {
  enforceCandidate();
  if (fault === 'build') fail('build failed');
  const sha = option('--build-arg').replace('GIT_SHA=', '');
  if(host!=='local') {
    const tag=option('-t'),logs=path.join(e.STATE_DIR,'../repo/logs');
    const owners=fs.readdirSync(logs).filter(x=>x.endsWith('.json')).map(x=>JSON.parse(fs.readFileSync(path.join(logs,x),'utf8')));
    const owner=owners.find(x=>x.tag===tag);
    if(!owner||owner.sha!==sha||owner.image||owner.candidate!==(fault==='same-daemon'?'production-daemon':'candidate-daemon')||owner.production!=='production-daemon'||JSON.stringify([...owner.preexisting].sort())!==JSON.stringify(Object.keys(state.images).sort())) fail('ownership was not recorded before build');
  }
  state.images[e.IMAGE] = { sha, platform: 'linux/amd64' };
  if(fault==='extra-tag') state.tags['other:shared']=e.IMAGE;
  state.source = fs.readFileSync(path.join(a.at(-1), 'marker.txt'), 'utf8');
  if (fs.existsSync(path.join(a.at(-1), 'UNTRACKED_SECRET'))) fail('dirty source leak');
  for (let n = 0; n < a.length; n++) if (a[n] === '-t') state.tags[a[n + 1]] = e.IMAGE;
  if (a.includes('--iidfile')) fs.writeFileSync(option('--iidfile'), e.IMAGE + '\n');
  if (fault === 'tag-race') for (const tag of Object.keys(state.tags)) state.tags[tag] = e.OLD_IMAGE;
  save(); if(fault==='partial-build') fail('build loaded image then failed'); process.exit(0);
}
if (a[0] === 'image') {
  if (a[1] === 'ls') { if (fault === 'inventory') fail('inventory unavailable'); result(Object.keys(state.images).join('\n')); }
  if (a[1] === 'inspect') {
    const ref = a.at(-1), id = state.tags[ref] || ref, value = state.images[id];
    if (!value) fail('No such image');
    const prefix = host === 'local' ? 'local-' : 'remote-';
    const tamper = !state.tags[ref] && id === e.IMAGE;
    const format = option('--format');
    if (format === '{{json .}}') result(JSON.stringify({Id:id,RepoTags:Object.keys(state.tags).filter(tag=>state.tags[tag]===id),RepoDigests:fault==='self-digest'?['cecelia-brain@'+id]:fault==='digest'?['repo@sha256:digest']:[],Config:{Env:['GIT_SHA='+value.sha]}}));
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
  if (a[1] === 'rm') { if(fault==='rm-failed') fail('delete failed'); if (a[2].startsWith('sha256:')) { delete state.images[a[2]]; for(const tag of Object.keys(state.tags)) if(state.tags[tag]===a[2]) delete state.tags[tag]; } else delete state.tags[a[2]]; save(); if(fault==='rm-lost') fail('delete response lost'); process.exit(0); }
}
if (a[0] === 'tag') { enforceProduction(); state.tags[a[2]] = a[1]; save(); process.exit(0); }
if (a[0] === 'images') result('1GB');
if (a[0] === 'ps') {
  if (a.includes('-aq')) { if(fault==='container-query') fail('container query failed'); result(fault==='referenced'?'foreign-container':''); }
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
  if (a[1] === 'foreign-container') result(e.IMAGE);
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
  for (const file of ['brain-build.sh', 'staging-deploy.sh', 'staging-verify.sh', 'lib/brain-staging.sh', 'lib/brain-candidate-docker.sh']) copyFileSync(join(root, 'scripts', file), join(repo, 'scripts', file));
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
  assert.deepEqual(build.slice(0, 9), ['--context', 'mac-studio', 'buildx', 'build', '--builder', 'mac-studio', '--load', '--platform', 'linux/amd64']);
  assert.deepEqual(commands.find(a => a.includes('version')), ['--context', 'mac-studio', 'buildx', 'version']);
  assert.ok(build.includes('--iidfile'));
  assert.deepEqual(commands.find(a => a.includes('save')), ['--context', 'mac-studio', 'image', 'save', image]);
  const load = commands.findIndex(a => a[0] === 'image' && a[1] === 'load');
  const update = commands.findIndex(a => a[0] === 'tag' && a[2] === 'cecelia-brain:1.0.0');
  assert.ok(update > load);
  assert.equal(commands.some(a => a[0] === 'build'), false);
});

for (const fault of ['context-missing', 'context-tcp', 'buildx-missing', 'build', 'remote-id', 'remote-sha', 'remote-platform', 'save', 'load', 'local-id', 'local-sha', 'local-platform']) {
  test(`远端构建 ${fault} 拒绝晋升，保留 US 原发布 tag`, t => {
    const f = fixture(t, fault), result = runBuild(f);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(f.state('local').tags['cecelia-brain:1.0.0'], oldImage);
    assert.equal(f.state('local').tags['cecelia-brain:latest'], oldImage);
    assert.equal(f.commands().some(a => a[0] === 'build'), false);
  });
}

test('缺少buildx在修改任何US tag前拒绝，不回退legacy builder', t => {
  const f = fixture(t, 'buildx-missing'), result = runBuild(f);
  assert.notEqual(result.status, 0);
  assert.deepEqual(f.state('local').tags, {'cecelia-brain:1.0.0': oldImage, 'cecelia-brain:latest': oldImage});
  assert.equal(f.commands().some(a => a[0] === 'tag'), false);
  assert.equal(f.commands().some(a => a.includes('build')), false);
});

test('正式Brain镜像安装并在构建期核实buildx，现有image CI也真正运行插件', () => {
  const dockerfile = readFileSync(join(root, 'packages/brain/Dockerfile'), 'utf8');
  assert.match(dockerfile, /apk add[^\n]*\bdocker-cli-buildx\b/);
  assert.match(dockerfile, /&& docker buildx version/);
});

for (const kind of ['context', 'host']) test(`继承错误builder时仍绑定候选${kind}的默认builder`, t => {
  const f = fixture(t);
  f.env.BUILDX_BUILDER = 'production-builder';
  f.env.DOCKER_CONTEXT = 'production-context';
  f.env.DOCKER_BUILDKIT = '0';
  if (kind === 'host') {
    f.env.BRAIN_CANDIDATE_DOCKER_CONTEXT = '';
    f.env.BRAIN_CANDIDATE_DOCKER_HOST = 'ssh://administrator@100.71.151.105';
  }
  const result = runBuild(f);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const build = f.commands().find(a => a.includes('build'));
  assert.equal(build[build.indexOf('--builder') + 1], kind === 'context' ? 'mac-studio' : 'default');
  assert.equal(f.state('local').tags['cecelia-brain:1.0.0'], image);
  assert.equal(f.commands().some(a => a[0] === 'build'), false);
});

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


test('容器内候选可使用固定SSH端点，不要求宿主Docker context文件', t => {
  const host='ssh://administrator@100.71.151.105';
  const f=cleanupFixture(t,{BRAIN_CANDIDATE_DOCKER_CONTEXT:'',BRAIN_CANDIDATE_DOCKER_HOST:host});
  const result=f.run('stage_remove_container cecelia-admission-brain');
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(f.commands().filter(args=>args.includes('stop')),[['--host',host,'stop','cecelia-admission-brain']]);
});
test('候选端点禁止TCP与选项注入，失败前不得调用Docker', t => {
  for(const host of ['tcp://public.invalid:2375','--host=evil','ssh://host\n--config=/tmp/evil']) {
    const f=cleanupFixture(t,{BRAIN_CANDIDATE_DOCKER_CONTEXT:'',BRAIN_CANDIDATE_DOCKER_HOST:host});
    assert.notEqual(f.run('stage_remove_container cecelia-admission-brain').status,0);
  }
});


test('自动发布SSH端点贯穿真实构建、镜像导入与隔离数据库验收',t=>{
  const f=fixture(t);
  f.env.BRAIN_CANDIDATE_DOCKER_CONTEXT='';
  f.env.BRAIN_CANDIDATE_DOCKER_HOST='ssh://administrator@100.71.151.105';
  const result=f.run('set -euo pipefail; export BRAIN_CANDIDATE_DOCKER_HOST; bash scripts/brain-build.sh; SCRIPT_DIR="$PWD/scripts"; ROOT_DIR="$PWD"; source scripts/lib/brain-staging.sh; brain_release_lock; stage_candidate "$EXPECTED_SHA" "$IMAGE" 1.0.0');
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(f.receipt().isolated,true);
  const commands=f.commands();
  assert.ok(commands.some(args=>args[0]==='--host'&&args.includes('build')));
  assert.ok(commands.some(args=>args[0]==='--host'&&args.includes('pg_restore')));
  assert.ok(!commands.some(args=>args[0]!=='--host'&&args.includes('pg_restore')));
});

function freshCandidate(f) {
  const file=join(f.dir,'state/mac-studio.json'),state=f.state('mac-studio');
  delete state.images[image];writeFileSync(file,JSON.stringify(state));
}
for (const fault of ['', 'health', 'load']) test(`本次独占跨机候选镜像在成功或失败后精确回收：${fault||'success'}`,t=>{
  const f=fixture(t,fault);freshCandidate(f);
  const result=f.run('set -euo pipefail; export BRAIN_CANDIDATE_OWNERSHIP_FILE="$PWD/logs/brain-candidate-11111111-2222-3333-4444-555555555555.json"; bash scripts/brain-build.sh; SCRIPT_DIR="$PWD/scripts"; ROOT_DIR="$PWD"; source scripts/lib/brain-staging.sh; stage_candidate "$EXPECTED_SHA" "$IMAGE" 1.0.0');
  assert.equal(result.status===0,fault==='');
  assert.equal(f.state('mac-studio').images[image],undefined,'本次候选镜像遗留在构建daemon');
  assert.ok(f.state('local').images[image],'生产镜像不得被候选回收删除');
  const deletes=f.commands().filter(a=>a.includes('rm')&&a.includes(image));
  assert.deepEqual(deletes,[['--context','mac-studio','image','rm',image]]);
});
for (const fault of ['same-daemon','extra-tag','digest','referenced','container-query','daemon-drift','info-failed-text']) test(`无法证明独占所有权时保留候选镜像：${fault}`,t=>{
 const f=fixture(t,fault);freshCandidate(f);
 f.run('set -euo pipefail; export BRAIN_CANDIDATE_OWNERSHIP_FILE="$PWD/logs/brain-candidate-11111111-2222-3333-4444-555555555555.json"; bash scripts/brain-build.sh; SCRIPT_DIR="$PWD/scripts"; ROOT_DIR="$PWD"; source scripts/lib/brain-staging.sh; stage_candidate "$EXPECTED_SHA" "$IMAGE" 1.0.0');
 assert.ok(f.state('mac-studio').images[image]);
 assert.equal(f.commands().some(a=>a.includes('rm')&&a.includes(image)),false);
});

test('独立build成功及部分构建失败都精确清理；失败退出码不被cleanup覆盖',t=>{
 for(const fault of ['', 'partial-build']) {
  const f=fixture(t,fault);freshCandidate(f);const result=runBuild(f);
  assert.equal(result.status,fault?42:0,result.stderr+result.stdout);
  assert.equal(f.state('mac-studio').images[image],undefined);
  assert.ok(f.commands().some(a=>a.includes('rm')&&a.includes(image)));
 }
});
test('完整预存ID集合保护同ID重建，不回收已存在无tag镜像',t=>{
 const f=fixture(t);const result=runBuild(f);assert.equal(result.status,0,result.stderr);
 assert.ok(f.state('mac-studio').images[image]);
 assert.equal(f.commands().some(a=>a.includes('rm')&&a.includes(image)),false);
});
test('构建前inventory未知必须失败，不能创建镜像或追认清理',t=>{
 const f=fixture(t,'inventory');freshCandidate(f);const result=runBuild(f);
 assert.notEqual(result.status,0);assert.equal(f.commands().some(a=>a.includes('build')),false);
 assert.equal(f.commands().some(a=>a.includes('rm')&&a.includes(image)),false);
});
test('同SHA每次build使用不同UUIDtag；ownership记录在build前且延续到stage',t=>{
 const f=fixture(t);freshCandidate(f);
 assert.equal(f.run('export BRAIN_CANDIDATE_OWNERSHIP_FILE="$PWD/logs/brain-candidate-11111111-2222-3333-4444-555555555555.json"; bash scripts/brain-build.sh').status,0);
 const record=JSON.parse(readFileSync(join(f.repo,'logs/brain-candidate-11111111-2222-3333-4444-555555555555.json'),'utf8'));
 assert.equal(record.sha,f.sha);assert.equal(record.image,image);assert.ok(!record.preexisting.includes(image));
 assert.equal(record.candidate,'candidate-daemon');assert.equal(record.production,'production-daemon');
 assert.ok(f.state('mac-studio').images[image]);
 const result=f.run('set -euo pipefail; export BRAIN_CANDIDATE_OWNERSHIP_FILE="$PWD/logs/brain-candidate-11111111-2222-3333-4444-555555555555.json"; SCRIPT_DIR="$PWD/scripts"; ROOT_DIR="$PWD"; source scripts/lib/brain-staging.sh; stage_candidate "$EXPECTED_SHA" "$IMAGE" 1.0.0');
 assert.equal(result.status,0,result.stderr);assert.equal(existsSync(join(f.repo,'logs/brain-candidate-11111111-2222-3333-4444-555555555555.json')),false);
 assert.equal(runBuild(f).status,0);
 const tags=f.commands().filter(a=>a.includes('build')).map(a=>a[a.indexOf('-t')+1]);
 assert.equal(tags.length,2);assert.notEqual(tags[0],tags[1]);
 for(const tag of tags)assert.match(tag,/^cecelia-brain:candidate-[a-f0-9]{40}-[a-f0-9-]{36}$/);
});

for(const fault of ['rm-failed','rm-lost'])test(`删除结果未知不能重复发送，保留原stage结果：${fault}`,t=>{
 const f=fixture(t,fault);freshCandidate(f);
 const result=f.run('set -euo pipefail; export BRAIN_CANDIDATE_OWNERSHIP_FILE="$PWD/logs/brain-candidate-11111111-2222-3333-4444-555555555555.json"; bash scripts/brain-build.sh; SCRIPT_DIR="$PWD/scripts"; ROOT_DIR="$PWD"; source scripts/lib/brain-staging.sh; stage_candidate "$EXPECTED_SHA" "$IMAGE" 1.0.0; candidate_image_cleanup "$EXPECTED_SHA" "$IMAGE" || true');
 assert.equal(result.status,0,result.stderr);
 assert.equal(f.commands().filter(a=>a.includes('rm')&&a.includes(image)).length,1);
 const receipt=JSON.parse(readFileSync(join(f.repo,'logs/brain-candidate-11111111-2222-3333-4444-555555555555.json'),'utf8'));
 assert.equal(receipt.delete_attempted,true);assert.equal(receipt.cleanup_status,'delete_unknown');
 assert.equal(Boolean(f.state('mac-studio').images[image]),fault==='rm-failed');
 assert.equal(realpathSync(f.receipt().candidate_ownership_file),realpathSync(join(f.repo,'logs/brain-candidate-11111111-2222-3333-4444-555555555555.json')));
 const cleanup=f.run('bash scripts/staging-deploy.sh --cleanup');
 assert.notEqual(cleanup.status,0);
 assert.equal(f.commands().filter(a=>a.includes('rm')&&a.includes(image)).length,1);
 assert.ok(f.receipt(),'未确认回收必须保留原绑定');
});

test('实际staging cleanup拒绝坏绑定，合法旧receipt明确无镜像所有权',t=>{
 const f=fixture(t);
 for(const value of ['{',JSON.stringify({candidate_ownership_file:null}),JSON.stringify({candidate_ownership_file:'/tmp/foreign.json',sha:f.sha,image_id:image})]) {
  writeFileSync(f.env.RECEIPT,value);
  const result=f.run('bash scripts/staging-deploy.sh --cleanup');
  assert.notEqual(result.status,0,result.stdout+result.stderr);
  assert.equal(readFileSync(f.env.RECEIPT,'utf8'),value);
 }
 writeFileSync(f.env.RECEIPT,JSON.stringify({sha:f.sha,image_id:image}));
 const legacy=f.run('bash scripts/staging-deploy.sh --cleanup');assert.equal(legacy.status,0,legacy.stderr);
 assert.match(legacy.stdout,/无候选镜像所有权绑定/);
 assert.equal(f.commands().some(a=>a.includes('rm')&&a.includes(image)),false);
});

test('Docker29 buildx本仓唯一自指digest不阻止本次独占镜像回收',t=>{
 const f=fixture(t,'self-digest');freshCandidate(f);
 const result=runBuild(f);assert.equal(result.status,0,result.stderr+result.stdout);
 assert.equal(f.state('mac-studio').images[image],undefined,'真实Docker本仓自指digest导致候选遗留');
 assert.deepEqual(f.commands().filter(a=>a.includes('rm')&&a.includes(image)),[['--context','mac-studio','image','rm',image]]);
});
