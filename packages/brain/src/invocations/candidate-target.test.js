import {it,expect} from 'vitest';
import {candidateSlotTarget,canonicalOwnerTarget} from './candidate-target.js';
const authoringTaskId='11111111-1111-4111-8111-111111111111',activityId='22222222-2222-4222-8222-222222222222';
const composeSha256='a'.repeat(64),tenantId='alpha';
it('共享同Activity两slot不能省略slot；显式slot与服务器身份等价且不接受任意实体',()=>{
 const owner={authoring_task_id:authoringTaskId,slots:['first','second'].map(slot_key=>({slot_key,activity_id:activityId}))};
 const body={mode:'candidate',authoring_task_id:authoringTaskId,compose_sha256:composeSha256,target:{kind:'activity',id:activityId}};
 expect(()=>canonicalOwnerTarget(body,tenantId,owner)).toThrow('candidate_slot_ambiguous');
 const targets=owner.slots.map(slot=>canonicalOwnerTarget({...body,target:{...body.target,slot_key:slot.slot_key}},tenantId,owner));
 expect(targets[0].id).not.toBe(targets[1].id);
 expect(targets[0]).toEqual(candidateSlotTarget({authoringTaskId,composeSha256,slotKey:'first',tenantId}));
 expect(()=>canonicalOwnerTarget({...body,target:{kind:'activity',id:'33333333-3333-4333-8333-333333333333',slot_key:'first'}},tenantId,owner)).toThrow('候选slot身份不匹配');
});
