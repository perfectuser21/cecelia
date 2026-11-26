// Docker进程边界共享替身；输出后显式退出前必须同步写完，避免管道收据被截断。
export const dockerFixture = String.raw`
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
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
const result = value => { fs.writeSync(1,String(value)+'\n'); process.exit(0); };
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
  if (contains('{{.Id}}')) result('e'.repeat(64));
  if (contains('staging.request')) result((fault === 'owner'||fault==='owner-after-spool'&&state.snapshotCommitted) ? 'another-request' : state.containers[a[1]]);
  if (contains('cecelia.staging')) result(fault === 'label' ? 'unowned' : 'admission-v1');
  if (contains('State.Health')) result('healthy');
  if (contains('{{.Image}}')) result(e.IMAGE);
}
if (a[0] === 'stop' || a[0] === 'rm') {
  enforceCandidate();
  if (fault === 'cleanup-stop' && state.verified) fail('stop failed');
  if (receipt()?.status === 'success') fail('success receipt preceded cleanup');
  if (a[0] === 'rm') { delete state.containers[a.at(-1)]; if(a.includes('-v')&&a.at(-1)==='cecelia-admission-db')fs.rmSync(path.join(e.STATE_DIR,'snapshot-volume'),{recursive:true,force:true});save(); }
  process.exit(0);
}
if (a[0] === 'exec') {
  const name = a.find(value => ['cecelia-node-brain','cecelia-admission-brain','cecelia-admission-db','e'.repeat(64)].includes(value));
  if (name === 'cecelia-node-brain') {
    enforceProduction();
    if (contains('pg_database_size')) result(fault==='capacity-invalid'?'9007199254740992':fault==='capacity-reserve'?'999999999999':fault.startsWith('receiver-')&&['receiver-limit','receiver-exact-limit'].includes(fault)?'508':'100000000');
    if (contains('pg_dump')) { if (fault === 'dump') fail('dump failed'); if(fault==='dump-empty')process.exit(0);if(fault==='dump-partial'){fs.writeSync(1,'partial');fail('producer failed after bytes');} result(fault==='receiver-exact-limit'?'1234567':'snapshot'); }
    fail('unexpected production exec');
  }
  enforceCandidate();
  if (contains('pg_isready')) process.exit(0);
  if (a.includes('df')) { state.diskChecks=(state.diskChecks||0)+1;save();if(fault==='capacity-after'&&state.diskChecks>1)result('Filesystem 1024-blocks Used Available Capacity Mounted\nfixture 100 90 10 90% /'); if(['receiver-limit','receiver-exact-limit'].includes(fault)) result('Filesystem 1024-blocks Used Available Capacity Mounted\nfixture 6000000 1 5242881 1% /'); result('Filesystem 1024-blocks Used Available Capacity Mounted\nfixture 30000000 5000000 25000000 10% /'); }
  if (a.includes('sh') && a.some(x=>x.startsWith('snapshot-'))) {
    const command=a.indexOf('sh'),args=a.slice(command+1),base=path.join(e.STATE_DIR,'snapshot-volume');
    fs.mkdirSync(base,{recursive:true});
    for(let i=0;i<args.length;i++)args[i]=args[i].replaceAll('/var/lib/postgresql/data',base);
    if(args.includes('snapshot-receive')&&fault==='receiver-write')fail('ENOSPC');
    if(args.includes('snapshot-receive')&&fault==='receiver-disconnect'){fs.readSync(0,Buffer.alloc(1),0,1,null);fail('transport lost');}
    if(args.includes('snapshot-commit')&&fault==='archive-permissions')fs.chmodSync(path.join(args.at(-2),'archive.part'),0o644);
    if(args.includes('snapshot-commit')&&fault==='receiver-rename')args[1]=args[1].replace('mv ', 'false; mv ');
    if(args.includes('snapshot-commit')&&fault==='receiver-wc')args[1]=args[1].replace('bytes=$(wc', 'bytes=$(false; exit 1; wc');
    if(args.includes('snapshot-commit')&&fault==='archive-symlink'){const part=path.join(args.at(-2),'archive.part');fs.unlinkSync(part);fs.symlinkSync('/dev/null',part);}
    if(args.includes('snapshot-cleanup')&&fault==='archive-cleanup')fail('cleanup failed');
    if(process.platform==='darwin')args[1]=args[1].replaceAll('stat -c %a','stat -f %Lp').replaceAll('stat -c %u','stat -f %u');
    const r=spawnSync('sh',args,{stdio:[0,'pipe','pipe']});
    if(args.includes('snapshot-commit')&&r.status===0){state.snapshotCommitted=true;save();}
    if(r.stdout)fs.writeSync(1,r.stdout.toString().replaceAll(base,'/var/lib/postgresql/data'));if(r.stderr)fs.writeSync(2,r.stderr);process.exit(r.status??1);
  }
  if (contains('pg_restore')) { if(a.includes('-i')||!a.includes('--jobs=2'))fail('restore requires regular archive and jobs2');const archive=a.at(-1).replace('/var/lib/postgresql/data',path.join(e.STATE_DIR,'snapshot-volume'));if(!fs.statSync(archive).isFile()||!fs.readFileSync(archive).length)fail('missing regular archive'); if (fault === 'restore') fail('restore failed'); process.exit(0); }
  if (contains('/health')) result(JSON.stringify({status:'healthy',git_sha:fault === 'health' ? 'c'.repeat(40) : e.EXPECTED_SHA,version:'1.0.0',runtime:{isolated:true,background_automation:false}}));
  if (contains('tick/status')) result('{"enabled":false}');
  if (contains('/tasks?')) result('[]');
  if (contains('staging-business.mjs')) result('STAGING_BUSINESS_RECEIPT '+JSON.stringify({protocol:'brain-staging-business/v1',status:'passed',git_sha:e.EXPECTED_SHA,task_id:'11111111-1111-4111-8111-111111111111',run_id:'22222222-2222-4222-8222-222222222222',task_status:'completed_no_pr',run_status:'success',artifact_verified:true,artifact_sha256:'c'.repeat(64),execution_stopped:true,external_services:'not_evaluated'}));
  if (contains('current_database')) {
    state.verified = true; save();
    result(JSON.stringify({database:fault === 'db-readback' ? 'cecelia' : 'cecelia_staging',host:'stage-db',tasks_table:true}));
  }
}
fail('unexpected docker command: ' + JSON.stringify(original));
`;
