import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync,execFileSync,spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const source=resolve(import.meta.dirname,'../../..');
function fixture(t){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'release-order-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const repo=join(dir,'repo');mkdirSync(repo);cpSync(join(source,'scripts'),join(repo,'scripts'),{recursive:true});
 mkdirSync(join(repo,'packages/brain'),{recursive:true});writeFileSync(join(repo,'packages/brain/package.json'),'{}');
 writeFileSync(join(repo,'scripts/brain-deploy.sh'),'#!/bin/bash\necho deploy >> "$OPERATIONS"\n');
 const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
 git('init','-q','-b','main');git('config','core.hooksPath','/dev/null');git('config','user.name','fixture');git('config','user.email','fixture@example.invalid');
 git('add','.');git('commit','-qm','A');const a=git('rev-parse','HEAD');writeFileSync(join(repo,'marker'),'B');git('add','.');git('commit','-qm','B');const b=git('rev-parse','HEAD');
 git('init','-q','--bare',join(dir,'origin.git'));git('remote','add','origin',join(dir,'origin.git'));git('push','-q','origin','main');
 const state=join(dir,'current.json');writeFileSync(state,JSON.stringify({sha:b}));
 // Only daemon/HTTP boundaries are substituted. Production store+ledger and file locks stay real.
 writeFileSync(join(repo,'scripts/brain-image-retention/runtime.mjs'),`import {readFile} from 'node:fs/promises';import {createStore} from './storage.mjs';import {createDeploymentLedger} from './ledger.mjs';
 export const ROOT=process.env.LEDGER;export async function createRuntime(){const store=createStore(ROOT);const value=async()=>JSON.parse(await readFile(process.env.CURRENT,'utf8'));const health=async()=>({status:'healthy',version:'1.0.0',git_sha:(await value()).sha});const docker={containerBusinessReadback:async id=>({protocol:'brain-release-readback/v1',status:'passed',container_id:id,task_count:0,task_sample_sha256:'e'.repeat(64),scope:'read_only',external_services:'not_evaluated'}),snapshot:async()=>({containers:[{id:'c'.repeat(64),name:'/cecelia-node-brain',running:(await value()).running??true,image_id:'sha256:'+'d'.repeat(64)}],images:[{id:'sha256:'+'d'.repeat(64),git_sha:(await value()).sha,tags:['cecelia-brain:1.0.0']}]})};return {store,docker,health,ledger:createDeploymentLedger({store,docker,health})};}export async function readHealth(){return {status:'healthy',version:'1.0.0',git_sha:JSON.parse(await readFile(process.env.CURRENT,'utf8')).sha};}`);
 mkdirSync(join(dir,'ledger'),{mode:0o700});mkdirSync(join(dir,'bin'));writeFileSync(join(dir,'bin/docker'),'#!/bin/sh\nexit 0\n',{mode:0o755});writeFileSync(join(dir,'bin/npm'),'#!/bin/sh\necho npm >> "$OPERATIONS"\n',{mode:0o755});writeFileSync(join(dir,'bin/curl'),'#!/bin/sh\ncat "$CURRENT"\n',{mode:0o755});
 const operations=join(dir,'operations');const run=target=>spawnSync('bash',[join(repo,'scripts/deploy-local.sh'),'--changed=packages/brain/src/x.js','main'],{cwd:repo,encoding:'utf8',timeout:20000,env:{...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,CECELIA_DEPLOY_ROOT:repo,CECELIA_DEPLOY_FORCE_GUARD:'1',CECELIA_DEPLOY_AUTORESET:'1',EXPECTED_SHA:target,CURRENT:state,LEDGER:join(dir,'ledger'),OPERATIONS:operations}});
 return {dir,repo,a,b,git,state,run,operations,runtimeText:readFileSync(join(repo,'scripts/brain-image-retention/runtime.mjs'),'utf8')};
}
test('真实自动入口：B已经现役且原生成功收据落盘后旧A新请求不得reset或部署',async t=>{const f=fixture(t);
 const {createStore}=await import(pathToFileURL(join(f.repo,'scripts/brain-image-retention/storage.mjs')));
 const {createDeploymentLedger}=await import(pathToFileURL(join(f.repo,'scripts/brain-image-retention/ledger.mjs')));
 const store=createStore(join(f.dir,'ledger'));const docker={snapshot:async()=>({containers:[{id:'c'.repeat(64),name:'/cecelia-node-brain',running:true,image_id:'sha256:'+'d'.repeat(64)}],images:[{id:'sha256:'+'d'.repeat(64),git_sha:f.b,tags:['cecelia-brain:1.0.0']}]}),containerBusinessReadback:async id=>({protocol:'brain-release-readback/v1',status:'passed',container_id:id,task_count:0,task_sample_sha256:'e'.repeat(64),scope:'read_only',external_services:'not_evaluated'})};const ledger=createDeploymentLedger({store,docker,health:async()=>({status:'healthy',version:'1.0.0',git_sha:f.b})});const id='11111111-1111-4111-8111-111111111111';await ledger.begin({deployment_id:id,git_sha:f.b,version:'1.0.0'});await ledger.finish(id,'success');const saved=readFileSync(join(f.dir,'ledger/ledger.json'),'utf8');
 const r=f.run(f.a);assert.notEqual(r.status,0,r.stdout+r.stderr);assert.match(r.stderr,/DEPLOY_TARGET_STALE/);assert.equal(f.git('rev-parse','HEAD'),f.b);assert.equal(existsSync(f.operations),false);assert.equal(readFileSync(join(f.dir,'ledger/ledger.json'),'utf8'),saved);});

