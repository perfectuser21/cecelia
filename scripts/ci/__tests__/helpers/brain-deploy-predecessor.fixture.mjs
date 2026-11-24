import {dockerFixture} from './brain-candidate-docker.fixture.mjs';
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

export function runPredecessorScenario(t,scenario,{prepare}={}){
 const f=fixture(t);
  fs.cpSync(root+'/scripts/lib',f.repo+'/scripts/lib',{recursive:true});
  fs.cpSync(root+'/scripts/brain-image-retention',f.repo+'/scripts/brain-image-retention',{recursive:true});
  let script=fs.readFileSync(root+'/scripts/brain-deploy.sh','utf8');
  assert.equal(script.split('DEPLOY_STATUS_FILE="/tmp/cecelia-deploy-status.json"').length,2);
  script=script.replace('DEPLOY_STATUS_FILE="/tmp/cecelia-deploy-status.json"','DEPLOY_STATUS_FILE="'+f.repo+'/deploy-status.json"');
  if(scenario==='handoff-parent-return-failure'){
   const source='source "$SCRIPT_DIR/lib/bluegreen.sh"';assert.ok(script.includes(source));
   script=script.replace(source,source+"\neval \"$(declare -f bluegreen_swap | sed '1s/bluegreen_swap/fixture_bluegreen_swap/')\"\nbluegreen_swap() { fixture_bluegreen_swap \"$@\"; return 42; }");
  }
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
  if(format==='{{.Image}}'){if(e.FULL_SCENARIO==='handoff-invalid-previous'){console.log('not-an-immutable-id');process.exit(0);}if(e.FULL_SCENARIO==='handoff-failed-previous'){console.log(prod.image);process.exit(43);}if(e.FULL_SCENARIO==='unknown-current-image')process.exit(43);console.log(prod.image);process.exit(0);}
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
const u=process.argv.at(-1);require('node:fs').appendFileSync(process.env.FULL_CURL_LOG,u+'\\n');
if(u.endsWith('/tick/drain')||u.endsWith('/tick/drain-status'))console.log(JSON.stringify({protocol:'brain-process-drain-v1',drain_id:'11111111-1111-4111-8111-111111111111',draining:true,safe_to_swap:true,remaining:0,blockers:[],independent_task_count:0}));
else console.log('{"enabled":true}');
`,{mode:0o755});
  fs.writeFileSync(f.dir+'/bin/timeout','#!/bin/sh\nif [ "$1" = -k ]; then shift 2; fi\nshift\nexec "$@"\n',{mode:0o755});fs.writeFileSync(f.dir+'/bin/ssh','#!/bin/sh\necho forbidden >&2\nexit 99\n',{mode:0o755});
  f.env={...f.env,HOME:f.dir+'/home',HOST_HOME:f.dir+'/home',CECELIA_INTERNAL_ENV_FILE:f.dir+'/home/.credentials/cecelia-internal.env',CECELIA_IMAGE_RETENTION_DIR:f.dir+'/disabled-ledger',FULL_SCENARIO:scenario,FULL_COMPOSE_LOG:f.dir+'/compose.jsonl',FULL_COMPOSE_COUNT:f.dir+'/compose-count',FULL_HANDOFF_LOG:f.dir+'/handoff-events',FULL_CURL_LOG:f.dir+'/curl-events',BLUEGREEN_HANDOFF:scenario==='inherited-handoff'?'1':'0',SKIP_PRE_SWAP_SMOKE:'1',SKIP_POST_DEPLOY_SMOKE:'1'};
  prepare?.(f);
  const result=spawnSync('bash',['scripts/brain-deploy.sh'],{cwd:f.repo,env:f.env,encoding:'utf8',timeout:45000});
  const compose=fs.existsSync(f.env.FULL_COMPOSE_LOG)?fs.readFileSync(f.env.FULL_COMPOSE_LOG,'utf8').trim().split('\n').map(JSON.parse):[];
  return {docker_calls:f.commands(),curl_events:fs.existsSync(f.dir+'/curl-events')?fs.readFileSync(f.dir+'/curl-events','utf8'):'',handoff_events:fs.existsSync(f.dir+'/handoff-events')?fs.readFileSync(f.dir+'/handoff-events','utf8'):'',scenario,versions_input:same?['0.8.0','1.0.0']:['0.8.0','0.9.0'],actual_previous:{container_id:local.production.id,image:previous,version:priorVersion,git_sha:'a'.repeat(40)},never_deployed_version:same?null:'0.9.0',candidate:{version:'1.0.0',git_sha:f.sha,image:f.env.IMAGE},exit_code:result.status,signal:result.signal,compose,final_production:f.state('local').production,status:fs.existsSync(f.repo+'/deploy-status.json')?JSON.parse(fs.readFileSync(f.repo+'/deploy-status.json','utf8')):null,stdout:result.stdout,stderr:result.stderr};
}
