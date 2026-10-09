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
 mkdirSync(join(root,'scripts/smoke'),{recursive:true});writeFileSync(join(root,'scripts/smoke/pilot.sh'),'#!/bin/bash\nset -e\ntest -z "${CECELIA_INTERNAL_TOKEN:-}"\nprintf tested > actual-output\n');writeFileSync(join(root,'entry.js'),'export const fixed = true;\n');git('add','.');git('commit','-qm','fixture');const revision=git('rev-parse','HEAD');git('update-ref','refs/remotes/origin/main',revision);
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
 for(const a of f.snapshot.definitions.activities)a.payload_sha256=pilotPlanHash({source:{repo:a.source_repo,path:a.source_path,commit:a.source_commit},payload:a.payload});
 delete f.snapshot.snapshot_sha256;f.snapshot.snapshot_sha256=pilotPlanHash(f.snapshot);
}
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
 expect(JSON.stringify(w.jobs.verify)).not.toContain('CECELIA_INTERNAL_TOKEN');expect(JSON.stringify(w.jobs.verify)).toContain('pilot-release-verification.mjs');
 for(const job of Object.values(w.jobs))for(const s of job.steps||[])if(s.uses?.startsWith('actions/setup-node'))expect(s.with?.cache).toBeUndefined();
});

it('并发main同步同SHA时仅409回读固定快照，unknown不得变PASS',()=>{
 const w=yaml.load(readFileSync(new URL('../../../../../.github/workflows/pilot-release-verification.yml',import.meta.url),'utf8'));
 const step=w.jobs.snapshot.steps.find(s=>s.name?.includes('刷新并导出'));
 for(const status of ['verified','unknown']){const root=mkdtempSync(join(tmpdir(),'pilot-refresh-race-'));roots.push(root);mkdirSync(join(root,'bin'));writeFileSync(join(root,'bin/curl'),`#!/bin/bash\nif [[ " $* " == *" --get "* ]]; then printf '{"snapshot":{"status":"%s","gaps":[]}}\\n' "$FIXTURE_STATUS"; else printf 409; fi\n`,{mode:0o755});
  const r=spawnSync('/bin/bash',['-c',step.run],{cwd:root,encoding:'utf8',env:{PATH:`${root}/bin:${process.env.PATH}`,FIXTURE_STATUS:status,BRAIN_URL:'http://fixture.invalid',CECELIA_INTERNAL_TOKEN:'fixture',SOURCE_REPO:'perfectuser21/zenithjoy-workspace',MAP_SCOPE:'zenithjoy',HEAD:'a'.repeat(40)}});
  if(status==='verified')expect(r.status,r.stderr).toBe(0);else{expect(r.status).not.toBe(0);expect(existsSync(join(root,'evidence/gap.json'))).toBe(true);}
 }
});
