import {describe,it,expect} from 'vitest';
import {assertDispatchRoutingReceipt} from '../dispatch-receipt-authority.js';
const task=type=>({id:'owned',task_type:type,status:'queued',payload:{routing_receipt_id:'receipt',repo:'cecelia',change_kind:'bugfix'}});
const receipt=type=>({id:'receipt',task_id:'owned',router_version:'work-router-v1',work_kind:'coding_mutation',canonical_task_type:type,pipeline:type==='dev'?'headed_development':'coding_workflow',orchestrator:type==='dev'?'headed-session':'coding-workflow-runner',repo:'cecelia',change_kind:'bugfix',impact_contract_required:type==='dev',map_scope_validation_version:'active-business-node-v1'});
describe('现役开发授权收据',()=>{
 it.each(['dev','coding_workflow'])('%s只接受同任务当前精确执行面',type=>{
   expect(assertDispatchRoutingReceipt(task(type),receipt(type))).toBe(true);
   for(const patch of [{id:'other'},{task_id:'other'},{canonical_task_type:'harness_initiative'},{pipeline:'harness'},{orchestrator:'kernel-harness-v2'},{repo:'other'},{change_kind:'new_capability'},{superseded:true},{map_scope_validation_version:null}])expect(()=>assertDispatchRoutingReceipt(task(type),{...receipt(type),...patch})).toThrow('route_violation');
 });
 it('旧类型不因缺payload被当成普通非编码任务放行',()=>{
   expect(()=>assertDispatchRoutingReceipt({task_type:'harness_initiative'},null)).toThrow('route_violation');
 });
 it('非编码任务不承担开发收据合同',()=>{
   expect(assertDispatchRoutingReceipt({task_type:'research'},null)).toBe(true);
 });
 it.each(['queued','in_progress'])('%s旧Map代际收据无已存在执行权不放行',status=>{
   expect(()=>assertDispatchRoutingReceipt({...task('dev'),status},{...receipt('dev'),map_scope_validation_version:null},{hasV2Run:false})).toThrow('route_violation');
 });
 it('非退役任务的既有运行权保留旧Map收据的只读接续',()=>{
   expect(assertDispatchRoutingReceipt(task('dev'),{...receipt('dev'),map_scope_validation_version:null},{hasV2Run:true})).toBe(true);
 });
});
