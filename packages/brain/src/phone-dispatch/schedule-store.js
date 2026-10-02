import {randomUUID} from 'node:crypto';
import {digest} from './identity.js';
import {PHONE_SCHEDULE_REGISTRY_AUTHORITY,schedulePinValid,createPhoneScheduledTask as createTask} from './task-authority.js';
import {planTemplate} from '../lib/recurring-schedule.js';
const registryKey='cecelia.phone_schedule_registry';
const admissionKey='cecelia.phone_schedule_admission';
const fingerprint=t=>digest({task_type:t.task_type,recurrence_type:t.recurrence_type,cron_expression:t.cron_expression,template:t.template,goal_id:t.goal_id,project_id:t.project_id});
function requireAuthority(c){if(c?.registryAuthority!==PHONE_SCHEDULE_REGISTRY_AUTHORITY)throw Error('phone_schedule_registry_authority_required');}
async function transaction(pool,fn){const borrowed=pool.constructor?.name==='Client';const c=borrowed?pool:await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{if(!borrowed)c.release();}}
async function lockTemplate(c,id){await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`phone-schedule:${id}`]);return (await c.query('SELECT *,next_run_at::text AS next_run_at_raw FROM recurring_tasks WHERE id=$1 FOR UPDATE',[id])).rows[0];}
function expiry(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))throw Error('phone_schedule_expiry_required');return d;}
export async function registerPhoneSchedule(pool,{templateId,phone,parentTaskId=null,expiresAt},context={}){
 requireAuthority(context);if(!schedulePinValid(phone))throw Error('phone_schedule_pins_invalid');const expires=expiry(expiresAt);
 return transaction(pool,async c=>{
  const t=await lockTemplate(c,templateId);if(!t||t.task_type!=='device_job')throw Error('phone_schedule_template_invalid');
  const revision=Number((await c.query('SELECT COALESCE(max(revision),0)+1 revision FROM phone_schedule_registrations WHERE template_id=$1',[templateId])).rows[0].revision);
  const id=randomUUID();await c.query('SELECT set_config($1,$2,true)',[registryKey,`${id}:${revision}`]);
  return (await c.query(`INSERT INTO phone_schedule_registrations(id,template_id,revision,state,phone,template_digest,title,priority,parent_task_id,expires_at) VALUES($1,$2,$3,'inactive',$4,$5,$6,$7,$8,$9) RETURNING *`,[id,templateId,revision,phone,fingerprint(t),t.title,t.priority||'P1',parentTaskId,expires])).rows[0];
 });
}
export async function setPhoneScheduleState(pool,{registrationId,revision,state,expiresAt},context={}){
 requireAuthority(context);if(!['active','inactive','revoked'].includes(state)||!Number.isSafeInteger(revision)||revision<1)throw Error('phone_schedule_state_invalid');
 return transaction(pool,async c=>{
  await c.query('SELECT set_config($1,$2,true)',[registryKey,`${registrationId}:${revision}`]);
  const result=await c.query('UPDATE phone_schedule_registrations SET state=$3,expires_at=COALESCE($4,expires_at) WHERE id=$1 AND revision=$2 RETURNING *',[registrationId,revision,state,expiresAt==null?null:expiry(expiresAt)]);
  if(result.rows.length!==1)throw Error('phone_schedule_revision_mismatch');return result.rows[0];
 });
}
async function assertPhone(c,r){
 const p=(await c.query('SELECT * FROM phone_registry WHERE serial=$1 FOR SHARE',[r.phone.serial])).rows[0];
 const accounts=p?.douyin_accounts?.filter(a=>a.current===true)||[];
 if(!p||p.enabled!==true||p.host!==r.phone.host||p.profile!==r.phone.profile||accounts.length!==1||accounts[0].id!==r.phone.account_id)throw Error('phone_schedule_phone_changed');
 const m=(await c.query(`SELECT n.canonical_id FROM execution_nodes n JOIN system_registry s ON s.id=n.machine_registry_id WHERE n.canonical_id=$1 AND s.status='active'`,[r.phone.machine_id])).rows[0];
 if(!m)throw Error('phone_schedule_machine_changed');
}
export async function processPhoneScheduledSlot(pool,{templateId,now=new Date()}){
 return transaction(pool,async c=>{
  const t=await lockTemplate(c,templateId);if(!t)throw Error('phone_schedule_template_invalid');
  const r=(await c.query('SELECT * FROM phone_schedule_registrations WHERE template_id=$1 ORDER BY revision DESC LIMIT 1 FOR UPDATE',[templateId])).rows[0];
  if(!r)throw Error('phone_schedule_unregistered');if(r.state!=='active')throw Error('phone_schedule_inactive');
  if(new Date(r.expires_at).getTime()<=Date.now())throw Error('phone_schedule_expired');
  if(fingerprint(t)!==r.template_digest)throw Error('phone_schedule_template_changed');if(!t.is_active)return {state:'inactive'};
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`phone-schedule-serial:${r.phone.serial}`]);
  await assertPhone(c,r);const plan=planTemplate(t,now);
  if(['baseline','missed'].includes(plan.action)){
   const updated=await c.query('UPDATE recurring_tasks SET next_run_at=$1,last_run_status=$2 WHERE id=$3 AND next_run_at IS NOT DISTINCT FROM $4::timestamptz AND is_active=true RETURNING id',[plan.nextRunAt,plan.action,templateId,t.next_run_at_raw]);
   if(updated.rowCount!==1)throw Error('phone_schedule_cas_lost');
   // BEFORE UPDATE triggers can wait past expiry. Read again after all mutation work, before COMMIT.
   const current=(await c.query("SELECT r.state='active' AND r.expires_at>clock_timestamp() AND t.is_active AS valid FROM phone_schedule_registrations r JOIN recurring_tasks t ON t.id=r.template_id WHERE r.id=$1",[r.id])).rows[0];
   if(current?.valid!==true)throw Error('phone_schedule_expired');
   return {state:plan.action,slot:plan.slot,nextRunAt:plan.nextRunAt};
  }
  if(plan.action!=='run')return {state:plan.action};
  const slot=plan.slot.toISOString();
  const existing=(await c.query('SELECT s.*,t.* FROM phone_scheduled_slots s JOIN tasks t ON t.id=s.task_id WHERE s.template_id=$1 AND s.slot=$2',[templateId,slot])).rows[0];
  if(existing)return {state:'existing',task:existing};
  const collision=(await c.query('SELECT task_id FROM work_routing_receipts WHERE source=$1 AND source_id=$2 LIMIT 1',['scheduler',`recurring:${templateId}:${slot}`])).rows[0];
  if(collision)throw Error('phone_schedule_route_collision');
  const open=(await c.query(`SELECT t.id FROM phone_task_owners o JOIN tasks t ON t.id=o.task_id WHERE (o.template_id=$1 OR o.phone->>'serial'=$2) AND t.status NOT IN ('completed','failed','cancelled')
   UNION ALL SELECT task_id AS id FROM phone_dispatches WHERE serial=$2 AND state<>'terminal' LIMIT 1`,[templateId,r.phone.serial])).rows[0];
  if(open)return {state:'overlap'};
  await c.query('SELECT set_config($1,$2,true)',[admissionKey,`${r.id}:${r.revision}:${slot}`]);
  const created=await createTask({db:c,registration:r,slot:plan.slot});const task=created.task;
  const receipt=(await c.query('SELECT id FROM work_routing_receipts WHERE task_id=$1',[task.id])).rows[0];if(!receipt)throw Error('phone_schedule_receipt_required');
  await c.query('INSERT INTO phone_scheduled_slots(template_id,slot,registration_id,revision,task_id,routing_receipt_id) VALUES($1,$2,$3,$4,$5,$6)',[templateId,slot,r.id,r.revision,task.id,receipt.id]);
  await c.query('INSERT INTO phone_task_owners(task_id,template_id,slot,registration_id,revision,routing_receipt_id,phone) VALUES($1,$2,$3,$4,$5,$6,$7)',[task.id,templateId,slot,r.id,r.revision,receipt.id,r.phone]);
  const updated=await c.query('UPDATE recurring_tasks SET next_run_at=$1,last_run_at=$2,last_run_status=$3,skip_streak=0 WHERE id=$4 AND next_run_at=$5::timestamptz AND is_active=true RETURNING id',[plan.nextRunAt,slot,'created',templateId,t.next_run_at_raw]);
  if(updated.rowCount!==1)throw Error('phone_schedule_cas_lost');return {state:'created',nextRunAt:plan.nextRunAt,task:(await c.query('SELECT * FROM tasks WHERE id=$1',[task.id])).rows[0]};
 });
}
