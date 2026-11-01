import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {pilotPlanHash} from '../../../packages/brain/src/lib/pilot-release-verification.js';
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'fixed-ci-git-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q','-b','cp-fixture');git('config','core.hooksPath','/dev/null');
 const commit=body=>{writeFileSync(join(root,'contract.json'),body);git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');return git('rev-parse','HEAD');};
 const revision=commit('original fixed bytes');return {root,git,revision,commit};
}
test('fixed commit read defeats real refs/replace payload substitution',async t=>{
 const f=fixture(t),forged=f.commit('forged bytes');f.git('replace',f.revision,forged);
 assert.equal(f.git('show',`${f.revision}:contract.json`),'forged bytes');
 const {readFixedLocalGitBlob}=await import('../fixed-local-git.mjs');
 assert.equal(readFixedLocalGitBlob(f.root,{revision:f.revision,path:'contract.json'}).toString(),'original fixed bytes');
});
test('fixed identity and objects ignore ambient Git repository and object redirects',async t=>{
 const f=fixture(t),other=fixture(t),{fixedLocalGit,readFixedLocalGitBlob}=await import('../fixed-local-git.mjs');
 other.commit('other repository');
 const overrides={GIT_DIR:join(other.root,'.git'),GIT_WORK_TREE:other.root,GIT_OBJECT_DIRECTORY:join(other.root,'.git/objects'),GIT_CONFIG_COUNT:'999',GIT_ALTERNATE_OBJECT_DIRECTORIES:join(other.root,'.git/objects')};
 const prior=Object.fromEntries(Object.keys(overrides).map(k=>[k,process.env[k]]));Object.assign(process.env,overrides);
 try{assert.equal(fixedLocalGit(f.root,['rev-parse','HEAD'],{encoding:'utf8'}).trim(),f.revision);assert.equal(readFixedLocalGitBlob(f.root,{revision:f.revision,path:'contract.json'}).toString(),'original fixed bytes');}
 finally{for(const [key,value]of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
test('allowMissing requires a real commit and exact absent tree path',async t=>{
 const f=fixture(t),{readFixedLocalGitBlob}=await import('../fixed-local-git.mjs');
 assert.equal(readFixedLocalGitBlob(f.root,{revision:f.revision,path:'.skills-source.json'},{allowMissing:true}),null);
 assert.throws(()=>readFixedLocalGitBlob(f.root,{revision:'0'.repeat(40),path:'.skills-source.json'},{allowMissing:true}));
 assert.throws(()=>readFixedLocalGitBlob(f.root,{revision:f.revision,path:'../contract.json'},{allowMissing:true}));
 assert.throws(()=>readFixedLocalGitBlob(f.root,{revision:f.revision,path:'contract.json/missing'},{allowMissing:true}));
});
test('snapshot and pilot source callbacks never bypass isolated Git adapter',()=>{
 for(const file of ['implementation-snapshot.mjs','pilot-release-verification.mjs']){
  const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/execFileSync\(['"]git['"]/);assert.match(source,/readFixedLocalGitBlob|fixedLocalSourceOptions/);
 }
});

test('formal Pilot CLI accepts a historical tracked Skill without a central lock',t=>{
 const f=fixture(t),repo='perfectuser21/zenithjoy-workspace',id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
 const skill='.claude/skills/demo/SKILL.md',content='---\nname: demo\nversion: 1\n---\nlegacy fixed skill\n';
 mkdirSync(join(f.root,'.claude/skills/demo'),{recursive:true});writeFileSync(join(f.root,skill),content);
 mkdirSync(join(f.root,'scripts/smoke'),{recursive:true});writeFileSync(join(f.root,'scripts/smoke/pilot.sh'),'#!/bin/bash\nset -e\ntest -f .claude/skills/demo/SKILL.md\n');
 const revision=f.commit('original fixed bytes');f.git('remote','add','origin',`https://github.com/${repo}.git`);f.git('update-ref','refs/remotes/origin/main',revision);
 const hash=value=>typeof value==='string'?createHash('sha256').update(value).digest('hex'):pilotPlanHash(value);
 const row=(n,payload,identity)=>{const source={repo,path:'contract.json',commit:revision};return {id:id(n),...identity,source_repo:repo,source_path:source.path,source_commit:revision,payload,payload_sha256:hash({source,payload})};};
 const activity=row(2,{activity_id:id(3),steps:[{step_id:id(4),locator:{activity_id:id(3),step_key:'verify'}}],implementation_bindings:[{kind:'skill',scope:'activity',status:'verified',repo,path:skill,revision,digest:'sha256:'+hash(content)}]},{activity_id:id(3)});
 const workflow=row(1,{workflow_id:id(5),capability_id:id(6),activities:[{reference_id:id(7),activity_id:id(3),activity_version_id:id(2)}]},{workflow_id:id(5)});
 const snapshot={schema_version:1,scope:'zenithjoy',repo,revision,status:'verified',gaps:[],definitions:{workflows:[workflow],activities:[activity]},assertions:[null,id(4)].map((step,i)=>({id:id(10+i),journey_id:id(6),step_id:id(3),step_id_ref:step,cell_kind:'scenario',cell_key:`regression:${id(6)}:${step||'activity'}`,assertion_ref:'scripts/smoke/pilot.sh',assertion_revision:1}))};
 snapshot.snapshot_sha256=hash(snapshot);
 const input=join(f.root,'../legacy-snapshot-'+revision+'.json'),output=join(f.root,'../legacy-output-'+revision);
 t.after(()=>{rmSync(input,{force:true});rmSync(output,{recursive:true,force:true});});writeFileSync(input,JSON.stringify({snapshot}));
 const result=spawnSync(process.execPath,[new URL('../pilot-release-verification.mjs',import.meta.url).pathname,'--repo-root',f.root,'--snapshot',input,'--output-dir',output,'--event','push','--ref','refs/heads/main'],{encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(readFileSync(join(output,'receipt.json'))).verdict,'PASS');
});
test('local shared clone remains available while network clone is rejected before Git',async t=>{
 const f=fixture(t),{fixedLocalGit}=await import('../fixed-local-git.mjs'),target=join(f.root,'../fixed-local-clone-'+f.revision);
 t.after(()=>rmSync(target,{recursive:true,force:true}));
 fixedLocalGit(f.root,['clone','--shared','--no-checkout','--quiet',f.root,target],{localClone:true});
 assert.equal(fixedLocalGit(target,['rev-parse','HEAD'],{encoding:'utf8'}).trim(),f.revision);
 assert.throws(()=>fixedLocalGit(f.root,['clone','https://example.invalid/repo',target],{localClone:true}),/INVALID_LOCAL_CLONE/);
});

test('merge keeps both caller timeoutMs and shared deadline without accepting expired or invalid budgets',async t=>{
 const f=fixture(t),{fixedLocalGit}=await import('../fixed-local-git.mjs');
 assert.equal(fixedLocalGit(f.root,['rev-parse','HEAD'],{encoding:'utf8',deadline:Date.now()+10000,timeoutMs:10000}).trim(),f.revision);
 for(const budget of [{deadline:Date.now()-1},{timeoutMs:0},{timeoutMs:NaN},{deadline:NaN}])assert.throws(()=>fixedLocalGit(f.root,['rev-parse','HEAD'],budget),/FIXED_GIT_READ_TIMEOUT/);
 const bin=join(f.root,'slow-git');mkdirSync(bin);writeFileSync(join(bin,'git'),'#!/bin/sh\nsleep 2\n',{mode:0o700});
 const before=process.env.PATH;process.env.PATH=bin+':'+before;
 try{for(const budget of [{deadline:Date.now()+10000,timeoutMs:20},{deadline:Date.now()+20,timeoutMs:10000}]){const start=Date.now();assert.throws(()=>fixedLocalGit(f.root,['rev-parse','HEAD'],budget));assert.ok(Date.now()-start<1000,'must apply the tighter caller budget');}}finally{process.env.PATH=before;}
});

test('merge uses authorized external central cache but rejects cache or git-directory symlinks',async t=>{
 const f=fixture(t),{createFixedLocalSourceReader}=await import('../fixed-local-git.mjs'),{symlinkSync}=await import('node:fs');
 const repo='perfectuser21/zenithjoy-workspace',central='perfectuser21/zenithjoy-skills';
 const make=cache=>{const read=createFixedLocalSourceReader(f.root,repo,{centralSourceDir:cache,readBusinessFile:()=>Buffer.from(JSON.stringify({version:1,repository:central,revision:f.revision}))});read({repo,revision:f.revision,path:'.skills-source.json'});return read;};
 const location={repo:central,revision:f.revision,path:'contract.json'};
 assert.equal(make(f.root)(location).toString(),'original fixed bytes');
 const link=join(f.root,'cache-link');symlinkSync(f.root,link,'dir');assert.throws(()=>make(link)(location),/FIXED_LOCAL_CACHE_SYMLINK/);
 const bad=join(f.root,'cache-git-link');mkdirSync(bad);symlinkSync(join(f.root,'.git'),join(bad,'.git'),'dir');assert.throws(()=>make(bad)(location),/FIXED_LOCAL_CACHE_SYMLINK/);
});

// 真实MainSnapshot原生入口执行数据合同；不执行捕获树中的任何源码。
import {fileURLToPath} from 'node:url';
import {readFrozenFutureBytes,decodeFrozenFutureBytes,frozenFutureGit} from '../../../packages/brain/src/lib/__tests__/helpers/future-active-git.js';
test('固定future数据解码验证真实Git blobs，损坏payload和不存在路径拒绝',async()=>{
 const bytes=readFrozenFutureBytes(),data=decodeFrozenFutureBytes(bytes);
 assert.equal(data.base_revision,'35e2a91d971e8dc432d6f36361c65cded5d64ec8');
 assert.equal(data.captured_revision,'14fce437dcccf1b30daf17423ec48a3ed4337eee');
 assert.equal(data.captured_tree,'f5b015b0a66e798efd666a842364c36579e163f8');
 const repoRoot=fileURLToPath(new URL('../../../',import.meta.url)),frozen=frozenFutureGit(repoRoot);
 assert.equal(frozen.revision,data.captured_revision);
 for(const [path,blob]of[['.github/workflows/implementation-impact.yml','7002260fd7e84006037343416de6123f593afb12'],['scripts/ci/implementation-multi-pr-gate.mjs','043fd77da634c2e9ccb800f66262cca31b158e0a']]){
  const row=data.delta.find(row=>row.path===path),actual=Buffer.from(await frozen.read(path));
  assert.equal(row.blob_sha1,blob);assert.deepEqual(actual,Buffer.from(row.content_base64,'base64'));
  assert.equal(createHash('sha1').update(`blob ${actual.length}\0`).update(actual).digest('hex'),blob);
 }
 const {readFixedLocalGitBlob}=await import('../fixed-local-git.mjs'),fallback='README.md';
 assert.equal(data.delta.some(row=>row.path===fallback),false);
 const ordinary=Buffer.from(await frozen.read(fallback));assert.deepEqual(ordinary,readFixedLocalGitBlob(repoRoot,{revision:data.base_revision,path:fallback}));
 assert.equal(createHash('sha1').update(`blob ${ordinary.length}\0`).update(ordinary).digest('hex'),'ef41b1f5d27bb4db060b171c861c64d7673c9626');
 await assert.rejects(frozen.read('scripts/ci/unknown-fixture-path.mjs'),/FUTURE_FIXTURE_MISSING/);
 const corrupt=Buffer.from(bytes);corrupt[corrupt.length-1]^=1;
 assert.throws(()=>decodeFrozenFutureBytes(corrupt),/FUTURE_FIXTURE_DIGEST/);
});

import {createPublishedGit,readPublishedGitFixture,PUBLISHED_CI_REVISION} from '../../../packages/brain/src/lib/__tests__/helpers/published-workspace-ci-git.js';
test('published八对象私有Git冷还原读取canonical两blob，替换、环境外跳和损坏对象拒绝',t=>{
 const f=createPublishedGit();t.after(f.close);
 assert.equal(f.revision,PUBLISHED_CI_REVISION);assert.equal(f.git('rev-parse',`${f.revision}^{tree}`).toString().trim(),'4fa4b4002588ab45f537e4c63756bc4560bb8003');
 assert.equal(existsSync(join(f.directory,'.git/objects/info/alternates')),false);assert.throws(()=>f.git('remote','get-url','origin'));
 const hashes=[['.github/workflows/implementation-impact.yml','5a43bfd48709018ee641952747b15f3c949099f2'],['scripts/ci/implementation-skill-source.mjs','2351ae6a69b066a7e15dbb17e2e6babc13a31305']];
 const check=()=>{for(const[path,hash]of hashes){const bytes=f.read(path);assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),hash);}};check();
 const tree=f.git('mktree').toString().trim(),forged=execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit-tree',tree,'-p',f.revision],{cwd:f.directory,env:f.env,input:'isolated replacement\n'}).toString().trim();
 f.git('replace',f.revision,forged);
 assert.throws(()=>execFileSync('git',['show',`${f.revision}:${hashes[0][0]}`],{cwd:f.directory,env:f.env,stdio:'pipe'}));check();
 const names=['GIT_DIR','GIT_WORK_TREE','GIT_OBJECT_DIRECTORY'],prior=Object.fromEntries(names.map(key=>[key,process.env[key]]));
 Object.assign(process.env,{GIT_DIR:join(f.directory,'outside.git'),GIT_WORK_TREE:join(f.directory,'outside'),GIT_OBJECT_DIRECTORY:join(f.directory,'outside-objects')});
 try{check();}finally{for(const[key,value]of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
 const damaged=readPublishedGitFixture();damaged.objects[0].content_base64=Buffer.from('corrupt Git object').toString('base64');
 assert.throws(()=>createPublishedGit({data:damaged}),{code:'ERR_ASSERTION'});
 f.close();assert.equal(existsSync(f.directory),false);
});
