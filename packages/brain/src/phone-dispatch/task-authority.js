import {exactKeys,freezeEvidence} from './http-binding.js';
import protocol from '../../scripts/phone-ssh/protocol.cjs';
const {UUID}=protocol;
export const PHONE_TASK_AUTHORITY=Symbol('phone-scheduled-task');
export const PHONE_SCHEDULE_REGISTRY_AUTHORITY=Symbol('phone-schedule-registry');
const PHONE_KEYS=['machine_id','serial','host','profile','account_id','action'];
export function schedulePinValid(pin){
 return exactKeys(pin,PHONE_KEYS)&&PHONE_KEYS.every(k=>typeof pin[k]==='string'&&pin[k].length>0&&Buffer.byteLength(pin[k])<=256)&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(pin.serial)&&pin.action==='adb_get_state';
}
export function assertPhoneTaskAuthority(request,context={}){
 if(request.task?.executor_kind!=='phone-ssh-controller'&&request.executor_kind!=='phone-ssh-controller')return false;
 const p=request.metadata?.phone_schedule;
 if(context.phoneTaskAuthority!==PHONE_TASK_AUTHORITY||request.source!=='scheduler'||request.requested_task_type!=='device_job'||request.task?.executor_kind!=='phone-ssh-controller'||request.task?.status!=='queued'||request.task?.kind!=='agent'||request.metadata?.policy!=='phone-schedule-v1'||
  !exactKeys(p,['template_id','registration_id','revision','slot','phone'])||!UUID.test(p.template_id)||!UUID.test(p.registration_id)||!Number.isSafeInteger(p.revision)||p.revision<1||typeof p.slot!=='string'||!Number.isFinite(Date.parse(p.slot))||new Date(p.slot).toISOString()!==p.slot||request.source_id!==`recurring:${p.template_id}:${p.slot}`||!schedulePinValid(p.phone))throw Error('phone_task_authority_required');
 return true;
}
export async function createPhoneScheduledTask({db,registration,slot}){
 const {createTask}=await import('../actions.js');
 const phone_schedule=freezeEvidence({template_id:registration.template_id,registration_id:registration.id,revision:Number(registration.revision),slot:slot.toISOString(),phone:structuredClone(registration.phone)});
 return createTask({db,title:`${registration.title} · ${slot.toISOString()} · ${registration.template_id}`,description:'受信定时手机任务；仅由独立controller及认证回执推进执行。',priority:registration.priority,created_by:'phone-schedule-service',task_type:'device_job',executor_kind:'phone-ssh-controller',status:'queued',kind:'agent',source:'scheduler',source_id:`recurring:${registration.template_id}:${slot.toISOString()}`,mutation_intent:'none',declared_domain:'operations',allow_unscoped:true,trigger_source:'recurring',parent_task_id:registration.parent_task_id,payload:{policy:'phone-schedule-v1',phone_schedule,recurring_task_id:registration.template_id,recurring_slot:slot.toISOString()}},{phoneTaskAuthority:PHONE_TASK_AUTHORITY});
}
