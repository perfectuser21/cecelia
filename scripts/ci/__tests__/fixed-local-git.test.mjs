import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
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
  assert.doesNotMatch(source,/execFileSync\(['"]git['"]/);assert.match(source,/readFixedLocalGitBlob/);
 }
});

test('formal Pilot CLI accepts a historical tracked Skill without a central lock',t=>{
 const f=fixture(t),repo='perfectuser21/zenithjoy-workspace',id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
 const skill='.claude/skills/demo/SKILL.md',content='---\nname: demo\nversion: 1\n---\nlegacy fixed skill\n';
 mkdirSync(join(f.root,'.claude/skills/demo'),{recursive:true});writeFileSync(join(f.root,skill),content);
 mkdirSync(join(f.root,'scripts/smoke'),{recursive:true});writeFileSync(join(f.root,'scripts/smoke/pilot.sh'),'#!/bin/bash\nset -e\ntest -f .claude/skills/demo/SKILL.md\n');
 const revision=f.commit('original fixed bytes');f.git('update-ref','refs/remotes/origin/main',revision);
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
