import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectVerificationRetirementCandidates } from '../implementation-verification-retirements.mjs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { planChecks } from '../basic-scope.mjs';
const root=fileURLToPath(new URL('../../../', import.meta.url));
const baseline='fadbf32852';
const old=['tests/regression/relay-1b1f1ffa/preview-destroyer.test.js','packages/brain/src/__tests__/planner-initiative-plan.test.js','packages/brain/src/__tests__/actions-initiative-orchestration.test.js',
  'packages/brain/src/__tests__/tasks-status.test.js','tests/regression/relay-1b1f1ffa/capacity-gate.test.js',
  'tests/regression/relay-57e25e92/headed-smoke-contract.test.ts','tests/regression/relay-07b2fd3b/captures-api.test.ts'];
const config='packages/brain/vitest.config.js';
function fixture(fn) {
  const temp=mkdtempSync(join(tmpdir(),'legacy-test-retirement-')), source=join(temp,'source'), control=join(temp,'control');
  const git=(dir,...args)=>execFileSync('git',['-c','gc.auto=0','-c','maintenance.auto=false','-c','gc.autoDetach=false','-C',dir,...args],{encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim();
  const commit=dir=>{git(dir,'add','--sparse','-A');git(dir,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null','commit','-qm','test: reviewed fixture');return git(dir,'rev-parse','HEAD');};
  try {
    git(root,'clone','--shared','--no-checkout','-q',root,source);
    for(const [key,value]of [['gc.auto','0'],['maintenance.auto','false'],['gc.autoDetach','false']])git(source,'config',key,value);
    git(source,'sparse-checkout','init','--no-cone');
    git(source,'sparse-checkout','set','/packages/brain/vitest.config.js','/packages/brain/src/__tests__/*','/scripts/ci/','/.github/workflows/nightly-regression.yml','/packages/brain/src/routes/__tests__/','/packages/brain/src/lib/__tests__/','/packages/brain/src/__tests__/integration/','/tests/regression/relay-1b1f1ffa/','/tests/regression/relay-57e25e92/','/tests/regression/relay-07b2fd3b/');
    git(source,'checkout','-q',baseline);git(source,'remote','set-url','origin','https://github.com/perfectuser21/cecelia.git');
    const base=git(source,'rev-parse','HEAD');
    for(const path of old)rmSync(join(source,path));
    writeFileSync(join(source,config),readFileSync(join(root,config)));
    for (const path of ['packages/brain/src/__tests__/debt-04-planner-score.test.js', 'packages/brain/src/__tests__/actions.test.js','packages/brain/src/routes/__tests__/captures-api.test.ts']) writeFileSync(join(source,path),readFileSync(join(root,path)));
    for (const input of JSON.parse(readFileSync(join(root,'config/verification-retirements/brain-debt-retired-layers-v1.json'))).replacement_inputs) {const path=(input.blob||input).path;mkdirSync(dirname(join(source,path)),{recursive:true});writeFileSync(join(source,path),readFileSync(join(root,path)));}
    writeFileSync(join(source,'scripts/ci/deep-integration.config.mjs'),readFileSync(join(root,'scripts/ci/deep-integration.config.mjs')));
    const reviewed=JSON.parse(readFileSync(join(root,'config/verification-retirements/brain-debt-retired-layers-v1.json')));
    for (const input of [...reviewed.replacement_configs.map(x=>x.blob),...reviewed.entry_support]) {
      const path=input.path;mkdirSync(dirname(join(source,path)),{recursive:true});writeFileSync(join(source,path),readFileSync(join(root,path)));
    }
    const head=commit(source);
    mkdirSync(control);git(control,'init','-q');
    for(const [key,value]of [['gc.auto','0'],['maintenance.auto','false'],['gc.autoDetach','false']])git(control,'config',key,value);
    git(control,'remote','add','origin','https://github.com/perfectuser21/cecelia.git');
    cpSync(join(root,'config/verification-retirements'),join(control,'config/verification-retirements'),{recursive:true});
    const tooling=commit(control);
    const options=()=>({purpose:'admission_only',toolingRoot:control,toolingRevision:git(control,'rev-parse','HEAD'),source:{repo:'perfectuser21/cecelia',base_revision:base,head_revision:git(source,'rev-parse','HEAD'),changed_files:git(source,'diff','--name-only',base,'HEAD').split('\n').filter(Boolean).map(path=>({path}))}});
    fn({source,control,git,commit,options,head,tooling});
  }finally{rmSync(temp,{recursive:true,force:true});}
}
test('仅冻结过的七份逐项审核旧测试取得精确退役候选，替代必须为现役评分及拒绝入口测试',()=>fixture(({source,options})=>{
  const proof=collectVerificationRetirementCandidates(source,options());
  assert.deepEqual(proof.rows.map(x=>x.path).sort(),old.toSorted());
  for(const row of proof.rows){assert.equal(row.retirement_authorized,false);assert.ok(row.replacement_inputs.every(x=>x.selected_candidate || x.requires_selector_reverification && x.selector_witness.kind==='fixed_pg_literal_candidate'));assert.ok(row.audit.retired.length);}
}));
test('旧测试字节漂移与任意未列删除不能借退役合同放行',()=>fixture(({source,git,commit,options,head})=>{
  const other='packages/brain/src/__tests__/tick-loop.test.js';
  rmSync(join(source,other));commit(source);
  const proof=collectVerificationRetirementCandidates(source,options());
  assert.equal(proof.rows.some(x=>x.path===other),false);
  git(source,'reset','--hard',head);
  const path=old[0],bytes=git(source,'show',`${options().source.base_revision}:${path}`);
  mkdirSync(dirname(join(source,path)),{recursive:true});writeFileSync(join(source,path),bytes+'\n// drift\n');commit(source);
  assert.throws(()=>collectVerificationRetirementCandidates(source,options()),/DELETION|ABSENCE/);
}));
test('替代行为字节漂移必须拒绝，不能靠catalog声明替代',()=>fixture(({source,commit,options})=>{
  const path='packages/brain/src/__tests__/debt-04-planner-score.test.js';writeFileSync(join(source,path),readFileSync(join(source,path),'utf8')+'\n// drift\n');commit(source);
  assert.throws(()=>collectVerificationRetirementCandidates(source,options()),/REPLACEMENT/);
}));
test('新目录不能扩展未知删除或以重算摘要自行授权',()=>fixture(({source,control,commit,options})=>{
  const path=join(control,'config/verification-retirements/brain-debt-retired-layers-v1.json');
  const catalog=JSON.parse(readFileSync(path,'utf8'));
  catalog.records.push({...catalog.records[0],path:'packages/brain/src/__tests__/tick-loop.test.js'});
  writeFileSync(path,JSON.stringify(catalog));commit(control);
  assert.throws(()=>collectVerificationRetirementCandidates(source,options()),/CATALOG_DIGEST_MISMATCH/);
}));
test('PR基线配置与两项旧文件均按fadbf精确字节核对',()=>fixture(({source,git,commit,options})=>{
  const original=options().source.base_revision;
  git(source,'reset','--hard',original);
  writeFileSync(join(source,old[0]),readFileSync(join(source,old[0]),'utf8')+'\n// baseline drift\n');
  const base=commit(source);
  for(const path of old)rmSync(join(source,path));
  writeFileSync(join(source,config),readFileSync(join(root,config)));
  for (const path of ['packages/brain/src/__tests__/debt-04-planner-score.test.js','packages/brain/src/__tests__/actions.test.js']) writeFileSync(join(source,path),readFileSync(join(root,path)));
  const reviewed=JSON.parse(readFileSync(join(root,'config/verification-retirements/brain-debt-retired-layers-v1.json')));
  for (const input of [...reviewed.replacement_inputs.map(x=>x.blob||x),...reviewed.replacement_configs.map(x=>x.blob),...reviewed.entry_support]) {
    const path=input.path;mkdirSync(dirname(join(source,path)),{recursive:true});writeFileSync(join(source,path),readFileSync(join(root,path)));
  }
  commit(source);
  const opt=options();opt.source.base_revision=base;
  opt.source.changed_files=git(source,'diff','--name-only',base,'HEAD').split('\n').filter(Boolean).map(path=>({path}));
  assert.throws(()=>collectVerificationRetirementCandidates(source,opt),/OLD_TEST_BYTES_MISMATCH/);
}));
for(const path of ['scripts/ci/deep-integration.config.mjs','scripts/ci/debt-pg.config.mjs',
  'scripts/ci/debt-pg-tests.json','scripts/ci/run-debt-pg.mjs','scripts/ci/private-pg-backend.mjs',
  'scripts/ci/private-pg-contract.mjs','.github/workflows/nightly-regression.yml',
  'packages/brain/src/routes/__tests__/captures-api.test.ts',
  'packages/brain/src/__tests__/integration/capacity-gate.test.js',
  'packages/brain/src/__tests__/integration/retired-harness-dispatch.pg.integration.test.js',
  'packages/brain/src/__tests__/integration/task-status-transitions.integration.test.js']) {
  test(`PG候选的原生入口/固定依赖/替代字节漂移拒绝：${path}`,()=>fixture(({source,commit,options})=>{
    const file=join(source,path);writeFileSync(file,readFileSync(file,'utf8')+'\n// drift\n');commit(source);
    assert.throws(()=>collectVerificationRetirementCandidates(source,options()),/CONFIG|POLICY|REPLACEMENT/);
  }));
}
test('PG输入只给固定路径候选，保持需重新选择/无执行覆盖资格',()=>fixture(({source,options})=>{
  const rows=collectVerificationRetirementCandidates(source,options()).rows;
  const candidates=rows.flatMap(row=>row.replacement_inputs).filter(input=>input.selector_witness.kind==='fixed_pg_literal_candidate');
  assert.equal(candidates.length,5);
  for(const input of candidates){
    assert.equal(input.selected_candidate,false);assert.equal(input.requires_selector_reverification,true);
    assert.equal(input.entry_verified,false);assert.equal(input.owner_verified,false);
    assert.equal(input.selector_witness.execution_status,'not_evaluated');
  }
}));

test('夹具即使仓内gc.auto=1也不能触发自动维护或留下后台写入',()=>fixture(({source,git})=>{
  git(source,'config','gc.auto','1');
  git(source,'config','gc.autoDetach','false');
  const hooks=join(source,'.git/hooks');mkdirSync(hooks,{recursive:true});
  git(source,'config','core.hooksPath',hooks);
  const hook=join(hooks,'pre-auto-gc');
  writeFileSync(hook,'#!/bin/sh\nprintf fired > auto-gc-fired\n');chmodSync(hook,0o755);
  // Git的loose-object采样使用17号扇出；有效对象使gc.auto=1必定越阈值。
  const directory=join(source,'.git/objects/17');mkdirSync(directory,{recursive:true});
  let written=0;
  for(let index=0;written<3;index++){
    const body=Buffer.from(`owned fixture GC probe ${index}`);
    const object=Buffer.concat([Buffer.from(`blob ${body.length}\0`),body]);
    const id=createHash('sha1').update(object).digest('hex');
    if(id.startsWith('17')){writeFileSync(join(directory,id.slice(2)),deflateSync(object));written++;}
  }
  git(source,'gc','--auto');
  assert.equal(existsSync(join(source,'auto-gc-fired')),false,'夹具Git启动了自动GC；清理目录时可能仍有写入者');
  assert.equal(git(source,'config','--get','gc.auto'),'0');
  assert.equal(git(source,'config','--get','maintenance.auto'),'false');
}));
