import {afterEach,expect,it,vi} from 'vitest';
import {existsSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
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
 const activity=row(2,{activity_id:id(3),steps:[{step_id:id(4),locator:{activity_id:id(3),step_key:'verify'}}],implementation_bindings:[]},{activity_id:id(3)});
 const workflow=row(1,{workflow_id:id(5),capability_id:id(6),activities:[{reference_id:id(7),activity_id:id(3),activity_version_id:id(2)}]},{workflow_id:id(5)});
 const snapshot={schema_version:1,scope:'zenithjoy',repo,revision,status:'verified',gaps:[],definitions:{workflows:[workflow],activities:[activity]},assertions:[null,id(4)].map((step,i)=>({id:id(10+i),journey_id:id(6),step_id:id(3),step_id_ref:step,assertion_ref:'scripts/smoke/pilot.sh',assertion_revision:1}))};
 snapshot.snapshot_sha256=pilotPlanHash(snapshot);return {root,snapshot,git,outputDir:join(root,'evidence'),event:'push',ref:'refs/heads/main'};
}
it('真实固定Git测试进程使用白名单环境，发布证明不要求改写unknown影响报告',async()=>{
 const {runPilotReleaseVerification}=await module(),f=fixture();vi.stubEnv('CECELIA_INTERNAL_TOKEN','must-not-reach-test');
 const result=await runPilotReleaseVerification({...f,repoRoot:f.root});expect(result.receipt.verdict).toBe('PASS');expect(result.receipt).toMatchObject({purpose:'release_verification',actor:'pilot_release_verification',scope:'declared_pilot_regressions',business_runtime_status:'not_evaluated'});
 expect(result.report.source).not.toHaveProperty('base_revision');expect(result.report).not.toHaveProperty('mapping_status');expect(readFileSync(join(f.root,'actual-output'),'utf8')).toBe('tested');
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
