import {identity,directory,read,bytes,hash,writeOnce,owner,ownedResources,result,fail,cli} from './shared.mjs';
export async function runReport(input,{fetchFn=fetch}={}){
 const who=identity(input),dir=directory(input,true);ownedResources(dir,who,true);
 const reservation=read(dir,'reservation.json',false);
 if(reservation){
  const saved=read(dir,'report-result.json',false),effect=read(dir,'effect.json',false),report=bytes(dir,'report.json'),snapshot=bytes(dir,'snapshot.json');
  if(!saved||!effect||!report||!snapshot)fail('readiness_report_incomplete');
  owner(effect.owner,who);owner(read(dir,'report.json').owner,who);owner(read(dir,'snapshot.json').owner,who);if(saved.status!=='completed'||saved.run_tag!==who.run_id||effect.count!==1||effect.report_sha256!==hash(report)||effect.snapshot_sha256!==hash(snapshot)||JSON.stringify(saved.outputs)!==JSON.stringify({report_sha256:hash(report),snapshot_sha256:hash(snapshot),brain_sha:who.expected_brain_sha,brain_version:who.expected_brain_version}))fail('readiness_evidence_invalid');
  return saved;
 }
 // The exclusive durable reservation precedes all observations; uncertain work is never reissued.
 writeOnce(dir,'reservation.json',who);writeOnce(dir,'lease.json',who);
 async function get(endpoint){
  const response=await fetchFn('http://127.0.0.1:5221/api/brain/'+endpoint,{redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)fail('readiness_brain_unavailable');
  const data=await response.text();if(data.length>1024*1024)fail('readiness_brain_response_limit');return JSON.parse(data);
 }
 const health=await get('health'),version=await get('version'),task=await get('tasks/'+who.task_id);
 if(health.status!=='healthy'||health.git_sha!==who.expected_brain_sha||health.version!==who.expected_brain_version||version.version!==who.expected_brain_version)fail('readiness_brain_mismatch');
 if(task.id!==who.task_id||task.status!=='in_progress'||(task.result?.foundation_runner&&(task.result.foundation_runner.task_id!==who.task_id||task.result.foundation_runner.run_id!==who.run_id)))fail('readiness_task_mismatch');
 const snapshot={owner:who,observed_at:new Date().toISOString(),health:{status:health.status,git_sha:health.git_sha,version:health.version},version:{version:version.version},task:{id:task.id,status:task.status,task_type:task.task_type,commander_protocol:task.payload?.commander_protocol??null,runner:task.result?.foundation_runner?{task_id:task.result.foundation_runner.task_id,run_id:task.result.foundation_runner.run_id}:null}};
 const snapshotHash=writeOnce(dir,'snapshot.json',snapshot);
 const reportHash=writeOnce(dir,'report.json',{owner:who,brain_sha:health.git_sha,brain_version:health.version,snapshot_sha256:snapshotHash,task_id:task.id,run_id:who.run_id});
 writeOnce(dir,'effect.json',{owner:who,count:1,report_sha256:reportHash,snapshot_sha256:snapshotHash});
 const value=result(input,{report_sha256:reportHash,snapshot_sha256:snapshotHash,brain_sha:health.git_sha,brain_version:health.version},['snapshot.json','report.json','effect.json']);writeOnce(dir,'report-result.json',value);return value;
}
cli(import.meta.url,runReport);
