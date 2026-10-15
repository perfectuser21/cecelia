import {Router} from 'express';
import {internalAuthOrLoopback} from '../middleware/internal-auth.js';
import {applyTreeLegacyLayout,TASK_ID,DECISION_ID} from '../lib/tree-legacy-layout.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exact=(x,allowed,required=allowed)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>allowed.includes(k))&&required.every(k=>Object.hasOwn(x,k));
const ids=x=>Array.isArray(x)&&x.every(id=>typeof id==='string'&&uuid.test(id))&&new Set(x).size===x.length;
export function validateLegacyLayout(x){
 if(!exact(x,['actor','task_id','decision_id','client_request_id','changes'])||typeof x.actor!=='string'||!x.actor.trim()||x.actor.length>120||![x.task_id,x.decision_id].every(id=>typeof id==='string'&&uuid.test(id))||typeof x.client_request_id!=='string'||!x.client_request_id.trim()||x.client_request_id.length>120||!Array.isArray(x.changes)||x.changes.length<1||x.changes.length>20)return false;
 const allowed=['workflow_id','expected_capability_id','target_capability_id','expected_active_reference_ids','deactivate_reference_ids','name','deprecate_detached'];
 for(const c of x.changes){
  if(!exact(c,allowed,allowed.slice(0,5))||![c.workflow_id,c.expected_capability_id,c.target_capability_id].every(id=>typeof id==='string'&&uuid.test(id))||!ids(c.expected_active_reference_ids)||!ids(c.deactivate_reference_ids)||c.deactivate_reference_ids.some(id=>!c.expected_active_reference_ids.includes(id))||(Object.hasOwn(c,'name')&&(typeof c.name!=='string'||!c.name.trim()||c.name.length>255))||(Object.hasOwn(c,'deprecate_detached')&&c.deprecate_detached!==true))return false;
 }
 return new Set(x.changes.map(c=>c.workflow_id)).size===x.changes.length;
}
export function createTreeLegacyLayoutRouter({pool}){
 const router=Router();router.post('/legacy-layout',internalAuthOrLoopback,async(req,res)=>{
  if(!validateLegacyLayout(req.body))return res.status(400).json({error:{code:'INVALID_REQUEST',message:'请求格式无效'}});
  if(req.body.task_id!==TASK_ID||req.body.decision_id!==DECISION_ID)return res.status(403).json({error:{code:'SCOPE_FORBIDDEN',message:'任务或决策不属于本次整理'}});
  try{return res.json(await applyTreeLegacyLayout(pool,req.body));}
  catch(error){const status=[400,403,404,409].includes(error.status)?error.status:500;return res.status(status).json({error:{code:status===500?'LAYOUT_FAILED':error.code,message:status===500?'改挂失败，请使用同一请求键重试':error.message}});}
 });return router;
}
