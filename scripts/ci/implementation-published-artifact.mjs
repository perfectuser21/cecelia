/** 固定官方产物的读取与校验；不加载退休工厂collector或恢复器。 */
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {validateImplementationSnapshot,extractImplementationAdmissionSnapshots} from '../../packages/brain/src/lib/implementation-ci-snapshot.js';
const fail=(code,details={})=>Object.assign(Error(code),{code,...details});
export function validatePublishedSnapshot(body,{scope,repo,revision,complete=false}){
 if(body?.error)throw fail('IMPLEMENTATION_CI_SNAPSHOT_PROVIDER_FAILED',{provider_code:body.error.code??null});
 const s=validateImplementationSnapshot(body?.snapshot);
 if(s.scope!==scope||s.repo!==repo||s.revision!==revision)throw fail('IMPLEMENTATION_CI_SNAPSHOT_IDENTITY_MISMATCH');
 if(!['verified','unknown'].includes(s.status)||!Array.isArray(s.gaps)||(s.status==='verified')!==(s.gaps.length===0))throw fail('IMPLEMENTATION_CI_SNAPSHOT_STATUS_INVALID');
 if(complete){
  if(s.status!=='verified')throw fail('IMPLEMENTATION_CI_SNAPSHOT_UNKNOWN');
  if(scope==='cecelia-kr'&&repo==='perfectuser21/cecelia')extractImplementationAdmissionSnapshots(s,['cecelia-kr','cecelia-factory']);
 }
 return s;
}
/** 中央只保留当前 active manifest；旧 SHA 只能回退到同 SHA 的正式 provider 产物。 */
export function readPublishedArtifact({repo,revision,diagnostics,scope}){
 const gh=(endpoint,binary=false)=>execFileSync('gh',['api',endpoint],{encoding:binary?undefined:'utf8',timeout:60000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
 const json=endpoint=>JSON.parse(gh(endpoint));
 const infra=scope==='cecelia-infra',job=infra?'snapshot-infra':'snapshot-main';
 const name=`implementation-${infra?'infra-':''}snapshot-${revision}`,prefix=`repos/${repo}/actions`;
 const collection=json(`${prefix}/artifacts?name=${name}&per_page=100`);
 if(!Array.isArray(collection.artifacts)||!Number.isInteger(collection.total_count)||collection.total_count<0||collection.total_count>100||collection.total_count!==collection.artifacts.length)throw fail('IMPLEMENTATION_CI_BASE_ARTIFACT_MISSING');
 const valid=item=>Number.isSafeInteger(item?.id)&&item.id>0&&item.name===name&&item.expired===false
  &&typeof item.created_at==='string'&&item.created_at.trim()!==''&&Number.isFinite(Date.parse(item.created_at))
  &&item.workflow_run?.head_sha===revision&&item.workflow_run.head_branch==='main'
  &&Number.isSafeInteger(item.workflow_run.id)&&item.workflow_run.id>0
  &&Number.isSafeInteger(item.workflow_run.repository_id)&&item.workflow_run.repository_id===item.workflow_run.head_repository_id;
 const candidate=collection.artifacts.filter(valid).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||b.id-a.id)[0];
 if(!candidate)throw fail('IMPLEMENTATION_CI_BASE_ARTIFACT_MISSING');
 const artifact=json(`${prefix}/artifacts/${candidate.id}`);
 if(!valid(artifact)||artifact.id!==candidate.id||artifact.workflow_run.id!==candidate.workflow_run.id)throw fail('IMPLEMENTATION_CI_ARTIFACT_ORIGIN_INVALID');
 const runId=artifact.workflow_run.id,run=json(`${prefix}/runs/${runId}`);
 if(run.id!==runId||run.head_sha!==revision||run.head_branch!=='main'||!['push','workflow_dispatch'].includes(run.event)
  ||run.path!=='.github/workflows/implementation-impact.yml'||run.repository?.full_name!==repo||run.head_repository?.full_name!==repo)throw fail('IMPLEMENTATION_CI_ARTIFACT_ORIGIN_INVALID');
 const jobs=json(`${prefix}/runs/${runId}/jobs?per_page=100`);
 if(!Number.isInteger(jobs.total_count)||jobs.total_count<0||jobs.total_count>100||!Array.isArray(jobs.jobs)||jobs.total_count!==jobs.jobs.length
  ||!jobs.jobs.some(j=>j.name===job&&j.status==='completed'&&j.conclusion==='success'))throw fail('IMPLEMENTATION_CI_SNAPSHOT_PROVIDER_FAILED');
 const temporary=mkdtempSync(join(diagnostics,'historical-artifact-'));
 try{
  const archive=join(temporary,'snapshot.zip');writeFileSync(archive,gh(`${prefix}/artifacts/${artifact.id}/zip`,true));
  const body=JSON.parse(execFileSync('unzip',['-p',archive,'head.json'],{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']}));
  writeFileSync(join(diagnostics,infra?`historical-infra-${revision}-source.json`:'historical-base-source.json'),JSON.stringify({repo,revision,artifact_id:artifact.id,run_id:runId,provider_job:job,provider_status:'success'})+'\n');
  return body;
 }finally{rmSync(temporary,{recursive:true,force:true});}
}
