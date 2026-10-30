import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readNativeConsumerRuntime} from '../../../packages/brain/src/lib/native-consumer-runtime.js';
import {inspectRecoveryRuntime,verifyRecoveryAuthority,sealRecoveryBundle,assertRecoveryPurpose,assertRecoveryDispatch,validateSourceDelta,RECOVERY_BRIDGE} from '../implementation-source-recovery.mjs';
const repo='perfectuser21/cecelia',hash=x=>createHash('sha256').update(x).digest('hex');
const dir=mkdtempSync(join(tmpdir(),'source-recovery-'));
const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('config','core.hooksPath','/dev/null');
git('remote','add','origin',`https://github.com/${repo}.git`);
const paths=readNativeConsumerRuntime().files.map(f=>f.path);
for(const p of [...paths,'scripts/lib/brain-staging.sh','scripts/brain-deploy.sh']){mkdirSync(dirname(join(dir,p)),{recursive:true});writeFileSync(join(dir,p),`// original ${p}\n`);}
mkdirSync(join(dir,'.github/workflows'),{recursive:true});writeFileSync(join(dir,'.github/workflows/implementation-impact.yml'),'jobs:\n  gate:\n    name: fixed-base-gate\n');
writeFileSync(join(dir,'.github/workflows/ci.yml'),'jobs:\n  lint-auto-merge-decision:\n    steps:\n      - uses: actions/checkout@v4\n');writeFileSync(join(dir,'packages/brain/package.json'),'{}');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
writeFileSync(join(dir,paths[0]),'// reviewed collector\n');writeFileSync(join(dir,'packages/brain/package.json'),JSON.stringify({cecelia_source_only:true}));writeFileSync(join(dir,'scripts/brain-deploy.sh'),readFileSync(new URL('../../../scripts/brain-deploy.sh',import.meta.url)));git('add','.');git('commit','-qam','merged source-only');const head=git('rev-parse','HEAD');
test.after(()=>rmSync(dir,{recursive:true,force:true}));
const identity={schema_version:1,repo,git_sha:base,files:paths.map(path=>({path,sha256:hash(`// original ${path}\n`)}))};
const opts={repoRoot:dir,base,head};
function api(overrides={}){
 const routes={
  [`repos/${repo}/commits/main`]:{sha:head},
  [`repos/${repo}/branches/main/protection/required_status_checks`]:{strict:true,contexts:['ci-passed','Harness V5 Gate Passed','Smoke Glob Runner Passed','Skill source ownership']},
  [`repos/${repo}/commits/${head}/pulls`]:[{number:9}],
  [`repos/${repo}/pulls/9`]:{number:9,merged:true,merge_commit_sha:head,head:{sha:'a'.repeat(40),repo:{full_name:repo}},base:{sha:base,ref:'main',repo:{full_name:repo}}},
  [`repos/${repo}/commits/${'a'.repeat(40)}/check-runs?per_page=100`]:{total_count:5,check_runs:['ci-passed','Harness V5 Gate Passed','Smoke Glob Runner Passed','Skill source ownership','Implementation impact gate'].map((name,index)=>({id:index+10,url:`https://api.github.com/repos/${repo}/check-runs/${index+10}`,name,status:'completed',conclusion:'success',head_sha:'a'.repeat(40),app:{slug:'github-actions'},details_url:'https://github.com/perfectuser21/cecelia/actions/runs/7/job/8'}))},
  [`repos/${repo}/actions/jobs/8`]:{id:8,run_id:7,run_attempt:2,head_sha:'a'.repeat(40),name:'Implementation impact gate',check_run_url:`https://api.github.com/repos/${repo}/check-runs/14`,status:'completed',conclusion:'success'},
  [`repos/${repo}/actions/runs/7`]:{id:7,status:'completed',conclusion:'success',run_attempt:2,event:'pull_request',path:'.github/workflows/implementation-impact.yml',head_sha:'a'.repeat(40),repository:{full_name:repo},head_repository:{full_name:repo},pull_requests:[{number:9,base:{sha:base},head:{sha:'a'.repeat(40)}}]},
 };
 return async p=>structuredClone(Object.hasOwn(overrides,p)?overrides[p]:routes[p]);
}
test('合并main由旧base的独立PR准入成功后才准许来源编译',async()=>{
 const proof=await verifyRecoveryAuthority(opts,{github:api()});assert.equal(proof.base_revision,base);assert.equal(proof.head_revision,head);assert.equal(proof.impact_run_id,7);
});
test('旧生产部署脚本保持来源恢复准入，任意漂移拒绝',()=>{
 const sourceRoot=fileURLToPath(new URL('../../../',import.meta.url));
 const legacy=execFileSync('git',['show','e3a01021ee7100b83d8ed5a0be219d0b543b5dff:scripts/brain-deploy.sh'],{cwd:sourceRoot});
 for(const [name,bytes] of [['legacy',legacy]]){
  const scratch=mkdtempSync(join(tmpdir(),`recovery-deploy-${name}-`));
  try{
   execFileSync('git',['clone','-q',dir,scratch]);
   const g=(...args)=>execFileSync('git',args,{cwd:scratch,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
   g('config','user.name','Fixture');g('config','user.email','fixture@example.invalid');g('config','core.hooksPath','/dev/null');
   writeFileSync(join(scratch,'scripts/brain-deploy.sh'),bytes);
   g('add','.');g('commit','--allow-empty','-qm',`reviewed ${name}`);
   assert.doesNotThrow(()=>validateSourceDelta(scratch,base,g('rev-parse','HEAD')));
   writeFileSync(join(scratch,'scripts/brain-deploy.sh'),Buffer.concat([bytes,Buffer.from('\n# unreviewed drift\n')]));
   g('commit','-qam','unreviewed drift');
   assert.throws(()=>validateSourceDelta(scratch,base,g('rev-parse','HEAD')),/SOURCE_RECOVERY_DEPLOY_GUARD_UNREVIEWED/);
  }finally{rmSync(scratch,{recursive:true,force:true});}
 }
});
test('来源恢复容纳已审 Claude 只读 tuple 测试而不扩大生产文件范围',()=>{
 const scratch=mkdtempSync(join(tmpdir(),'recovery-reader-test-'));
 try{
  execFileSync('git',['clone','-q',dir,scratch]);
  const g=(...args)=>execFileSync('git',args,{cwd:scratch,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  g('config','user.name','Fixture');g('config','user.email','fixture@example.invalid');g('config','core.hooksPath','/dev/null');
  const path='packages/brain/src/__tests__/claude-channel-retired.reader-tuples.test.js';
  mkdirSync(dirname(join(scratch,path)),{recursive:true});writeFileSync(join(scratch,path),'// reviewed read-only tuple guard\n');
  g('add','.');g('commit','-qm','reviewed tuple guard');
  assert.doesNotThrow(()=>validateSourceDelta(scratch,base,g('rev-parse','HEAD')));
  const unreviewed='packages/brain/src/__tests__/unreviewed-executor.test.js';
  writeFileSync(join(scratch,unreviewed),'// unrelated execution change\n');
  g('add','.');g('commit','-qm','unreviewed execution');
  assert.throws(()=>validateSourceDelta(scratch,base,g('rev-parse','HEAD')),/SOURCE_RECOVERY_OPERATIONAL_CHANGE/);
 }finally{rmSync(scratch,{recursive:true,force:true});}
});
for(const [name,route,value] of [
 ['未合并',`pulls/9`,{merged:false}],['主干漂移','commits/main',{sha:base}],
 ['没有关联PR',`commits/${head}/pulls`,[]],
 ['缺独立检查',`commits/${'a'.repeat(40)}/check-runs?per_page=100`,{total_count:0,check_runs:[]}],
 ['错误base运行','actions/runs/7',{id:7,status:'completed',conclusion:'success',run_attempt:2,event:'pull_request',path:'.github/workflows/implementation-impact.yml',head_sha:'a'.repeat(40),repository:{full_name:repo},head_repository:{full_name:repo},pull_requests:[{number:9,base:{sha:'b'.repeat(40)},head:{sha:'a'.repeat(40)}}]}],
])test(`${name}不能产来源基线`,async()=>assert.rejects(verifyRecoveryAuthority(opts,{github:api({[`repos/${repo}/${route}`]:value})})));
test('实读旧collector身份只记not_deployed，绝不标ready',async()=>{
 const r=await inspectRecoveryRuntime({...opts,brainUrl:'http://fixture.invalid',token:'fixture'},{fetchFn:async()=>new Response(JSON.stringify(identity))});
 assert.equal(r.status,'source_only');assert.equal(r.runtime_status,'not_deployed');assert.equal(r.runtime.git_sha,base);
});
test('任一旧collector哈希漂移或HTTP错误拒绝恢复',async()=>{
 const bad=structuredClone(identity);bad.files[0].sha256='0'.repeat(64);
 for(const response of [new Response(JSON.stringify(bad)),new Response('{}',{status:503})])await assert.rejects(inspectRecoveryRuntime({...opts,brainUrl:'http://fixture.invalid',token:'fixture'},{fetchFn:async()=>response}));
});
test('恢复来源产物不得用于release，不能把业务unknown洗成通过',()=>{
 const s={revision:head,scope:'cecelia-factory',snapshot_scope:'consumer_evidence',execution_status:'unknown',status:'verified',gaps:[]};
 const sealed=sealRecoveryBundle(s,{head_revision:head,base_revision:base,runtime_status:'not_deployed'});
 assert.equal(sealed.execution_status,'unknown');assert.equal(sealed.source_baseline.purpose,'admission_source_only');
 assertRecoveryPurpose(sealed,'pr');assert.throws(()=>assertRecoveryPurpose(sealed,'main'),/SOURCE_RECOVERY_RELEASE_FORBIDDEN/);
});

for(const [name,eventName,ref,event] of [
 ['普通push','push','refs/heads/main',{inputs:{source_baseline_recovery:true}}],
 ['未显式恢复','workflow_dispatch','refs/heads/main',{inputs:{source_baseline_recovery:false}}],
 ['可复用workflow','workflow_call','refs/heads/main',{inputs:{source_baseline_recovery:true}}],
 ['非main','workflow_dispatch','refs/heads/feature',{inputs:{source_baseline_recovery:true}}],
])test(`${name}拒绝source-only降级`,()=>assert.throws(()=>assertRecoveryDispatch({eventName,ref,event,runId:'12'}),/SOURCE_RECOVERY_DISPATCH_REQUIRED/));
test('仅main显式dispatch可进入来源验证',()=>assertRecoveryDispatch({eventName:'workflow_dispatch',ref:'refs/heads/main',event:{inputs:{source_baseline_recovery:'true'}},runId:'12'}));
for(const [name,patch] of [['错误run',{run_id:88}],['旧attempt',{run_attempt:1}],['伪造check链接',{check_run_url:'https://api.github.com/repos/perfectuser21/cecelia/check-runs/99'}],['另一job',{id:9}],['失败job',{conclusion:'failure'}]])test(`${name}不认可Impact成功`,async()=>{
 const route=`repos/${repo}/actions/jobs/8`,original=await api()(route);
 await assert.rejects(verifyRecoveryAuthority(opts,{github:api({[route]:{...original,...patch}})}),/SOURCE_RECOVERY_IMPACT_JOB_INVALID/);
});
for(const [name,patch] of [['运行未结束',{status:'in_progress'}],['运行失败',{conclusion:'failure'}],['运行重跑',{run_attempt:3}]])test(`${name}不认可旧Impact成功`,async()=>{
 const route=`repos/${repo}/actions/runs/7`,original=await api()(route);
 await assert.rejects(verifyRecoveryAuthority(opts,{github:api({[route]:{...original,...patch}})}));
});
test('required检查固定App不符拒绝',async()=>{
 const route=`repos/${repo}/branches/main/protection/required_status_checks`,original=await api()(route);
 await assert.rejects(verifyRecoveryAuthority(opts,{github:api({[route]:{...original,checks:[{context:'ci-passed',app_id:1234}]}})}),/SOURCE_RECOVERY_CHECK_APP_MISMATCH/);
});
for(const [name,path,text] of [['CI生产命令','.github/workflows/ci.yml','jobs:\n  deploy:\n    run: production\n'],['非gate中央写入','.github/workflows/implementation-impact.yml','jobs:\n  gate:\n    name: fixed-base-gate\n  injected:\n    run: curl -X POST production\n'],['runtime修改','scripts/lib/brain-staging.sh','# altered runtime\n'],['migration修改','packages/brain/migrations/999-bypass.sql','DROP TABLE captures;\n']])test(`${name}不属于来源恢复`,()=>{
 const scratch=mkdtempSync(join(tmpdir(),'recovery-delta-'));
 try{
  execFileSync('git',['clone','-q',dir,scratch]);
  const g=(...args)=>execFileSync('git',args,{cwd:scratch,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  g('config','user.name','Fixture');g('config','user.email','fixture@example.invalid');g('config','core.hooksPath','/dev/null');
  mkdirSync(dirname(join(scratch,path)),{recursive:true});writeFileSync(join(scratch,path),text);g('add','.');g('commit','-qm','unreviewed');
  assert.throws(()=>validateSourceDelta(scratch,base,g('rev-parse','HEAD')),/SOURCE_RECOVERY_(?:OPERATIONAL_CHANGE|WORKFLOW_UNREVIEWED|CI_CHANGE_INVALID)/);
 }finally{rmSync(scratch,{recursive:true,force:true});}
});

// 使用真实固定f63→706历史；承载CI job checkout fetch-depth=0保证永久正例。
const bridgeRoot=mkdtempSync(join(tmpdir(),'source-recovery-bridge-'));
const realRoot=fileURLToPath(new URL('../../../',import.meta.url));
execFileSync('git',['clone','--shared','--no-checkout','-q',realRoot,bridgeRoot]);
const bg=(...args)=>execFileSync('git',args,{cwd:bridgeRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
bg('config','user.name','Fixture');bg('config','user.email','fixture@example.invalid');bg('config','core.hooksPath','/dev/null');bg('remote','set-url','origin',`https://github.com/${repo}.git`);
bg('sparse-checkout','set','--no-cone','/packages/brain/package.json','/scripts/brain-deploy.sh');bg('checkout','-q','--detach',RECOVERY_BRIDGE.directBase);
const manifest=JSON.parse(readFileSync(join(bridgeRoot,'packages/brain/package.json')));manifest.cecelia_source_only=true;
writeFileSync(join(bridgeRoot,'packages/brain/package.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(join(bridgeRoot,'scripts/brain-deploy.sh'),readFileSync(join(realRoot,'scripts/brain-deploy.sh')));
bg('commit','-qam','reviewed source-only fixture');const bridgeHead=bg('rev-parse','HEAD');
test.after(()=>rmSync(bridgeRoot,{recursive:true,force:true}));
function bridgeApi({mutate=()=>{},head=bridgeHead}={}){
 const required=['ci-passed','Harness V5 Gate Passed','Smoke Glob Runner Passed','Skill source ownership'];
 const routes={[`repos/${repo}/commits/main`]:{sha:head},[`repos/${repo}/branches/main/protection/required_status_checks`]:{strict:true,contexts:required}};
 for(const [revision,parent,prHead,pr,runId,jobId,missing]of [[RECOVERY_BRIDGE.directBase,RECOVERY_BRIDGE.baseline,RECOVERY_BRIDGE.prHead,6591,39626350180,119312495827,false],[head,RECOVERY_BRIDGE.directBase,'e'.repeat(40),9999,90,91,true]]){
  const result=missing?'failure':'success';
  routes[`repos/${repo}/commits/${revision}/pulls`]=[{number:pr}];
  routes[`repos/${repo}/pulls/${pr}`]={number:pr,merged:true,merge_commit_sha:revision,head:{sha:prHead,repo:{full_name:repo}},base:{sha:parent,ref:'main',repo:{full_name:repo}}};
  routes[`repos/${repo}/commits/${prHead}/check-runs?per_page=100`]={total_count:5,check_runs:[...required,'Implementation impact gate'].map((name,i)=>({id:i===4?jobId:i,name,head_sha:prHead,status:'completed',conclusion:i===4?result:'success',app:{slug:'github-actions'},details_url:`https://github.com/${repo}/actions/runs/${runId}/job/${jobId}`,url:`https://api.github.com/repos/${repo}/check-runs/${i===4?jobId:i}`}))};
  routes[`repos/${repo}/actions/runs/${runId}`]={id:runId,status:'completed',conclusion:result,run_attempt:2,event:'pull_request',path:'.github/workflows/implementation-impact.yml',head_sha:prHead,repository:{full_name:repo},head_repository:{full_name:repo},pull_requests:[{number:pr,base:{sha:parent},head:{sha:prHead}}]};
  routes[`repos/${repo}/actions/jobs/${jobId}`]={id:jobId,run_id:runId,run_attempt:2,head_sha:prHead,name:'Implementation impact gate',check_run_url:`https://api.github.com/repos/${repo}/check-runs/${jobId}`,status:'completed',conclusion:result,started_at:'2026-10-22T01:00:00Z',completed_at:'2026-10-22T01:05:00Z',steps:[{name:'下载固定SHA中央bundle（PR无中央写凭据）',conclusion:result},{name:'实际变更影响与固定回归',conclusion:missing?'skipped':'success'}]};
 }
 routes[`repos/${repo}/actions/runs/90/artifacts?per_page=100`]={total_count:1,artifacts:[{id:20,name:`implementation-evidence-${'e'.repeat(40)}`,expired:false,digest:'sha256:'+'c'.repeat(64),created_at:'2026-10-22T01:04:00Z',workflow_run:{id:90,head_sha:'e'.repeat(40)}}]};
 mutate(routes);return async p=>structuredClone(routes[p]);
}
const bridgeOptions={repoRoot:bridgeRoot,base:RECOVERY_BRIDGE.baseline,head:bridgeHead};
const bridgeContext={eventName:'workflow_dispatch',ref:'refs/heads/main',runId:'100',event:{inputs:{source_baseline_recovery:true,source_reviewed_head:bridgeHead}}};
const missingGap={status:'unknown',stage:'snapshot_download',code:'IMPLEMENTATION_CI_BASE_ARTIFACT_MISSING',base_revision:RECOVERY_BRIDGE.directBase,head_revision:'e'.repeat(40)};
const verifyBridge=(extra={})=>verifyRecoveryAuthority(bridgeOptions,{github:bridgeApi(),readArtifact:async()=>structuredClone(missingGap),context:bridgeContext,...extra});
test('真实单桥仅把missing706记录为缺基线，f63与direct706保持分离',async()=>{
 const p=await verifyBridge();assert.equal(p.baseline_revision,RECOVERY_BRIDGE.baseline);assert.equal(p.direct_base_revision,RECOVERY_BRIDGE.directBase);assert.equal(p.bridge.pr_number,6591);assert.equal(p.bridge.impact_status,'success');assert.equal(p.impact_status,'missing_direct_base');assert.equal(p.gap.code,'IMPLEMENTATION_CI_BASE_ARTIFACT_MISSING');
});
for(const [name,change]of [
 ['错误gap父SHA',g=>g.base_revision=RECOVERY_BRIDGE.baseline],['其它失败',g=>g.code='IMPLEMENTATION_CI_ARTIFACT_DOWNLOAD_FAILED'],['错误PRhead',g=>g.head_revision='f'.repeat(40)],['已执行回归',g=>g.stage='scoped_pr'],
])test(`单桥${name}拒绝`,async()=>{const gap=structuredClone(missingGap);change(gap);await assert.rejects(verifyBridge({readArtifact:async()=>gap}),/SOURCE_RECOVERY_GAP_NOT_BASE_MISSING/);});
for(const [name,mutate]of [
 ['旧attempt artifact',r=>r[`repos/${repo}/actions/runs/90/artifacts?per_page=100`].artifacts[0].created_at='2026-10-21T01:04:00Z'],
 ['伪造job',r=>r[`repos/${repo}/actions/jobs/91`].run_id=92],
 ['未结束required',r=>r[`repos/${repo}/commits/${'e'.repeat(40)}/check-runs?per_page=100`].check_runs[0].status='in_progress'],
 ['桥Impact失败',r=>r[`repos/${repo}/commits/${RECOVERY_BRIDGE.prHead}/check-runs?per_page=100`].check_runs[4].conclusion='failure'],
 ['别的步骤失败',r=>r[`repos/${repo}/actions/jobs/91`].steps[0].name='scratch正式迁移'],
 ['artifact别的run',r=>r[`repos/${repo}/actions/runs/90/artifacts?per_page=100`].artifacts[0].workflow_run.id=89],
])test(`单桥${name}拒绝`,async()=>assert.rejects(verifyBridge({github:bridgeApi({mutate})})));
test('单桥独审SHA必须与最终main一致',async()=>assert.rejects(verifyBridge({context:{...bridgeContext,event:{inputs:{source_baseline_recovery:true,source_reviewed_head:RECOVERY_BRIDGE.directBase}}}}),/SOURCE_RECOVERY_REVIEW_HEAD_MISMATCH/));
test('单桥缺source-only标记不能编译',async()=>{
 delete manifest.cecelia_source_only;writeFileSync(join(bridgeRoot,'packages/brain/package.json'),JSON.stringify(manifest,null,2)+'\n');bg('commit','--amend','-qam','missing marker');const badHead=bg('rev-parse','HEAD');
 await assert.rejects(verifyRecoveryAuthority({...bridgeOptions,head:badHead},{github:bridgeApi({head:badHead}),readArtifact:async()=>missingGap,context:{...bridgeContext,event:{inputs:{source_baseline_recovery:true,source_reviewed_head:badHead}}}}),/SOURCE_RECOVERY_DEPLOY_GUARD_MISSING/);
});
