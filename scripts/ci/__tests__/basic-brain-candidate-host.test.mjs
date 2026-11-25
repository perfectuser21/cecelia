import {dockerFixture} from './helpers/brain-candidate-docker.fixture.mjs';
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

test('完整快照导出实际使用低压缩，保留完整参数且stdout只有归档字节', t => {
  const f = fixture(t), result = runStage(f);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const dump = f.commands().find(a => a[0] === 'exec' && a[1] === 'cecelia-node-brain' && a[2] === 'sh');
  assert.ok(dump, '必须执行生产Brain的导出入口');
  const captured = join(f.dir, 'dump-args.json');
  writeFileSync(join(f.dir, 'bin/pg_dump'), `#!${process.execPath}
import fs from 'node:fs';
fs.writeFileSync(process.env.CAPTURE_DUMP, JSON.stringify({args: process.argv.slice(2), password: process.env.PGPASSWORD}));
process.stdout.write(Buffer.from([80, 71, 68, 77, 80, 0, 255, 10]));
`, {mode: 0o755});
  for (const port of ['6543', undefined]) {
    const env = {...f.env, CAPTURE_DUMP: captured, DB_NAME: 'cecelia', DB_USER: 'fixture-user',
      DB_HOST: 'source.example.invalid', DB_PASSWORD: 'fixture-password'};
    if (port) env.DB_PORT = port; else delete env.DB_PORT;
    const exported = spawnSync('sh', dump.slice(3), {env, timeout: 10000});
    assert.equal(exported.status, 0, exported.stderr.toString());
    assert.deepEqual(exported.stdout, Buffer.from('PGDMP\0\xff\n', 'latin1'));
    assert.deepEqual(JSON.parse(readFileSync(captured, 'utf8')), {
      args: ['-h', 'source.example.invalid', '-p', port ?? '5432', '-U', 'fixture-user',
        '-d', 'cecelia', '-Fc', '--no-owner', '--no-acl', '--compress=gzip:1'],
      password: 'fixture-password',
    });
  }
});

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
  assert.deepEqual({...f.receipt().database,business:undefined}, { database: 'cecelia_staging', host: 'stage-db', tasks_table: true,business:undefined });
  assert.equal(f.receipt().database.business.artifact_verified,true);
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
for (const fault of ['same-daemon','extra-tag','digest','referenced','container-query','daemon-drift','info-failed-text','foreign-self-digest','wrong-self-digest','multiple-self-digests']) test(`无法证明独占所有权时保留候选镜像：${fault}`,t=>{
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

test('共享Docker替身显式退出前必须完整交付管道输出', t => {
  const f=fixture(t),state=f.state('local');
  state.images=Object.fromEntries(Array.from({length:1000},(_,i)=>['sha256:'+i.toString(16).padStart(64,'0'),{}]));
  writeFileSync(join(f.dir,'state/local.json'),JSON.stringify(state));
  const result=f.run('docker image ls --all --no-trunc --quiet');
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stdout,Object.keys(state.images).join('\n')+'\n');
});

test('共享候选Docker按df命令token识别磁盘检查，SHA内df不得吞业务收据', t => {
  const f=fixture(t),sha='df'+'a'.repeat(38);
  const business=f.run(`docker --context mac-studio exec -e EXPECTED_SHA=${sha} cecelia-admission-brain node scripts/native-agent/staging-business.mjs`);
  assert.equal(business.status,0,business.stderr);
  assert.match(business.stdout,/^STAGING_BUSINESS_RECEIPT /);
  assert.doesNotMatch(business.stdout,/Filesystem/);
  const disk=f.run(`docker --context mac-studio exec -e EXPECTED_SHA=${sha} cecelia-admission-brain df -Pk /`);
  assert.equal(disk.status,0,disk.stderr);assert.match(disk.stdout,/^Filesystem /);
});
