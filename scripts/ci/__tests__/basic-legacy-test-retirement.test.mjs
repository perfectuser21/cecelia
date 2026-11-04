import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectVerificationRetirementCandidates } from '../implementation-verification-retirements.mjs';
import { planChecks } from '../basic-scope.mjs';
import { createHash } from 'node:crypto';
const root=fileURLToPath(new URL('../../../', import.meta.url));
const baseline='fadbf32852';
const old=['tick-dispatch-scope-decomposing','tick-kr-decomp'].map(x=>`packages/brain/src/__tests__/${x}.test.js`);
const config='packages/brain/vitest.config.js';
const reviewedSnapshot='ce20b5a29123c9ade1a0bc4aa2753e3ea3fe310d';
const configFact=JSON.parse(readFileSync(join(root,'config/verification-retirements/tick-copied-sql-v1.json'))).replacement_config;
execFileSync('git',['-C',root,'merge-base','--is-ancestor',reviewedSnapshot,'HEAD']);
const reviewedConfig=execFileSync('git',['-C',root,'show',`${reviewedSnapshot}:${config}`]);
assert.equal(execFileSync('git',['-C',root,'ls-tree',reviewedSnapshot,'--',config],{encoding:'utf8'}).trim(),`${configFact.mode} blob ${configFact.git_blob_sha1}\t${config}`);
assert.equal(createHash('sha256').update(reviewedConfig).digest('hex'),configFact.sha256);
assert.equal(reviewedConfig.length,configFact.byte_length);
function fixture(fn) {
  const temp=mkdtempSync(join(tmpdir(),'legacy-test-retirement-')), source=join(temp,'source'), control=join(temp,'control');
  const git=(dir,...args)=>execFileSync('git',['-C',dir,...args],{encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1'}}).trim();
  const commit=dir=>{git(dir,'add','-A');git(dir,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null','commit','-qm','test: reviewed fixture');return git(dir,'rev-parse','HEAD');};
  try {
    execFileSync('git',['clone','--shared','--no-checkout','-q',root,source]);
    git(source,'sparse-checkout','init','--no-cone');
    git(source,'sparse-checkout','set','/packages/brain/vitest.config.js','/packages/brain/src/__tests__/*','/scripts/ci/skill-source-tests.mjs');
    git(source,'checkout','-q',baseline);git(source,'remote','set-url','origin','https://github.com/perfectuser21/cecelia.git');
    const base=git(source,'rev-parse','HEAD');
    for(const path of old)rmSync(join(source,path));
    writeFileSync(join(source,config),reviewedConfig);
    const head=commit(source);
    mkdirSync(control);git(control,'init','-q');git(control,'remote','add','origin','https://github.com/perfectuser21/cecelia.git');
    cpSync(join(root,'config/verification-retirements'),join(control,'config/verification-retirements'),{recursive:true});
    const tooling=commit(control);
    const options=()=>({purpose:'admission_only',toolingRoot:control,toolingRevision:git(control,'rev-parse','HEAD'),source:{repo:'perfectuser21/cecelia',base_revision:base,head_revision:git(source,'rev-parse','HEAD'),changed_files:git(source,'diff','--name-only',base,'HEAD').split('\n').filter(Boolean).map(path=>({path}))}});
    fn({source,control,git,commit,options,head,tooling});
  }finally{rmSync(temp,{recursive:true,force:true});}
}
test('仅冻结过的两份复制SQL测试取得精确退役候选，替代必须为真实生产入口测试',()=>fixture(({source,options})=>{
  const proof=collectVerificationRetirementCandidates(source,options());
  assert.deepEqual(proof.rows.map(x=>x.path).sort(),old.toSorted());
  for(const row of proof.rows){assert.equal(row.retirement_authorized,false);assert.ok(row.replacement_inputs.every(x=>x.selected_candidate));assert.ok(row.audit.retired.length);}
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
  const path='packages/brain/src/__tests__/tick-scheduler.test.js';writeFileSync(join(source,path),readFileSync(join(source,path),'utf8')+'\n// drift\n');commit(source);
  assert.throws(()=>collectVerificationRetirementCandidates(source,options()),/REPLACEMENT/);
}));
test('现役整组件selector覆盖运行时读源码变更，不需要旧fs grep补选器',()=>{
  for(const path of ['packages/brain/src/tick-loop.js','packages/brain/src/tick-scheduler.js']){
    const jobs=planChecks([path]);assert.equal(jobs.filter(x=>x.component==='brain-unit').length,6);
    assert.ok(jobs.some(x=>x.component==='brain-integration'));
  }
});
test('退役fs补选器对默认或任意目录均明确拒绝，不能返回空成功掩盖漏跑',()=>{
  for(const args of [[],['packages/brain/src/__tests__'],['/does/not/exist']]){
    try{execFileSync('bash',[join(root,'.github/workflows/scripts/list-fs-guard-tests.sh'),...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});assert.fail('旧入口不应成功');}
    catch(error){assert.equal(error.status,64);assert.equal(error.stdout,'');assert.match(error.stderr,/已退役/);}
  }
});
test('现役固定Skill helper仅接受审核字节，追加可执行语句也不能取得选择资格',async()=>{
  const { selectVitestVerificationInput } = await import('../implementation-verification-selectors.mjs');
  const input={filePath:'packages/brain/src/__tests__/tick-scheduler.test.js',configPath:config,
    configText:readFileSync(join(root,config),'utf8'),skillText:readFileSync(join(root,'scripts/ci/skill-source-tests.mjs'),'utf8'),component:'brain'};
  assert.equal(selectVitestVerificationInput(input).selected,true);
  assert.throws(()=>selectVitestVerificationInput({...input,skillText:input.skillText+'\nthrow Error("drift");\n'}),/UNPROVEN/);
});
test('冻结base旧测试字节漂移不能以相同文件名套用退役审核',()=>fixture(({source,git,commit,options})=>{
  const original=options().source.base_revision;
  git(source,'reset','--hard',original);
  writeFileSync(join(source,old[0]),readFileSync(join(source,old[0]),'utf8')+'\n// baseline drift\n');
  const base=commit(source);
  for(const path of old)rmSync(join(source,path));
  writeFileSync(join(source,config),reviewedConfig);
  commit(source);
  const opt=options();opt.source.base_revision=base;
  opt.source.changed_files=git(source,'diff','--name-only',base,'HEAD').split('\n').filter(Boolean).map(path=>({path}));
  assert.throws(()=>collectVerificationRetirementCandidates(source,opt),/OLD_TEST_BYTES_MISMATCH/);
}));
test('控制catalog增加任意未审核删除或字节漂移均拒绝',()=>fixture(({source,control,commit,options})=>{
  const path=join(control,'config/verification-retirements/tick-copied-sql-v1.json');
  const catalog=JSON.parse(readFileSync(path,'utf8'));
  catalog.records.push({...catalog.records[0],path:'packages/brain/src/__tests__/tick-loop.test.js'});
  writeFileSync(path,JSON.stringify(catalog));commit(control);
  assert.throws(()=>collectVerificationRetirementCandidates(source,options()),/CATALOG_DIGEST_MISMATCH/);
}));
