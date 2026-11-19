import {test,expect} from 'vitest';
import {checkerCriteria,contractCriterionValues,verifyCheckerResult} from '../../../scripts/commander-workflow/checker-agent-protocol.mjs';
import {digest} from '../commander-decision.js';
function contract(){const document={inputs:{'optional/id':{optional:true}},outputs:{answer:'actual answer'},preconditions:['Input scope matches'],postconditions:['Result verified'],side_effects:['No other record changed'],idempotency:{key:'run'},failure:{empty_ok:[]}};return {acceptance:{source:{repo:'fixture',path:'contract.yaml',activity_ref:'activity',contract_digest:digest(document)},document,criteria:contractCriterionValues(document).map((c,i)=>({id:'c'+i,...c}))}};}
test('all normative fields map mechanically to exact original JSON values with proper pointer escaping',()=>{
 const c=contract();expect(checkerCriteria(c,'start').map(v=>v.source_pointer)).toEqual(['/inputs/optional~1id','/preconditions/0']);
 expect(checkerCriteria(c,'end').map(v=>v.source_pointer)).toEqual(['/outputs/answer','/postconditions/0','/side_effects/0','/idempotency','/failure']);
 for(const pointer of ['/outputs/answer','/side_effects/0','/idempotency','/failure']){const bad=structuredClone(c);bad.acceptance.criteria=bad.acceptance.criteria.filter(v=>v.source_pointer!==pointer);expect(()=>checkerCriteria(bad,'end')).toThrow('checker_contract_incomplete');}
});
test('source identity, changed criterion text, duplicate pointers, and document drift are rejected',()=>{
 for(const mutate of [c=>delete c.acceptance.source.repo,c=>c.acceptance.criteria[0].requirement='new standard',c=>c.acceptance.criteria[1].source_pointer=c.acceptance.criteria[0].source_pointer,c=>c.acceptance.document.outputs.answer='changed']){
 const c=contract();mutate(c);expect(()=>checkerCriteria(c,'end')).toThrow('checker_contract_incomplete');}
});
test('model cannot grant replay or state that execution stopped; unknown cannot be laundered into empty',()=>{
 const request={task_id:'t',run_id:'r',run_tag:'tag',workflow:'any',activity:'x',attempt:1,nonce:'n',phase:'end',activity_contract:contract(),criteria:[{id:'fact'}]};
 const receipt={evidence_ref:'read',nonce:'n',request_sha256:digest(request),status:'available'};
 const v={identity:Object.fromEntries(['task_id','run_id','run_tag','workflow','activity','attempt'].map(k=>[k,request[k]])),nonce:'n',outcome:'passed',checks:[{id:'fact',status:'passed',reason:'actual read',expected:1,actual:1,evidence:[{source:'read',observation:{n:1}}]}],output:{},retryable:true,execution_stopped:true,external_effect:'none'};
 const verified=verifyCheckerResult(v,request,[receipt]);expect(verified.retryable).toBeUndefined();expect(verified.execution_stopped).toBeUndefined();expect(verified.external_effect).toBeUndefined();
 v.checks[0].status='unknown';v.outcome='empty';expect(()=>verifyCheckerResult(v,request,[receipt],{allowEmpty:true})).toThrow('checker_result_invalid');
});