test('同一真实发布锁内等待者晚到：拿锁后必须重读B，不能采用锁前A',async t=>{const f=fixture(t);writeFileSync(f.state,JSON.stringify({sha:f.a}));mkdirSync(join(f.repo,'logs'),{recursive:true});const ready=join(f.dir,'ready');
 const holder=spawn('bash',['-c',`exec 9>"$LOCK"; flock -x 9; touch "$READY"; sleep 0.6; printf '%s' "$NEXT" > "$CURRENT"`],{env:{...process.env,LOCK:join(f.repo,'logs/brain-release.lock'),READY:ready,CURRENT:f.state,NEXT:JSON.stringify({sha:f.b})}});
 t.after(()=>holder.kill());for(let n=0;n<100&&!existsSync(ready);n++)await new Promise(r=>setTimeout(r,10));assert.ok(existsSync(ready));
 const r=f.run(f.a);assert.notEqual(r.status,0);assert.match(r.stderr,/DEPLOY_TARGET_STALE/);assert.equal(f.git('rev-parse','HEAD'),f.b);assert.equal(existsSync(f.operations),false);
});
test('真实入口正常向前及同SHA准入；健康端点失败不妨碍已知镜像修复',t=>{for(const [same,running] of [[false,true],[true,true],[false,false]]){const f=fixture(t);writeFileSync(f.state,JSON.stringify({sha:same?f.b:f.a,running}));const r=f.run(f.b);assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(f.git('rev-parse','HEAD'),f.b);assert.ok(readFileSync(f.operations,'utf8').includes('deploy'));}});
test('现役对象未知与分叉均在reset前拒绝',t=>{for(const unknown of [true,false]){const f=fixture(t);let sha='e'.repeat(40);if(!unknown){f.git('checkout','-qb','side',f.a);writeFileSync(join(f.repo,'side'),'side');f.git('add','.');f.git('commit','-qm','side');sha=f.git('rev-parse','HEAD');f.git('checkout','-q','main');}writeFileSync(f.state,JSON.stringify({sha}));const r=f.run(f.b);assert.notEqual(r.status,0);assert.match(r.stderr,/DEPLOY_(ORDER_UNKNOWN|TARGET_STALE)/);assert.equal(f.git('rev-parse','HEAD'),f.b);assert.equal(existsSync(f.operations),false);}});
test('B在途时A waiter等待，B结算后仍不得重触发A',t=>{const f=fixture(t),status=join(f.dir,'status.sh'),trigger=join(f.dir,'trigger.sh'),count=join(f.dir,'count');
 writeFileSync(status,`#!/bin/bash
if [[ ! -f "${count}" ]]; then echo 1 > "${count}"; printf '%s' '${JSON.stringify({status:'running',git_sha:f.a})}'; else printf '%s' '${JSON.stringify({status:'success',git_sha:f.b})}'; fi
`);
 writeFileSync(trigger,'#!/bin/bash\necho retrigger >> "$OPERATIONS"\necho 202\n');const r=spawnSync('bash',[join(source,'scripts/ci/gate3-wait-deploy.sh'),'http://fixture.invalid',f.a],{encoding:'utf8',timeout:10000,env:{...process.env,REPO_DIR:f.repo,REQUIRE_EXACT_SHA:'1',STATUS_CMD:'bash '+status,TRIGGER_CMD:'bash '+trigger,POLL_INTERVAL_S:'0',MAX_POLLS:'4',OPERATIONS:f.operations}});assert.notEqual(r.status,0);assert.match(r.stdout,/DEPLOY_TARGET_REJECTED/);assert.equal(existsSync(f.operations),false);
});

