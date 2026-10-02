import {createHash} from 'node:crypto';
export const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
const safeHost=s=>typeof s==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(s);
const safeUser=s=>typeof s==='string'&&/^[a-z_][a-z0-9_-]*$/.test(s);
function targetValid(t){return t&&Object.keys(t).every(k=>['host','port','user'].includes(k))&&safeHost(t.host)&&safeUser(t.user)&&Number.isInteger(t.port)&&t.port>0&&t.port<=65535;}
export function phoneSshValid(e){return e&&Object.keys(e).every(k=>['host','port','user','hub'].includes(k))&&targetValid({host:e.host,port:e.port,user:e.user})&&targetValid(e.hub);}
export function validSnapshot(s,m,now=Date.now()){
 return s?.verified===true&&s.machine===m&&Number.isFinite(s.captured_at)&&Number.isFinite(s.expires_at)
  &&s.captured_at<=now&&now-s.captured_at<=60_000&&s.expires_at>now&&s.expires_at-s.captured_at<=60_000
  &&s.capacity?.ok===true&&Number.isInteger(s.capacity.available)&&s.capacity.available>0
  &&[s.capacity.physical_base_slots,s.capacity.effective_base_slots].every(n=>Number.isInteger(n)&&n>0);
}
export const RECEIPT_BINDINGS=['reservation_id','task_id','machine_id','host','serial','profile','account_id','execution_version_id','execution_grant_id','lease_token','execution_id','worker_id','worker_boot_id','action','config_digest'];
export function receiptMatches(row,verified,terminal=false){
 const r=verified?.receipt;
 return verified?.authenticated===true&&r?.dispatch_id===row.id&&RECEIPT_BINDINGS.every(k=>typeof row[k]==='string'&&row[k].length>0&&r[k]===row[k])
  &&(!terminal||(['completed','failed'].includes(r.status)&&r.execution_exited===true&&r.lock_released===true&&r.lock_owner===row.lease_token));
}
