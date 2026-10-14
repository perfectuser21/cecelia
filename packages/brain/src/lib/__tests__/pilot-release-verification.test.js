import {afterEach,expect,it,vi} from 'vitest';
import {existsSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import yaml from 'js-yaml';
import {pilotPlanHash} from '../pilot-release-verification.js';
const roots=[];afterEach(()=>{vi.unstubAllEnvs();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});});
async function module(){const url=new URL('../../../../../scripts/ci/pilot-release-verification.mjs',import.meta.url);expect(existsSync(url),'必须有实际发布回归入口').toBe(true);return import(url.href);}
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'pilot-release-git-'));roots.push(root);const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
 git('init','-q','-b','pilot-fixture');git('config','user.email','fixture@example.invalid');git('config','user.name','fixture');git('remote','add','origin','https://github.com/perfectuser21/zenithjoy-workspace.git');
 mkdirSync(join(root,'scripts/smoke'),{recursive:true});writeFileSync(join(root,'scripts/smoke/pilot.sh'),'#!/bin/bash\nset -e\ntest -z "${CECELIA_INTERNAL_TOKEN:-}"\ntest -z "${GITHUB_TOKEN:-}"\nprintf tested > actual-output\n');writeFileSync(join(root,'entry.js'),'export const fixed = true;\n');git('add','.');git('commit','-qm','fixture');const revision=git('rev-parse','HEAD');git('update-ref','refs/remotes/origin/main',revision);
 const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,repo='perfectuser21/zenithjoy-workspace';
 const row=(n,payload,identity)=>{const source={repo,path:'contracts/pilot.json',commit:revision};return {id:id(n),...identity,source_repo:repo,source_path:source.path,source_commit:revision,payload,payload_sha256:pilotPlanHash({source,payload})};};
 const activity=row(2,{activity_id:id(3),steps:[{step_id:id(4),locator:{activity_id:id(3),step_key:'verify'}}],implementation_bindings:[{kind:'code',scope:'activity',status:'verified',repo,path:'entry.js',revision,digest:'sha256:'+createHash('sha256').update(readFileSync(join(root,'entry.js'))).digest('hex')}]},{activity_id:id(3)});
 const workflow=row(1,{workflow_id:id(5),capability_id:id(6),activities:[{reference_id:id(7),activity_id:id(3),activity_version_id:id(2)}]},{workflow_id:id(5)});
 const snapshot={schema_version:1,scope:'zenithjoy',repo,revision,status:'verified',gaps:[],definitions:{workflows:[workflow],activities:[activity]},assertions:[null,id(4)].map((step,i)=>({id:id(10+i),journey_id:id(6),step_id:id(3),step_id_ref:step,cell_kind:'scenario',cell_key:`regression:${id(6)}:${step||'activity'}`,assertion_ref:'scripts/smoke/pilot.sh',assertion_revision:1}))};
 snapshot.snapshot_sha256=pilotPlanHash(snapshot);return {root,snapshot,git,outputDir:join(root,'evidence'),event:'push',ref:'refs/heads/main'};
}
it('真实固定Git测试进程使用白名单环境，发布证明不要求改写unknown影响报告',async()=>{
 const {runPilotReleaseVerification}=await module(),f=fixture();vi.stubEnv('CECELIA_INTERNAL_TOKEN','must-not-reach-test');
 const result=await runPilotReleaseVerification({...f,repoRoot:f.root});expect(result.receipt.verdict).toBe('PASS');expect(result.receipt).toMatchObject({purpose:'release_verification',actor:'pilot_release_verification',scope:'declared_pilot_regressions',business_runtime_status:'not_evaluated'});
 expect(result.report.source).not.toHaveProperty('base_revision');expect(result.report).not.toHaveProperty('mapping_status');expect(readFileSync(join(f.root,'actual-output'),'utf8')).toBe('tested');
});
const descriptions=[
 {kind:'raw',scope:'activity',field:'runtime',status:'unresolved',raw:{entry:'discover-keyword.sh',phase:'source'}},
 {kind:'raw',scope:'activity',field:'execution.via',status:'unresolved',raw:'xian-m4 batch2.sh:78 → harvest-keyword.sh:35-43 → douyin-phone-adb'},
 {kind:'raw',scope:'step',field:'implementation',step_key:'open_search',status:'unresolved',raw:{ref:'harvest-keyword.sh:35 open-search',status:'implemented'}},
];
function reseal(f){
 for(const w of f.snapshot.definitions.workflows)w.payload_sha256=pilotPlanHash({source:{repo:w.source_repo,path:w.source_path,commit:w.source_commit},payload:w.payload});
 for(const a of f.snapshot.definitions.activities)a.payload_sha256=pilotPlanHash({source:{repo:a.source_repo,path:a.source_path,commit:a.source_commit},payload:a.payload});
 delete f.snapshot.snapshot_sha256;f.snapshot.snapshot_sha256=pilotPlanHash(f.snapshot);
}
async function crossRevisionAuthoring(){
 const f=fixture(),s=f.snapshot,[w]=s.definitions.workflows,[a]=s.definitions.activities;
 const old=s.revision,repo=s.repo;
 const definition={key:'patrol.internal',name:'固定版本巡查',capability_id:w.payload.capability_id,channel:'internal',form:'code',version:'1.0.1',
  runtime:{skill_id:w.workflow_id,entrypoint:'fixed-runtime'},
  activities:[{key:'read',name:'读取',executor_kind:'code',acceptance:['固定实现可读'],
   implementation:{kind:'code',ref:'entry.js',version:old,repo,path:'entry.js',revision:old}}]};
 mkdirSync(join(f.root,'contracts'));writeFileSync(join(f.root,'contracts/pilot.json'),JSON.stringify(definition));
 writeFileSync(join(f.root,'entry.js'),'export const fixed = "new bytes must not replace old implementation";\n');
 f.git('add','.');f.git('commit','-qm','definition with newer implementation bytes');s.revision=f.git('rev-parse','HEAD');f.git('update-ref','refs/remotes/origin/main',s.revision);
 definition.source={repo,ref:'contracts/pilot.json',revision:s.revision};
 const readFile=async q=>{if(q.repo!==repo)throw Error('wrong repo');return execFileSync('git',['show',`${q.revision}:${q.path}`],{cwd:f.root,encoding:'utf8'});};
 const {prepareDefinitionFreeze}=await import('../../workflow-authoring/freeze.js');
 const proof=await prepareDefinitionFreeze(definition,{readFile});
 for(const r of [w,a]){r.source_commit=s.revision;r.payload.registration_protocol='definition-freeze-v1';}
 w.payload.key=definition.key;w.payload.contract=definition;a.payload.implementation_bindings=proof.bindings.get('read');
 w.payload.activities[0].slot_key='read';
 s.scope='patrol-definitions';s.map={repositories:[{scope_key:s.scope,adapter_config:{source_repo:repo,definition_protocol:'definition-freeze-v1',workflow_keys:[definition.key]}}]};
 s.canonical={workflows:[{id:w.workflow_id,key:definition.key,status:'active',capability_id:definition.capability_id,source_repo:repo,source_path:definition.source.ref}]};reseal(f);
 expect(readFileSync(join(f.root,'entry.js'),'utf8')).not.toBe(await readFile({repo,path:'entry.js',revision:old}));
 return {...f,old,authoringSourceOptions:{readFile}};
}
it('真实旧commit与HEAD字节不同，正式authoring冻结引用仍可发布源码证明，不能用HEAD替换',async()=>{
 const f=await crossRevisionAuthoring(),{runPilotReleaseVerification}=await module();
 const result=await runPilotReleaseVerification({...f,repoRoot:f.root});
 expect(result.receipt.verdict).toBe('PASS');
 expect(result.report.implementation_source_set).toContainEqual(expect.objectContaining({revision:f.old,path:'entry.js',digest:f.snapshot.definitions.activities[0].payload.implementation_bindings[0].digest}));
 expect(result.report.implementation_source_set.some(b=>b.revision===f.snapshot.revision&&b.path==='entry.js')).toBe(false);
});
it.each(['digest','revision','repo','path','protocol','owner','step-only','extra-step'])('authoring跨版本不可用伪造或不完整来源放行 %s',async reason=>{
 const f=await crossRevisionAuthoring(),{runPilotReleaseVerification}=await module();
 const binding=f.snapshot.definitions.activities[0].payload.implementation_bindings[0];
 if(reason==='digest')binding.digest='sha256:'+'0'.repeat(64);
 if(reason==='revision')binding.revision='0'.repeat(40);
 if(reason==='repo')binding.repo='perfectuser21/cecelia';
 if(reason==='path')binding.path='missing.js';
 if(reason==='protocol')delete f.snapshot.definitions.workflows[0].payload.registration_protocol;
 if(reason==='owner')f.snapshot.canonical.workflows[0].source_path='other.json';
 if(reason==='step-only')binding.scope='step';
 if(reason==='extra-step')f.snapshot.definitions.activities[0].payload.implementation_bindings.push({...binding,scope:'step',step_key:'unverified'});
 reseal(f);await expect(runPilotReleaseVerification({...f,repoRoot:f.root})).rejects.toThrow();
 expect(existsSync(join(f.outputDir,'receipt.json'))).toBe(false);
});
it('authoring证明不可伪造、克隆、跨snapshot重用，取源期间变更同样拒绝',async()=>{
 const f=await crossRevisionAuthoring();
 const {prepareAuthoringReleaseProof,assertAuthoringReleaseProof}=await import('../../workflow-authoring/release-proof.js');
 for(const proof of [true,{}, {snapshot_sha256:f.snapshot.snapshot_sha256}])expect(()=>assertAuthoringReleaseProof(f.snapshot,proof)).toThrow();
 const proof=await prepareAuthoringReleaseProof(f.snapshot,f.authoringSourceOptions);
 expect(()=>assertAuthoringReleaseProof(f.snapshot,proof)).not.toThrow();
 expect(()=>assertAuthoringReleaseProof(f.snapshot,structuredClone(proof))).toThrow();
 const changed=structuredClone(f.snapshot);changed.scope='another-scope';expect(()=>assertAuthoringReleaseProof(changed,proof)).toThrow();
 proof.implementation_source_set[0].revision=f.snapshot.revision;expect(()=>assertAuthoringReleaseProof(f.snapshot,proof)).toThrow();
 await expect(prepareAuthoringReleaseProof(f.snapshot,{readFile:async s=>{const bytes=await f.authoringSourceOptions.readFile(s);f.snapshot.untrusted_change=true;return bytes;}})).rejects.toThrow();
});
it('真实规范raw描述保留unresolved；固定Code与真实回归仍被核验',async()=>{
 const {runPilotReleaseVerification}=await module(),f=fixture();
 f.snapshot.definitions.activities[0].payload.implementation_bindings.push(...structuredClone(descriptions));reseal(f);
 const result=await runPilotReleaseVerification({...f,repoRoot:f.root});expect(result.receipt.verdict).toBe('PASS');
 expect(JSON.parse(readFileSync(join(f.outputDir,'head.json'),'utf8')).snapshot.definitions.activities[0].payload.implementation_bindings.slice(1)).toEqual(descriptions);
 expect(readFileSync(join(f.root,'actual-output'),'utf8')).toBe('tested');
});
it('raw不能隐藏无固定实现、未知kind、未核验Code/Skill及repo/SHA/path/digest漂移',async()=>{
 const {runPilotReleaseVerification}=await module();
 const cases=[['all-raw',null],['unknown-kind',{kind:'future_component'}],['false-raw',{kind:'raw',status:'verified'}],['code-unresolved',{status:'unresolved'}],['skill-unresolved',{kind:'skill',status:'unresolved'}],['repo',{repo:'other/repo'}],['revision',{revision:'0'.repeat(40)}],['path',{path:'../entry.js'}],['digest',{digest:'sha256:'+'0'.repeat(64)}]];
 for(const [reason,patch] of cases){const f=fixture(),a=f.snapshot.definitions.activities[0],valid=a.payload.implementation_bindings[0];
  a.payload.implementation_bindings=patch?[valid,{...valid,...patch}]:structuredClone(descriptions);reseal(f);
  await expect(runPilotReleaseVerification({...f,repoRoot:f.root}),reason).rejects.toThrow();
  expect(existsSync(join(f.outputDir,'receipt.json')),reason).toBe(false);expect(existsSync(join(f.root,'actual-output')),reason).toBe(false);
 }
});
it('PR、漏Step与本机测试脏字节拒绝且无PASS收据',async()=>{
 const {runPilotReleaseVerification}=await module();
 for(const reason of ['pr','missing-step','dirty']){const f=fixture();if(reason==='pr')f.event='pull_request';if(reason==='missing-step'){f.snapshot.assertions.pop();delete f.snapshot.snapshot_sha256;f.snapshot.snapshot_sha256=pilotPlanHash(f.snapshot);}if(reason==='dirty')writeFileSync(join(f.root,'scripts/smoke/pilot.sh'),'exit 0');
  await expect(runPilotReleaseVerification({...f,repoRoot:f.root})).rejects.toThrow();expect(existsSync(join(f.outputDir,'receipt.json'))).toBe(false);expect(existsSync(join(f.outputDir,'gap.json'))).toBe(true);expect(existsSync(join(f.root,'actual-output'))).toBe(false);
 }
});
it('实际主线工作流与凭据隔离存在，不依赖影响workflow整体成功',()=>{
 const url=new URL('../../../../../.github/workflows/pilot-release-verification.yml',import.meta.url);expect(existsSync(url)).toBe(true);const w=yaml.load(readFileSync(url,'utf8'));
 expect(w.name).toBe('Pilot release verification');expect(w.on.pull_request).toBeUndefined();expect(w.on.push.branches).toEqual(['main']);
 expect(w.jobs.snapshot.steps[0].run).toContain('perfectuser21/zenithjoy-workspace:commander-generic');
 expect(JSON.stringify(w.jobs.verify)).not.toContain('CECELIA_INTERNAL_TOKEN');expect(JSON.stringify(w.jobs.verify)).toContain('pilot-release-verification.mjs');
 for(const job of Object.values(w.jobs))for(const s of job.steps||[])if(s.uses?.startsWith('actions/setup-node'))expect(s.with?.cache).toBeUndefined();
});

