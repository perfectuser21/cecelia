'use strict';
const {createHash,createHmac,timingSafeEqual}=require('node:crypto');
const KEYS=['machine_registry_id','pool_config_digest','revision','host_boot_id','worker_boot_id','daemon_id','execution_version_id','execution_grant_id','profile_digest'];
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const HEX=/^[a-f0-9]{64}$/;
const fail=()=>{throw Error('linux_script_permit_unverified');};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function inputs({key,expected,action,body,now}) {
 if(typeof key!=='string'||!HEX.test(key)||!exact(expected,KEYS)||!['start','inspect','cancel'].includes(action)
  ||!body||typeof body!=='object'||Array.isArray(body)||Object.hasOwn(body,'permit')||Buffer.byteLength(JSON.stringify(body))>65536
  ||!UUID.test(body.reservation_id)||!UUID.test(body.request_nonce)||!Number.isSafeInteger(now)||now<1
  ||['machine_registry_id','host_boot_id','worker_boot_id','execution_version_id','execution_grant_id'].some(k=>typeof expected[k]!=='string'||!UUID.test(expected[k]))
  ||expected.machine_registry_id==='1a379d80-ad36-47d3-88ba-e545ab299a54'
  ||!HEX.test(expected.pool_config_digest)||!HEX.test(expected.profile_digest)||!/^[a-f0-9]{40}$/.test(expected.revision)
  ||typeof expected.daemon_id!=='string'||!expected.daemon_id||expected.daemon_id.length>256)fail();
}
function signLinuxScriptPermit({key,expected,action,body,now=Date.now()}) {
 try {
  inputs({key,expected,action,body,now});
  const payload={schema_version:'linux-script-permit/v1',...Object.fromEntries(KEYS.map(k=>[k,expected[k]])),
   action,request_nonce:body.request_nonce,body_digest:digest(body),issued_at_ms:now,expires_at_ms:now+30000};
  return {payload,signature:createHmac('sha256',key).update(JSON.stringify(payload)).digest('hex')};
 }catch{fail();}
}
function verifyLinuxScriptPermit({key,expected,action,body,permit,now=Date.now()}) {
 try {
  inputs({key,expected,action,body,now});
  if(!exact(permit,['payload','signature'])||typeof permit.signature!=='string'||!HEX.test(permit.signature))fail();
  const p=permit.payload;
  if(!exact(p,['schema_version',...KEYS,'action','request_nonce','body_digest','issued_at_ms','expires_at_ms'])
   ||p.schema_version!=='linux-script-permit/v1'||KEYS.some(k=>p[k]!==expected[k])||p.action!==action
   ||p.request_nonce!==body.request_nonce||p.body_digest!==digest(body)
   ||!Number.isSafeInteger(p.issued_at_ms)||!Number.isSafeInteger(p.expires_at_ms)||p.expires_at_ms<=p.issued_at_ms
   ||p.expires_at_ms-p.issued_at_ms>30000||p.issued_at_ms>now+1000||p.expires_at_ms<=now)fail();
  const signature=createHmac('sha256',key).update(JSON.stringify(p)).digest();
  if(!timingSafeEqual(signature,Buffer.from(permit.signature,'hex')))fail();
  return Object.freeze({...p});
 }catch{fail();}
}
module.exports={signLinuxScriptPermit,verifyLinuxScriptPermit};
