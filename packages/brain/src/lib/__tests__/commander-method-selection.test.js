import { it, expect } from 'vitest';
import { qualifiedMethod } from '../commander-method-selection.js';
const e={task_id:'task',run_id:'run',attempt:1,definition:{release_id:'r',workflow_id:'w',workflow_definition_version_id:'v',snapshot_sha256:'hash',runtime_snapshot_sha256:'runtime'}};
function proof(){
 const v={task_id:'task',run_id:'run',attempt:1,definition_sha256:'hash',verdict:'PASS',assertions:[{name:'cleanup',pass:true},{name:'output',pass:true}],evidence:['independent']};
 return {run:{id:'internal',run_id:'run',task_id:'task',status:'success',ended_at:'2026-10-13T00:00:00Z',context:{commander_envelope:e}},task:{id:'task',status:'completed',result:{workflow_control:{envelope:e,phase:'final',verdict:'PASS',verify_task_id:'verify',delivery:{status:'completed',cleanup:{completed:true,evidence:['free']}}}}},verificationTask:{id:'verify',parent_task_id:'task',task_type:'research',status:'completed',payload:{verification_transport:'openclaw-agent-v1',run_id:'wfv-v'},result:{workflow_verification:v,receipt:{verification_runtime:{provider:'openai',model:'gpt-6.1-sol',logical_run_id:'wfv-v',official_run_id:'official',rerouted:false}}}},frozen:{binding:{run_id:'run',task_run_id:'internal',payload:{runtime_snapshot_sha256:'runtime'},...e.definition},workflow:{id:'v',workflow_id:'w',payload_sha256:'hash'}},evidence:{evidence_status:'verified',business_outcome:'pass',gaps:[]}};
}
it('精确历史业务完成加独立官方PASS可作为候选，仅CI/span/自述/错模型均不够',()=>{
 expect(qualifiedMethod(proof())).toBe(true);
 for(const change of [p=>p.verificationTask=null,p=>p.verificationTask.result.receipt.verification_runtime.model='other',p=>p.verificationTask.result.workflow_verification.run_id='other',p=>p.evidence.business_outcome='skipped',p=>p.evidence.gaps=['missing'],p=>p.task.result.workflow_control.envelope={...e,run_id:'new'},p=>p.run.context.commander_envelope={...e,definition:{...e.definition,snapshot_sha256:'other'}},p=>p.frozen.binding.snapshot_sha256='other',p=>p.verificationTask.parent_task_id='another',p=>p.frozen.binding.task_run_id='other',p=>p.frozen.binding.payload.runtime_snapshot_sha256='different-code']){
  const p=proof();change(p);expect(qualifiedMethod(p)).toBe(false);
 }
});
