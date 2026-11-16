import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {identity,directory,read,bytes,hash,owner,ownedResources,fail,cli} from './shared.mjs';
const expectedChecks=(activity,phase)=>phase==='start'?['input_identity','resource_owned']:activity==='report'?['report_content','single_effect']:['resource_released','evidence_preserved'];
function verifyReport(dir,who){
 owner(read(dir,'reservation.json'),who);
 const reportBytes=bytes(dir,'report.json'),snapshotBytes=bytes(dir,'snapshot.json');
 if(!reportBytes||!snapshotBytes)fail('readiness_evidence_missing');
 const report=read(dir,'report.json'),snapshot=read(dir,'snapshot.json'),effect=read(dir,'effect.json');
 for(const item of [report,snapshot,effect])owner(item.owner,who);
 if(report.brain_sha!==who.expected_brain_sha||report.brain_version!==who.expected_brain_version||report.task_id!==who.task_id||report.run_id!==who.run_id
  ||snapshot.health?.status!=='healthy'||snapshot.health.git_sha!==who.expected_brain_sha||snapshot.health.version!==who.expected_brain_version||snapshot.version?.version!==who.expected_brain_version)fail('readiness_brain_mismatch');
 const task=snapshot.task;
 if(task?.id!==who.task_id||task.status!=='in_progress'||(task.runner&&(task.runner.task_id!==who.task_id||task.runner.run_id!==who.run_id)))fail('readiness_task_mismatch');
 const reportHash=hash(reportBytes),snapshotHash=hash(snapshotBytes);
 if(effect.count!==1||effect.report_sha256!==reportHash||effect.snapshot_sha256!==snapshotHash||report.snapshot_sha256!==snapshotHash)fail('readiness_evidence_invalid');
 const outputs={report_sha256:reportHash,snapshot_sha256:snapshotHash,brain_sha:who.expected_brain_sha,brain_version:who.expected_brain_version};
 const recorded=read(dir,'report-result.json');if(recorded.run_tag!==who.run_id||recorded.status!=='completed'||!isDeepStrictEqual(recorded.outputs,outputs))fail('readiness_result_mismatch');
 return outputs;
}
export function checkRequest(request){
 const input=request.context,who=identity(input),dir=directory(input);
 if(request.task_id!==who.task_id||request.run_id!==who.run_id||request.run_tag!==who.run_tag||request.workflow!=='foundation_release_readiness'
  ||!['report','cleanup'].includes(request.activity)||!['start','end'].includes(request.phase)||request.attempt!==1||typeof request.nonce!=='string'||!request.nonce
  ||!isDeepStrictEqual(request.checks,expectedChecks(request.activity,request.phase)))fail('readiness_identity_invalid');
 ownedResources(dir,who,request.activity==='report');
 let output={},sources=['reservation.json','lease.json'];
 if(request.phase==='end'){
  if(request.activity==='report'){output=verifyReport(dir,who);sources=['snapshot.json','report.json','effect.json'];}
  else{
   const cleanup=read(dir,'cleanup.json');owner(cleanup.owner,who);
   if(cleanup.count!==1||read(dir,'lease.json',false))fail('readiness_resource_not_released');
   const reportBytes=bytes(dir,'report.json');
   if(reportBytes){const report=read(dir,'report.json');owner(report.owner,who,false);verifyReport(dir,{...who,action_id:report.owner.action_id});}
   output={released:true,report_present:reportBytes!==null,report_sha256:reportBytes?hash(reportBytes):null};
   if(!isDeepStrictEqual(cleanup.result.outputs,output))fail('readiness_evidence_invalid');sources=['cleanup.json',...(reportBytes?['report.json']:[])];
  }
  if(request.proposal?.status!=='completed'||request.proposal.run_tag!==who.run_tag||!isDeepStrictEqual(request.proposal.outputs,output))fail('readiness_result_mismatch');
 }
 const observed=sources.map(name=>({source:path.join(dir,name),observation:{exists:bytes(dir,name)!==null,sha256:bytes(dir,name)?hash(bytes(dir,name)):null,task_id:who.task_id,run_id:who.run_id}}));
 return {identity:{task_id:who.task_id,run_id:who.run_id,run_tag:who.run_tag,workflow:request.workflow,activity:request.activity,attempt:request.attempt},nonce:request.nonce,outcome:'passed',output,checks:request.checks.map(id=>({id,status:'passed',evidence:observed}))};
}
cli(import.meta.url,checkRequest);
