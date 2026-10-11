import { it,expect } from 'vitest';
import { implementationSourceOwners } from '../implementation-ci-snapshot.js';
const id='11111111-1111-4111-8111-111111111111',cap='22222222-2222-4222-8222-222222222222';
function snapshot(){
 const w={id,key:'douyin_video_publish.android',name:'抖音视频',channel:'douyin',capability_id:cap,status:'active',source_repo:'perfectuser21/zenithjoy-workspace',source_path:'product-map/contracts/douyin_video_publish.yaml',source_capability:'douyin_video_publish',source_workflow:'douyin-video-publish'};
 return {repo:w.source_repo,scope:'zenithjoy',status:'verified',gaps:[],canonical:{workflows:[w],journeys:[{id:cap,parent_journey_id:'real-parent',capability_code:'android_worker_publish'}]},definitions:{workflows:[{workflow_id:id,payload:{key:w.key,capability_id:cap,contract:{contract_key:w.source_capability,capability:'android_worker_publish',workflow:w.source_workflow,brain_workflow_key:w.key,source_repo:w.source_repo}}}]},source_registry:{schema_version:1,purpose:'definition_source_only',repo:w.source_repo,workflows:[w]}};
}
it('明确contract_key/brainkey/source与真实能力归属时，同能力流程各自拥有来源，不要求虚构共同owner',()=>{
 const s=snapshot();expect(implementationSourceOwners(s)).toEqual([{...s.canonical.workflows[0],capability_code:'android_worker_publish'}]);
});
it.each(['capability_code','source_path','source_repo','source_workflow','source_capability','key','capability_id'])('当前合同owner的%s冒名不能通过',field=>{
 const s=snapshot();s.source_registry.workflows[0][field]='wrong';expect(()=>implementationSourceOwners(s)).toThrow();
});
it('规范能力code不一致或缺失拒绝，不能靠owner自报code',()=>{
 for(const code of ['wrong',null]){const s=snapshot();s.canonical.journeys[0].capability_code=code;expect(()=>implementationSourceOwners(s)).toThrow();}
});