test('真实父子bash继承同一FD9，brain_release_lock重入到达下一阶段且竞争者仍被锁住',t=>{const f=fixture(t);mkdirSync(join(f.repo,'logs'),{recursive:true});const child=join(f.dir,'child.sh');
 writeFileSync(child,`set -euo pipefail
source "${f.repo}/scripts/lib/brain-staging.sh"
brain_release_lock
node -e 'require("fs").writeFileSync(process.env.OPERATIONS,"child-next-stage")'
`);
 const r=spawnSync('bash',['-c',`set -euo pipefail; export ROOT_DIR="$REPO"; source "$REPO/scripts/lib/brain-staging.sh"; brain_release_lock; bash "$CHILD"; flock -n "$ROOT_DIR/logs/brain-release.lock" -c 'exit 0' && exit 81; test "$(cat "$OPERATIONS")" = child-next-stage`],{encoding:'utf8',timeout:4000,env:{...process.env,ROOT_DIR:f.repo,REPO:f.repo,CHILD:child,OPERATIONS:f.operations,PATH:join(f.dir,'bin')+':'+process.env.PATH}});
 assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(r.signal,null);assert.equal(readFileSync(f.operations,'utf8'),'child-next-stage');
});

function directEntry(f,target){
 writeFileSync(join(f.repo,'scripts/brain-image-retention/runtime.mjs'),f.runtimeText);
 let script=readFileSync(join(source,'scripts/brain-deploy.sh'),'utf8');
 script=script.replace('DEPLOY_STATUS_FILE="/tmp/cecelia-deploy-status.json"',`DEPLOY_STATUS_FILE="${f.dir}/direct-status.json"`);
 writeFileSync(join(f.repo,'scripts/brain-deploy.sh'),script);
 // Only stop at the next ledger CLI boundary. The actual direct entry, fetch,
 // release flock, Docker identity adapter and Git ordering helper all run.
 writeFileSync(join(f.dir,'bin/node'),`#!/bin/bash
if [[ "$1" == */brain-image-retention/cli.mjs && "$2" == begin ]]; then echo direct-next-stage >> "$OPERATIONS"; exit 73; fi
exec '${process.execPath}' "$@"
`,{mode:0o755});
 return spawnSync('bash',[join(f.repo,'scripts/brain-deploy.sh')],{cwd:f.repo,encoding:'utf8',timeout:15000,env:{...process.env,PATH:join(f.dir,'bin')+':'+process.env.PATH,EXPECTED_SHA:target,CURRENT:f.state,LEDGER:join(f.dir,'ledger'),OPERATIONS:f.operations,HOST_HOME:join(f.dir,'home'),CECELIA_INTERNAL_ENV_FILE:join(f.dir,'internal.env')}});
}
test('实际direct入口锁内fetch：合法remote-only新main准入到下一阶段',t=>{const f=fixture(t);const publisher=join(f.dir,'publisher');execFileSync('git',['clone','-q','--branch','main',join(f.dir,'origin.git'),publisher]);const git=(...args)=>execFileSync('git',['-C',publisher,...args],{encoding:'utf8'}).trim();git('config','core.hooksPath','/dev/null');git('config','user.name','fixture');git('config','user.email','fixture@example.invalid');writeFileSync(join(publisher,'remote-new'),'new-main');git('add','.');git('commit','-qm','remote-only');const target=git('rev-parse','HEAD');git('push','-q','origin','main');assert.throws(()=>f.git('cat-file','-e',target+'^{commit}'));
 const r=directEntry(f,target);assert.equal(r.signal,null);assert.match(r.stdout,/DEPLOY_ORDER_ACCEPTED/);assert.equal(readFileSync(f.operations,'utf8'),'direct-next-stage\n');assert.equal(f.git('rev-parse','origin/main'),target);
});
test('实际direct入口拒绝本地已知但未合并的current后代feature',t=>{const f=fixture(t);f.git('checkout','-qb','feature-local');writeFileSync(join(f.repo,'feature-only'),'not-merged');f.git('add','.');f.git('commit','-qm','feature-only');const target=f.git('rev-parse','HEAD');f.git('checkout','-q','main');const r=directEntry(f,target);assert.notEqual(r.status,0);assert.match(r.stderr,/DEPLOY_TARGET_UNMERGED/);assert.equal(existsSync(f.operations),false);assert.equal(f.git('rev-parse','HEAD'),f.b);});
