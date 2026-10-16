import {it,expect} from 'vitest';
import {definitionDigest} from './contracts.js';
import {validateRevalidationRequest} from './revalidation.js';
it('复验只能由同owner/input的实际修复序号与issue关联产生，拒浏览器自报或换tenant',()=>{
 const owner={authoring_task_id:'a'},state={request:{validation_input:{text:'abc'}},outputs:{compose:{definition_sha256:'d'}}};
 const issue={key:'issue-one',repaired_at:100,target_version:'candidate:d',definition_sha256:'d'};
 const identity={protocol:'workflow-authoring-revalidation-v1',tenant_id:'alpha',authoring_task_id:'a',definition_sha256:'d',input_sha256:definitionDigest({text:'abc'}),candidate_owner:owner,gap_id:definitionDigest(['issue-one'])};
 const repair_id=definitionDigest({protocol:'workflow-assembly-repair-v1',tenant_id:'alpha',authoring_task_id:'a',definition_sha256:'d',input_sha256:identity.input_sha256,candidate_owner:owner,gap_id:identity.gap_id,sequence:1});
 const request={...identity,repair_id,requested_at:new Date(100).toISOString()};request.attempt_id=definitionDigest({...identity,repair_id});
 const row={id:'a',payload:{tenant_id:'alpha'},result:{workflow_authoring:state,workflow_assembly_reconcile:{protocol:'workflow-assembly-reconcile-v1',repair_sequence:1,issues:{'issue-one':issue},revalidation_request:request}}};
 expect(validateRevalidationRequest(row,owner,'alpha').attempt_id).toBe(request.attempt_id);
 expect(()=>validateRevalidationRequest(row,owner,'other')).toThrow();
 delete row.result.workflow_assembly_reconcile.issues['issue-one'].repaired_at;
 expect(()=>validateRevalidationRequest(row,owner,'alpha')).toThrow();
});
