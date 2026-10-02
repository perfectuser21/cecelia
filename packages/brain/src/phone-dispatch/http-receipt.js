import {createHmac,timingSafeEqual} from 'node:crypto';
import {exactKeys,freezeEvidence,isPhoneHubBinding} from './http-binding.js';
import maintenanceModule from '../../scripts/phone-hub/maintenance.cjs';
const {valid:maintenanceValid}=maintenanceModule;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const int=value=>Number.isSafeInteger(value)&&value>=0;
const string=value=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=256;
export const credentialValid=token=>typeof token==='string'&&Buffer.byteLength(token)>=32&&Buffer.byteLength(token)<=256&&!/\s/.test(token);
const fresh=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.now()-Date.parse(value)>=-1000&&Date.now()-Date.parse(value)<=5000;
const MAINTENANCE_FIELDS=['pending','in_flight','activity_revision','draining','stable','quiescent','marker_identity'];
function validMaintenance(value,boot){
 return exactKeys(value,MAINTENANCE_FIELDS,['journal_pending','external_occupied'])&&maintenanceValid(value)&&
  (!value.marker_identity||!boot||value.marker_identity.boot_id===boot)&&
  (!Object.hasOwn(value,'journal_pending')||(int(value.journal_pending)&&int(value.external_occupied)&&value.pending===value.journal_pending+value.external_occupied));
}
function processValid(value,boot){return exactKeys(value,['pid','boot_id','start_time','pgid','state'])&&Number.isSafeInteger(value.pid)&&value.pid>1&&Number.isSafeInteger(value.pgid)&&value.pgid>0&&value.boot_id===boot&&string(value.start_time)&&string(value.state);}
const COMMON=['schema','scope','hub_id','boot_id','build_digest','config_digest','http_endpoint','hub_process_identity','execution','request_nonce','observed_at'];
function capabilityValid(r,b){
 const p=b.physical;
 if(!exactKeys(r,[...COMMON,'machine_id','worker_id','physical_boot_id','action','action_digest','resources','adb_daemon','external_locks','maintenance','physical_config_digest','physical_build_digest','physical_observed_at']))return false;
 if(!['machine_id','worker_id','physical_boot_id','action_digest'].every(k=>r[k]===p[k])||r.physical_config_digest!==p.config_digest||r.physical_build_digest!==p.build_digest||r.action!=='adb_get_state'||!fresh(r.physical_observed_at))return false;
 const v=r.resources;
 return exactKeys(v,['cpu_count','memory_total_bytes','memory_free_bytes','load_1m','data_free_bytes'])&&['cpu_count','memory_total_bytes','data_free_bytes'].every(k=>int(v[k])&&v[k]>0)&&int(v.memory_free_bytes)&&v.memory_free_bytes<=v.memory_total_bytes&&Number.isFinite(v.load_1m)&&v.load_1m>=0&&
  exactKeys(r.adb_daemon,['reachable'])&&typeof r.adb_daemon.reachable==='boolean'&&exactKeys(r.external_locks,['occupied'])&&int(r.external_locks.occupied)&&validMaintenance(r.maintenance,p.physical_boot_id)&&r.maintenance.pending>=r.external_locks.occupied&&(!r.maintenance.quiescent||r.external_locks.occupied===0);
}
function maintenanceReceiptValid(r,b){
 if(!exactKeys(r,[...COMMON,'proof_scope','hub_control','targets','pending','stable','quiescent'])||r.proof_scope!=='hub-control'||!validMaintenance(r.hub_control,b.hub_boot_id)||!Array.isArray(r.targets)||r.targets.length<1||r.targets.length>16||typeof r.stable!=='boolean'||typeof r.quiescent!=='boolean')return false;
 const names=new Set();let known=true,total=r.hub_control.pending;
 for(const target of r.targets){
  if(!string(target?.machine_id)||names.has(target.machine_id))return false;names.add(target.machine_id);
  if(target.status==='unknown'){if(!exactKeys(target,['machine_id','status']))return false;known=false;continue;}
  if(target.status!=='verified'||!exactKeys(target,['machine_id','status',...MAINTENANCE_FIELDS],['journal_pending','external_occupied']))return false;
  const m=Object.fromEntries(Object.entries(target).filter(([k])=>!['machine_id','status'].includes(k)));
  if(!validMaintenance(m))return false;total+=m.pending;
 }
 if(!names.has(b.physical.machine_id))return false;
 if(!known)return r.pending===null&&!r.stable&&!r.quiescent;
 if(!int(r.pending)||r.pending<total)return false;
 if(r.stable&&(!r.hub_control.stable||!r.hub_control.draining||r.targets.some(t=>!t.stable||!t.draining)))return false;
 return !r.quiescent||(r.stable&&r.pending===0&&r.hub_control.quiescent&&r.targets.every(t=>t.quiescent));
}
/** Maintenance is authenticated hub-control raw evidence, not per-target physical attestation or capacity. */
export function verifyPhoneHubReceipt(envelope,{binding:b,token,nonce,operation}){
 const fail=()=>{throw Error('phone_http_receipt_unconfirmed');};
 if(!isPhoneHubBinding(b)||!credentialValid(token)||!UUID.test(nonce??'')||!['capabilities','maintenance'].includes(operation)||!exactKeys(envelope,['receipt','signature'])||typeof envelope.signature!=='string'||!/^[a-f0-9]{64}$/.test(envelope.signature))return fail();
 const r=envelope.receipt;
 if(!r||typeof r!=='object')return fail();
 const expected=createHmac('sha256',token).update(JSON.stringify(r)).digest();if(!timingSafeEqual(expected,Buffer.from(envelope.signature,'hex')))return fail();
 if(r.schema!==(operation==='capabilities'?'phone-capabilities/v1':'phone-maintenance/v1')||r.scope!=='phone-hub'||r.execution!==false||r.request_nonce!==nonce||!fresh(r.observed_at)||r.hub_id!==b.hub_id||r.boot_id!==b.hub_boot_id||r.config_digest!==b.hub_config_digest||r.build_digest!==b.hub_build_digest||r.http_endpoint!==b.http_endpoint||!processValid(r.hub_process_identity,b.hub_boot_id))return fail();
 if(!(operation==='capabilities'?capabilityValid(r,b):maintenanceReceiptValid(r,b)))return fail();
 return freezeEvidence({...structuredClone(r),assurance:operation==='capabilities'?'selected_physical_observation':'hub_control_only'});
}