it('同main的多个scope上传和下载使用各自artifact，证据不得碰撞',()=>{
 const w=yaml.load(readFileSync(new URL('../../../../../.github/workflows/pilot-release-verification.yml',import.meta.url),'utf8'));
 const upload=w.jobs.snapshot.steps.find(s=>s.uses?.startsWith('actions/upload-artifact'));
 const download=w.jobs.verify.steps.find(s=>s.uses?.startsWith('actions/download-artifact'));
 const result=w.jobs.verify.steps.find(s=>s.uses?.startsWith('actions/upload-artifact'));
 expect(download.with.name).toBe(upload.with.name);
 for(const step of [upload,download,result])expect(step.with.name).toContain("${{ inputs.scope || 'cecelia-kr' }}");
 expect(upload.with.name).not.toBe(result.with.name);
});

it('并发main同步同SHA时仅409回读固定快照，unknown不得变PASS',()=>{
 const w=yaml.load(readFileSync(new URL('../../../../../.github/workflows/pilot-release-verification.yml',import.meta.url),'utf8'));
 const step=w.jobs.snapshot.steps.find(s=>s.name?.includes('刷新并导出'));
 for(const status of ['verified','unknown']){const root=mkdtempSync(join(tmpdir(),'pilot-refresh-race-'));roots.push(root);mkdirSync(join(root,'bin'));writeFileSync(join(root,'bin/curl'),`#!/bin/bash\nif [[ " $* " == *" --get "* ]]; then printf '{"snapshot":{"status":"%s","gaps":[]}}\\n' "$FIXTURE_STATUS"; else printf 409; fi\n`,{mode:0o755});
  const r=spawnSync('/bin/bash',['-c',step.run],{cwd:root,encoding:'utf8',env:{PATH:`${root}/bin:${process.env.PATH}`,FIXTURE_STATUS:status,BRAIN_URL:'http://fixture.invalid',CECELIA_INTERNAL_TOKEN:'fixture',SOURCE_REPO:'perfectuser21/zenithjoy-workspace',MAP_SCOPE:'zenithjoy',HEAD:'a'.repeat(40)}});
  if(status==='verified')expect(r.status,r.stderr).toBe(0);else{expect(r.status).not.toBe(0);expect(existsSync(join(root,'evidence/gap.json'))).toBe(true);}
 }
});

