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
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
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
