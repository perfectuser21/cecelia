import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import yaml from 'js-yaml';
const root = new URL('../../../', import.meta.url);
const workflow = yaml.load(readFileSync(new URL('.github/workflows/archive-learnings.yml', root), 'utf8'));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'archive-learnings-'));
  t.after(() => rmSync(dir, {recursive:true, force:true}));
  const run = (cmd,args,env={}) => {
    const r = spawnSync(cmd,args,{cwd:dir,encoding:'utf8',env:{...process.env,...env}});
    assert.equal(r.status,0,r.stdout+r.stderr); return r.stdout;
  };
  mkdirSync(join(dir,'docs/learnings/archive'),{recursive:true});
  mkdirSync(join(dir,'scripts/ci'),{recursive:true});
  try {copyFileSync(new URL('scripts/ci/archive-learnings.py',root),join(dir,'scripts/ci/archive-learnings.py'));} catch(e) {if(e.code!=='ENOENT')throw e;}
  const put=(name,body)=>writeFileSync(join(dir,'docs/learnings',name),body);
  run('git',['init','-q']); run('git',['config','user.name','Fixture']);run('git',['config','user.email','fixture@example.invalid']);
  const commit=()=>{run('git',['add','.']);run('git',['-c','core.hooksPath=/dev/null','commit','-qm','fixture'],{GIT_AUTHOR_DATE:'2020-01-02T00:00:00Z',GIT_COMMITTER_DATE:'2020-01-02T00:00:00Z'});};
  const archive=()=>spawnSync('bash',['-e','-o','pipefail','-c',workflow.jobs.archive.steps.find(s=>s.id==='archive').run],{cwd:dir,encoding:'utf8',env:{...process.env,GITHUB_OUTPUT:join(dir,'output')}});
  return {dir,run,put,commit,archive};
}
test('同月已有tar与新learning合并，原内容逐字保留，重跑不丢失',t=>{
 const f=fixture(t);f.put('prior.md','old evidence\n');
 f.run('tar',['-czf','docs/learnings/archive/2020-01.tar.gz','-C','docs/learnings','prior.md']);
 rmSync(join(f.dir,'docs/learnings/prior.md'));f.put('new space.md','new evidence\n');f.commit();
 const r=f.archive();
 for(const [name,body] of [['prior.md','old evidence\n'],['new space.md','new evidence\n']])
   assert.equal(f.run('tar',['-xOzf','docs/learnings/archive/2020-01.tar.gz',name]),body);
 assert.equal(r.status,0,r.stdout+r.stderr);
 assert.match(f.run('git',['status','--porcelain']),/D .*new space.md/);
 const again=f.archive();assert.equal(again.status,0,again.stdout+again.stderr);
 assert.match(readFileSync(join(f.dir,'output'),'utf8'),/changed=false/);
});
test('同名不同内容或损坏已有tar时失败且保留原始learning和归档',t=>{
 for(const corrupt of [false,true]) {
  const f=fixture(t);f.put('repeat.md','old evidence');
  f.run('tar',['-czf','docs/learnings/archive/2020-01.tar.gz','-C','docs/learnings','repeat.md']);
  if(corrupt) writeFileSync(join(f.dir,'docs/learnings/archive/2020-01.tar.gz'),'broken');
  const before=readFileSync(join(f.dir,'docs/learnings/archive/2020-01.tar.gz'));
  f.put('repeat.md','new evidence');f.commit();const r=f.archive();assert.notEqual(r.status,0,r.stdout+r.stderr);
  assert.equal(readFileSync(join(f.dir,'docs/learnings/repeat.md'),'utf8'),'new evidence');
  assert.deepEqual(readFileSync(join(f.dir,'docs/learnings/archive/2020-01.tar.gz')),before);
 }
});

test('第二月桶损坏时第一月桶也不替换，所有原文档保留',t=>{
 const f=fixture(t);f.put('january.md','january evidence');f.commit();
 f.put('february.md','february evidence');f.run('git',['add','.']);
 f.run('git',['-c','core.hooksPath=/dev/null','commit','-qm','february'],{GIT_AUTHOR_DATE:'2020-02-02T00:00:00Z',GIT_COMMITTER_DATE:'2020-02-02T00:00:00Z'});
 writeFileSync(join(f.dir,'docs/learnings/archive/2020-02.tar.gz'),'broken');
 const r=f.archive();assert.notEqual(r.status,0);
 for(const name of ['january.md','february.md'])assert.ok(readFileSync(join(f.dir,'docs/learnings',name)).length>0);
 assert.equal(f.run('git',['status','--porcelain']).includes('D '),false);
 assert.throws(()=>readFileSync(join(f.dir,'docs/learnings/archive/2020-01.tar.gz')),/ENOENT/);
});
test('普通源码保底scripts入口自动执行归档真实fixture测试',async()=>{
 const {commandsFor}=await import('../run-basic-check.mjs');
 const paths=commandsFor('scripts').flatMap(step=>step.args);
 assert.ok(paths.includes('scripts/ci/__tests__/basic-archive-learnings.test.mjs'));
});
