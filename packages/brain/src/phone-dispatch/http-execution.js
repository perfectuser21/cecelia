import {createHmac,timingSafeEqual} from 'node:crypto';
import {exactKeys,freezeEvidence,isPhoneHttpLeaseBinding} from './http-binding.js';
import {credentialValid} from './http-receipt.js';
import protocol from '../../scripts/phone-ssh/protocol.cjs';
const trusted=new WeakSet();
const fresh=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&Date.now()-Date.parse(s)>=-1000&&Date.now()-Date.parse(s)<=5000;
const common=['schema','scope','hub_id','boot_id','build_digest','config_digest','http_endpoint','hub_process_identity','execution','request_nonce','observed_at','operation','physical','physical_observed_at','identity'];
export const isPhoneHttpExecutionReceipt=value=>trusted.has(value);
export function phoneHttpExecutionIdentity(binding){
 if(!isPhoneHttpLeaseBinding(binding))throw Error('phone_runtime_not_connected');
 const identity=Object.fromEntries(['dispatch_id',...protocol.BINDINGS].map(k=>[k,binding[k]]));
 if(!protocol.identityValid(identity))throw Error('phone_http_lease_invalid');
 return identity;
}
/** Authentication produces an internal brand; caller booleans and copied replies cannot settle a lease. */
export function verifyPhoneHttpExecutionReceipt(envelope,{binding:b,token,nonce,operation}){
 const fail=()=>{throw Error('phone_http_receipt_unconfirmed');};
 if(!isPhoneHttpLeaseBinding(b)||!credentialValid(token)||!protocol.UUID.test(nonce??'')||!['start','inspect','cancel'].includes(operation)||!exactKeys(envelope,['receipt','signature'])||typeof envelope.signature!=='string'||!/^[a-f0-9]{64}$/.test(envelope.signature))return fail();
 const r=envelope.receipt;
 if(!exactKeys(r,common))return fail();
 const signature=createHmac('sha256',token).update(JSON.stringify(r)).digest();
 if(!timingSafeEqual(signature,Buffer.from(envelope.signature,'hex')))return fail();
 if(r.schema!=='phone-execution/v1'||r.scope!=='phone-hub'||r.execution!==true||r.operation!==operation||r.request_nonce!==nonce||!fresh(r.observed_at)||!fresh(r.physical_observed_at)||r.hub_id!==b.hub_id||r.boot_id!==b.hub_boot_id||r.config_digest!==b.hub_config_digest||r.build_digest!==b.hub_build_digest||r.http_endpoint!==b.http_endpoint)return fail();
 const process=r.hub_process_identity;
 if(!exactKeys(process,['pid','boot_id','start_time','pgid','state'])||!Number.isSafeInteger(process.pid)||process.pid<=1||!Number.isSafeInteger(process.pgid)||process.pgid<=0||process.boot_id!==b.hub_boot_id||typeof process.start_time!=='string'||!process.start_time||typeof process.state!=='string'||!process.state)return fail();
 if(!exactKeys(r.physical,Object.keys(b.physical))||!Object.keys(b.physical).every(k=>r.physical[k]===b.physical[k]))return fail();
 if(!exactKeys(r.identity,['dispatch_id',...protocol.BINDINGS,'status'],['execution_exited','lock_released','lock_owner','reason'])||!protocol.receiptValid(phoneHttpExecutionIdentity(b),r.identity))return fail();
 const receipt=freezeEvidence(structuredClone(r));trusted.add(receipt);return receipt;
}
