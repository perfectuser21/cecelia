import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
