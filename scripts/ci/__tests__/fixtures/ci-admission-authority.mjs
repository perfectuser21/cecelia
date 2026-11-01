import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {verifyCiAdmissionAuthority} from '../../ci-admission-authority.mjs';
const repo='perfectuser21/cecelia',prefix=`repos/${repo}`;
export function authorityFixture(t,{controlFiles={},sourceCiRecipe="name: CI\non: {push: {branches: [main]}}\njobs: {basic: {name: 源码保底通过, runs-on: ubuntu-latest, steps: [{run: true}]}}\n",sourceCiProvider='源码保底通过'}={}){
 const root=mkdtempSync(join(tmpdir(),'ci-admission-authority-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd:root,encoding:'utf8'}).trim();
 git('init','-q','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('remote','add','origin',`https://github.com/${repo}.git`);
 const commit=text=>{writeFileSync(join(root,'source'),text);git('add','source');git('commit','-qm',text);return git('rev-parse','HEAD');};
 mkdirSync(join(root,'.github/workflows'),{recursive:true});writeFileSync(join(root,'.github/workflows/ci.yml'),sourceCiRecipe);git('add','.github/workflows/ci.yml');
 const source=commit('tested source');
 for(const [path,bytes] of Object.entries(controlFiles)){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),bytes);git('add','--',path);}
 const control=commit('later protected control');
 const repository={id:99,full_name:repo},sourceRun={id:11,run_attempt:1,workflow_id:100,path:'.github/workflows/ci.yml',head_sha:source,head_branch:'main',event:'push',status:'completed',conclusion:'success',repository,head_repository:repository,check_suite_id:900};
 const publisher={...sourceRun,id:22,workflow_id:200,path:'.github/workflows/ci-admission-baseline.yml',head_sha:control,event:'workflow_run',check_suite_id:901};
 const job=(run,id,name,check)=>({id,name,run_id:run.id,run_attempt:1,head_sha:run.head_sha,status:'completed',conclusion:'success',check_run_url:`https://api.github.com/${prefix}/check-runs/${check}`,started_at:'2026-11-01T00:01:00Z',completed_at:'2026-11-01T00:03:00Z'});
 const check=(run,id,name,jobId)=>({id,name,head_sha:run.head_sha,status:'completed',conclusion:'success',app:{id:15368,slug:'github-actions'},check_suite:{id:run.check_suite_id},url:`https://api.github.com/${prefix}/check-runs/${id}`,details_url:`https://github.com/${repo}/actions/runs/${run.id}/job/${jobId}`});
 const data=new Map([
  [prefix,repository],
  [`${prefix}/branches/main`,{protected:true,commit:{sha:control}}],
  [`${prefix}/actions/runs/11`,sourceRun],[`${prefix}/actions/runs/22`,publisher],
  [`${prefix}/actions/workflows/100`,{id:100,path:sourceRun.path,state:'active'}],[`${prefix}/actions/workflows/200`,{id:200,path:publisher.path,state:'active'}],
  [`${prefix}/actions/runs/11/attempts/1/jobs?per_page=100`,{total_count:1,jobs:[job(sourceRun,33,sourceCiProvider,34)]}],
  [`${prefix}/actions/runs/22/attempts/1/jobs?per_page=100`,{total_count:1,jobs:[job(publisher,43,'ci-admission-baseline',44)]}],
  [`${prefix}/check-runs/34`,check(sourceRun,34,sourceCiProvider,33)],[`${prefix}/check-runs/44`,check(publisher,44,'ci-admission-baseline',43)],
 ]);
 const options={repoRoot:root,sourceRevision:source,controlRevision:control,sourceRunId:11,publisher:{runId:22,attempt:1,artifactCreatedAt:'2026-11-01T00:02:00Z'}};
 const api=async path=>{assert.ok(data.has(path),path);return structuredClone(data.get(path));};
 return {root,source,control,git,data,options,api,run:()=>verifyCiAdmissionAuthority(options,{api})};
}