it('正式caller仅接纳固定repo的新设备巡检scope并拒绝其它身份漂移',()=>{
 const w=yaml.load(readFileSync(new URL('../../../../../.github/workflows/pilot-release-verification.yml',import.meta.url),'utf8'));
 const root=mkdtempSync(join(tmpdir(),'pilot-caller-scope-'));roots.push(root);mkdirSync(join(root,'bin'));
 writeFileSync(join(root,'bin/gh'),'#!/bin/bash\nprintf "%s\\n" "$FIXTURE_REMOTE_HEAD"\n',{mode:0o755});
 const head='a'.repeat(40),repo='perfectuser21/zenithjoy-workspace';
 const base={PATH:`${root}/bin:${process.env.PATH}`,SOURCE_REPO:repo,CALLER_REPO:repo,HEAD:head,CALLER_SHA:head,FIXTURE_REMOTE_HEAD:head,MAP_SCOPE:'cecelia-device-patrol-definitions'};
 const run=patch=>spawnSync('/bin/bash',['-c',w.jobs.snapshot.steps[0].run],{cwd:root,encoding:'utf8',env:{...base,...patch}});
 expect(run({}).status).toBe(0);
 for(const patch of [{MAP_SCOPE:'cecelia-device-patrol-definitions-extra'},{SOURCE_REPO:'other/repo'},{CALLER_REPO:'other/repo'},{HEAD:'b'.repeat(40)},{FIXTURE_REMOTE_HEAD:'b'.repeat(40)},{SOURCE_REPO:'perfectuser21/cecelia',CALLER_REPO:'perfectuser21/cecelia'}])expect(run(patch).status).not.toBe(0);
});

it('正式Git对象校源token仅接入CLI，登记回归子进程不可继承',async()=>{
 const w=yaml.load(readFileSync(new URL('../../../../../.github/workflows/pilot-release-verification.yml',import.meta.url),'utf8'));
 const step=w.jobs.verify.steps.find(s=>s.run?.includes('pilot-release-verification.mjs'));
 expect(step.env.GITHUB_TOKEN).toBe('${{ github.token }}');
 expect(w.permissions.contents).toBe('read');
 expect(Object.values(w.permissions)).not.toContain('write');
 expect(step.env).not.toHaveProperty('CECELIA_INTERNAL_TOKEN');
 vi.stubEnv('GITHUB_TOKEN','fixture-source-only-token');
 const f=fixture(),{runPilotReleaseVerification}=await module();
 expect((await runPilotReleaseVerification({...f,repoRoot:f.root})).receipt.verdict).toBe('PASS');
});
