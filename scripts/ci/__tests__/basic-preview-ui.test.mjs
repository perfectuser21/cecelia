import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import yaml from 'js-yaml';

const cli=new URL('../preview-ui.mjs',import.meta.url).pathname;
function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'preview-fixed-diff-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd:dir,encoding:'utf8'}).trim();
  git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');
  function commit(file){mkdirSync(dirname(join(dir,file)),{recursive:true});writeFileSync(join(dir,file),Math.random().toString());git('add','--',file);git('commit','-qm','fixture');return git('rev-parse','HEAD');}
  const base=commit('README.md');
  const run=(head,env={},baseRef=base)=>spawnSync(process.execPath,[cli,'--base',baseRef,'--head',head],{
    cwd:dir,encoding:'utf8',env:{PATH:process.env.PATH,EVENT_NAME:'pull_request',EVENT_ACTION:'synchronize',...env},
  });
  return {dir,git,commit,base,run};
}
test('固定PR差异只为真实UI变更申请预览，空差异及后台变更不部署',t=>{
  const f=fixture(t),backend=f.commit('packages/brain/src/worker.js');
  assert.equal(f.run(backend).status,0);
  assert.equal(f.run(backend).stdout.trim(),'false');
  assert.equal(f.run(f.base).stdout.trim(),'false');
  for(const file of ['apps/dashboard/src/App.tsx','apps/api/features/inbox/index.ts']){
    const head=f.commit(file),result=f.run(head);
    assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'true');
  }
});
test('未知事件、closed、缺Git对象、非法或缺失SHA均拒绝且无true输出',t=>{
  const f=fixture(t),head=f.commit('apps/dashboard/src/App.tsx');
  for(const result of [f.run(head,{EVENT_NAME:'push'}),f.run(head,{EVENT_ACTION:'closed'}),
    f.run('f'.repeat(40)),f.run(head,{},'main'),f.run(head,{},'a;touch bad'),
    spawnSync(process.execPath,[cli],{cwd:f.dir,encoding:'utf8',env:{PATH:process.env.PATH,EVENT_NAME:'pull_request'}})]){
    assert.notEqual(result.status,0);assert.notEqual(result.stdout.trim(),'true');
  }
});
test('HEAD变化和git replace不能改变事件冻结的预览判定，结果写真实output',t=>{
  const f=fixture(t),backend=f.commit('packages/brain/src/worker.js'),ui=f.commit('apps/dashboard/src/App.tsx');
  f.git('replace',backend,ui);
  const output=join(f.dir,'output');
  const result=f.run(backend,{GITHUB_OUTPUT:output});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'false');
  assert.equal(readFileSync(output,'utf8'),'preview_ui=false\n');
});
test('实际workflow预览入口自行判定，只有明确true才执行原预览action',()=>{
  const doc=yaml.load(readFileSync(new URL('../../../.github/workflows/ci.yml',import.meta.url),'utf8'));
  const job=doc.jobs['preview-deploy'];
  assert.equal(job.needs,undefined);
  assert.ok(!job.if.includes('needs.plan'));
  assert.ok(job.if.includes("github.event_name == 'pull_request'"));
  const scope=job.steps.find(step=>step.id==='preview_scope');
  assert.ok(scope);
  assert.deepEqual(scope.env,{EVENT_NAME:'${{ github.event_name }}',EVENT_ACTION:'${{ github.event.action }}',BASE_SHA:'${{ github.event.pull_request.base.sha }}',HEAD_SHA:'${{ github.event.pull_request.head.sha }}'});
  assert.equal(scope.run,'node scripts/ci/preview-ui.mjs --base "$BASE_SHA" --head "$HEAD_SHA"');
  assert.equal(job.steps.find(step=>step.uses==='./.github/actions/preview-deploy').if,"steps.preview_scope.outputs.preview_ui == 'true'");
  assert.equal(job.steps.find(step=>step.uses==='actions/checkout@v4').with['fetch-depth'],0);
});
