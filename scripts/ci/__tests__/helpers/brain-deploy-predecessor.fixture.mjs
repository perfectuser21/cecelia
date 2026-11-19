// 复用现有候选Docker边界fixture；完整真实发布脚本及helper在本人副本内执行。
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,copyFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'../../../..');
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
    if (format === '{{json .}}') result(JSON.stringify({Id:id,RepoTags:Object.keys(state.tags).filter(tag=>state.tags[tag]===id),RepoDigests:fault==='self-digest'?['cecelia-brain@'+id]:fault==='foreign-self-digest'?['other-repo@'+id]:fault==='wrong-self-digest'?['cecelia-brain@'+e.OLD_IMAGE]:fault==='multiple-self-digests'?['cecelia-brain@'+id,'other-repo@'+id]:fault==='digest'?['repo@sha256:digest']:[],Config:{Env:['GIT_SHA='+value.sha]}}));
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

export function runPredecessorScenario(t,scenario){
 const f=fixture(t);
  fs.cpSync(root+'/scripts/lib',f.repo+'/scripts/lib',{recursive:true});
  fs.cpSync(root+'/scripts/brain-image-retention',f.repo+'/scripts/brain-image-retention',{recursive:true});
  let script=fs.readFileSync(root+'/scripts/brain-deploy.sh','utf8');
  assert.equal(script.split('DEPLOY_STATUS_FILE="/tmp/cecelia-deploy-status.json"').length,2);
  script=script.replace('DEPLOY_STATUS_FILE="/tmp/cecelia-deploy-status.json"','DEPLOY_STATUS_FILE="'+f.repo+'/deploy-status.json"');
  fs.writeFileSync(f.repo+'/scripts/brain-deploy.sh',script);
  const previous=f.env.OLD_IMAGE, phantom='sha256:'+'e'.repeat(64);
  const same=scenario.includes('same-version'),noHistory=scenario.endsWith('no-history');
  const priorVersion=same?'1.0.0':'0.8.0',phantomVersion=same?'0.8.0':'0.9.0';
  fs.writeFileSync(f.repo+'/.brain-versions',noHistory?'1.0.0\n':same?'0.8.0\n1.0.0\n':'0.8.0\n0.9.0\n');
  fs.writeFileSync(f.repo+'/.env.docker','TEST_ONLY=1\n');
  fs.mkdirSync(f.dir+'/home/.credentials',{recursive:true});fs.writeFileSync(f.dir+'/home/.credentials/cecelia-internal.env','CECELIA_INTERNAL_TOKEN='+'fixture_only_internal_token_1234567890'+'\n',{mode:0o600});
  const local=f.state('local');local.images[phantom]={sha:'e'.repeat(40),platform:'linux/amd64'};local.tags['cecelia-brain:'+phantomVersion]=phantom;local.tags['cecelia-brain:'+priorVersion]=previous;local.production={id:'1'.repeat(64),image:previous,status:scenario.startsWith('handoff-')?'running':'exited',version:priorVersion};
  fs.writeFileSync(f.dir+'/state/local.json',JSON.stringify(local));
  let fake=fs.readFileSync(f.dir+'/bin/docker','utf8');
  const insert=String.raw`
const disk=e.STATE_DIR+'/local.json',full=JSON.parse(fs.readFileSync(disk,'utf8'));
if(original[0]==='run'&&original.includes('--rm')&&original.includes('host'))process.exit(0);
const prod=full.production,format=original[original.indexOf('--format')+1];
if(e.FULL_SCENARIO.startsWith('handoff-')){
 if(original[0]==='run'&&original.includes('--name')){fs.appendFileSync(e.FULL_HANDOFF_LOG,original.includes('cecelia-bluegreen-sidecar')?'sidecar-started\n':'green-started\n');process.exit(0);}
 if(original[0]==='rm'){if(original.includes('cecelia-node-brain')){fs.appendFileSync(e.FULL_HANDOFF_LOG,'blue-removed\n');full.production.status='absent';fs.writeFileSync(disk,JSON.stringify(full));}process.exit(0);}
 if(original[0]==='inspect'&&original.includes('cecelia-node-brain')){
  if(format.includes('NetworkSettings.Networks')){console.log('host');process.exit(0);}
  if(format.includes('.Mounts'))process.exit(0);
  if(format.includes('.Config.Env')){console.log('DB_NAME=cecelia');process.exit(0);}
 }
}

if(original[0]==='container'&&original[1]==='ls'){if(e.FULL_SCENARIO==='unknown-container-query')process.exit(43);console.log('cecelia-node-brain');process.exit(0);}
if(original[0]==='inspect'){
 const ref=original[1]==='--format'?original.at(-1):original[1];
 if(ref==='cecelia-node-brain'){
  if(format==='{{.State.Status}}'){console.log(prod.status);process.exit(0);}
  if(format==='{{.Image}}'){if(e.FULL_SCENARIO==='unknown-current-image')process.exit(43);console.log(prod.image);process.exit(0);}
 }
 if(format==='{{.Id}}'&&full.images[ref]){console.log(ref);process.exit(0);}
}
if(original[0]==='compose'){
 const target=e.CECELIA_RELEASE_IMAGE||full.tags['cecelia-brain:'+e.BRAIN_VERSION];
 fs.appendFileSync(e.FULL_COMPOSE_LOG,JSON.stringify({args:original,version:e.BRAIN_VERSION,release_image:e.CECELIA_RELEASE_IMAGE||null,resolved_image:target,prior_image:prod.image})+'\n');
 const first=!fs.existsSync(e.FULL_COMPOSE_COUNT);fs.appendFileSync(e.FULL_COMPOSE_COUNT,'x');
 if((first&&!e.FULL_SCENARIO.startsWith('health-'))||(!first&&e.FULL_SCENARIO==='compose-restore-fails')){console.error(first?'fixture candidate compose failed':'fixture recovery compose failed');process.exit(first?7:42);}
 full.production={...prod,image:target,status:'running',version:e.BRAIN_VERSION};fs.writeFileSync(disk,JSON.stringify(full));process.exit(0);
}
`;
  const at='let a = original, host =';assert.ok(fake.includes(at));fake=fake.replace(at,insert+'\n'+at);fs.writeFileSync(f.dir+'/bin/docker',fake,{mode:0o755});
  fs.writeFileSync(f.dir+'/bin/curl',`#!${process.execPath}
if(!process.env.FULL_SCENARIO.startsWith('handoff-'))process.exit(7);
const u=process.argv.at(-1);
if(u.endsWith('/tick/drain')||u.endsWith('/tick/drain-status'))console.log(JSON.stringify({protocol:'brain-process-drain-v1',drain_id:'11111111-1111-4111-8111-111111111111',draining:true,safe_to_swap:true,remaining:0,blockers:[],independent_task_count:0}));
else console.log('{"enabled":true}');
`,{mode:0o755});
  fs.writeFileSync(f.dir+'/bin/timeout','#!/bin/sh\nif [ "$1" = -k ]; then shift 2; fi\nshift\nexec "$@"\n',{mode:0o755});fs.writeFileSync(f.dir+'/bin/ssh','#!/bin/sh\necho forbidden >&2\nexit 99\n',{mode:0o755});
  f.env={...f.env,HOME:f.dir+'/home',HOST_HOME:f.dir+'/home',CECELIA_INTERNAL_ENV_FILE:f.dir+'/home/.credentials/cecelia-internal.env',CECELIA_IMAGE_RETENTION_DIR:f.dir+'/disabled-ledger',FULL_SCENARIO:scenario,FULL_COMPOSE_LOG:f.dir+'/compose.jsonl',FULL_COMPOSE_COUNT:f.dir+'/compose-count',FULL_HANDOFF_LOG:f.dir+'/handoff-events',SKIP_PRE_SWAP_SMOKE:'1',SKIP_POST_DEPLOY_SMOKE:'1'};
  const result=spawnSync('bash',['scripts/brain-deploy.sh'],{cwd:f.repo,env:f.env,encoding:'utf8',timeout:45000});
  const compose=fs.existsSync(f.env.FULL_COMPOSE_LOG)?fs.readFileSync(f.env.FULL_COMPOSE_LOG,'utf8').trim().split('\n').map(JSON.parse):[];
  return {handoff_events:fs.existsSync(f.dir+'/handoff-events')?fs.readFileSync(f.dir+'/handoff-events','utf8'):'',scenario,versions_input:same?['0.8.0','1.0.0']:['0.8.0','0.9.0'],actual_previous:{container_id:local.production.id,image:previous,version:priorVersion,git_sha:'a'.repeat(40)},never_deployed_version:same?null:'0.9.0',candidate:{version:'1.0.0',git_sha:f.sha,image:f.env.IMAGE},exit_code:result.status,signal:result.signal,compose,final_production:f.state('local').production,status:fs.existsSync(f.repo+'/deploy-status.json')?JSON.parse(fs.readFileSync(f.repo+'/deploy-status.json','utf8')):null,stdout:result.stdout,stderr:result.stderr};
}
