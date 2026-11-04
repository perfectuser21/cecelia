import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import yaml from 'js-yaml';
const root=new URL('../../../',import.meta.url);
const workflow=yaml.load(readFileSync(new URL('.github/workflows/cleanup-merged-artifacts.yml',root),'utf8'));
const shell=workflow.jobs.cleanup.steps.find(s=>s.id==='cleanup').run
 .replaceAll("'./scripts/ci/implementation-auxiliary-evidence.mjs'",JSON.stringify(new URL('scripts/ci/implementation-auxiliary-evidence.mjs',root).href))
 .replace('node scripts/ci/cleanup-merged-artifacts.mjs',`node ${JSON.stringify(new URL('scripts/ci/cleanup-merged-artifacts.mjs',root).pathname)}`);
function fixture(t,files){
 const directory=mkdtempSync(join(tmpdir(),'merged-artifact-cleanup-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const work=join(directory,'main');mkdirSync(work);
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd:work,encoding:'utf8'}).trim();
 git('init','-q');git('config','core.hooksPath','/dev/null');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 for(const name of files){mkdirSync(dirname(join(work,name)),{recursive:true});writeFileSync(join(work,name),'preserve actual bytes\n');}
 git('add','.');git('commit','-qm','fixture');
 const output=join(directory,'outputs');
 const run=(env={})=>spawnSync('bash',['-e','-o','pipefail','-c',shell],{cwd:work,encoding:'utf8',env:{...process.env,GITHUB_OUTPUT:output,...env}});
 return {directory,work,git,run,output};
}
test('仅清理顶层流程文件，前缀同名目录及非Markdown业务资料必须保留',t=>{
 const preserved=['.prd-cp-folder/persistent.md','.task-api.json','docs/.dod-keep.md','PRD.md','DoD.md'];
 const deleted=['.prd-cp-old.md','.dod-cp-old.md','DoD.cp-old.md','.dev-mode.cp-old'];
 const f=fixture(t,[...preserved,...deleted]);const r=f.run();assert.equal(r.status,0,r.stdout+r.stderr);
 for(const name of preserved)assert.equal(readFileSync(join(f.work,name),'utf8'),'preserve actual bytes\n',name);
 for(const name of deleted)assert.equal(existsSync(join(f.work,name)),false,name);
});
test('空格换行通配字符文件名按NUL与literal pathspec精确清理，其他worktree保持原字节',t=>{
 const names=['.prd-cp-space name.md','.task-cp-line\nbreak.md','.dod-cp-[one].md'];
 const f=fixture(t,[...names,'persistent.md']);const active=join(f.directory,'active');f.git('worktree','add','-q','-b','cp-active',active);
 const r=f.run();assert.equal(r.status,0,r.stdout+r.stderr);
 const deleted=f.git('diff','--cached','--name-only','--diff-filter=D','-z').split('\0').filter(Boolean);
 assert.deepEqual(deleted.sort(),[...names].sort());
 for(const name of names)assert.equal(readFileSync(join(active,name),'utf8'),'preserve actual bytes\n');
 assert.equal(readFileSync(join(f.work,'persistent.md'),'utf8'),'preserve actual bytes\n');
});
test('Git读取失败必须失败，不能声明changed=false',t=>{
 const f=fixture(t,['persistent.md']),bin=join(f.directory,'bin');mkdirSync(bin);writeFileSync(join(bin,'git'),'#!/bin/sh\nexit 77\n',{mode:0o700});
 const r=f.run({PATH:bin+':'+process.env.PATH});assert.notEqual(r.status,0,r.stdout+r.stderr);
 if(existsSync(f.output))assert.doesNotMatch(readFileSync(f.output,'utf8'),/changed=false/);
});
test('来源登记损坏时先失败，原始资料与Git索引保持不变',t=>{
 const f=fixture(t,['.prd-cp-old.md','.implementation-source-relations.json']);
 const r=f.run();assert.notEqual(r.status,0,r.stdout+r.stderr);
 assert.equal(readFileSync(join(f.work,'.prd-cp-old.md'),'utf8'),'preserve actual bytes\n');
 assert.equal(f.git('status','--porcelain'), '');
});
test('清理真实fixture拥有既有scripts必需入口',async()=>{
 const {commandsFor}=await import('../run-basic-check.mjs');
 assert.ok(commandsFor('scripts').some(step=>step.args.includes('scripts/ci/__tests__/basic-merged-artifact-cleanup.test.mjs')));
});

test('真实清理PR路径只推独立分支，缺PAT/创建失败/合并请求失败均为红',t=>{
 const command=workflow.jobs.cleanup.steps.find(s=>s.name==='Commit cleanup via PR').run;
 for(const fail of ['missing-token','create','merge','none']){
  const f=fixture(t,['.prd-cp-old.md']);assert.equal(f.run().status,0);
  const remote=join(f.directory,'remote.git');f.git('init','--bare','-q',remote);f.git('remote','add','origin',remote);
  const bin=join(f.directory,'bin'),capture=join(f.directory,'gh-calls');mkdirSync(bin);
  writeFileSync(join(bin,'gh'),`#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(process.env.FIXTURE_CAPTURE,JSON.stringify(args)+'\\n');if(args[1]===process.env.FIXTURE_FAIL)process.exit(17);if(args[1]==='create')console.log('https://example.invalid/pr/1');\n`,{mode:0o700});
  const r=spawnSync('bash',['-e','-o','pipefail','-c',command],{cwd:f.work,encoding:'utf8',env:{...process.env,GH_TOKEN:fail==='missing-token'?'':'fixture-only',COUNT:'1',PATH:bin+':'+process.env.PATH,FIXTURE_CAPTURE:capture,FIXTURE_FAIL:fail}});
  assert.equal(r.status===0,fail==='none',r.stdout+r.stderr);
  assert.equal(f.git('ls-remote','--heads','origin','main'),'');
  if(fail==='missing-token'){assert.equal(existsSync(capture),false);continue;}
  const calls=readFileSync(capture,'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls[0].slice(0,2),['pr','create']);assert.ok(!calls.flat().includes('--admin'));
  if(fail==='create')assert.equal(calls.length,1);
  else {assert.deepEqual(calls[1].slice(0,2),['pr','merge']);assert.ok(calls[1].includes('--auto'));}
 }
});
