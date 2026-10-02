'use strict';
const {randomUUID}=require('node:crypto');
const SCHEMA='phone-ssh/v1';
const BINDINGS=['reservation_id','task_id','machine_id','host','serial','profile','account_id','execution_version_id','execution_grant_id','lease_token','execution_id','worker_id','worker_boot_id','action','config_digest'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const UUID_FIELDS=['dispatch_id','reservation_id','task_id','execution_version_id','execution_grant_id','lease_token','execution_id'];
function targetValid(t){return t&&typeof t==='object'&&Object.keys(t).length===3&&Object.keys(t).every(k=>['host','user','port'].includes(k))&&/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(t.host??'')&&/^[a-z_][a-z0-9_-]*$/.test(t.user??'')&&Number.isInteger(t.port)&&t.port>0&&t.port<=65535;}
function identityValid(i){return i&&Object.keys(i).length===BINDINGS.length+1&&Object.keys(i).every(k=>[...BINDINGS,'dispatch_id'].includes(k))&&[...BINDINGS,'dispatch_id'].every(k=>typeof i[k]==='string'&&i[k].length>0&&Buffer.byteLength(i[k])<=256)&&UUID_FIELDS.every(k=>UUID.test(i[k]))&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(i.serial)&&/^[a-f0-9]{64}$/.test(i.config_digest)&&i.action==='adb_get_state';}
function requestValid(i,hub=false){return i&&Object.keys(i).length===(hub?5:4)&&Object.keys(i).every(k=>['schema','operation','identity','request_nonce',...(hub?['route']:[])].includes(k))&&i.schema===SCHEMA&&UUID.test(i.request_nonce??'')&&['start','inspect','cancel'].includes(i.operation)&&identityValid(i.identity)&&(!hub||targetValid(i.route));}
function receiptValid(expected,r){return r&&[...BINDINGS,'dispatch_id'].every(k=>r[k]===expected[k])&&['running','unknown','completed','failed'].includes(r.status)&&(!['completed','failed'].includes(r.status)||(r.execution_exited===true&&r.lock_released===true&&r.lock_owner===expected.lease_token));}
function response(result,request,hub=false){
 if(result?.code!==0||typeof result.stdout!=='string'||Buffer.byteLength(result.stdout)>65536)throw Error('phone_ssh_reply_unconfirmed');
 let e;try{e=JSON.parse(result.stdout);}catch{throw Error('phone_ssh_reply_invalid');}
 if(e.schema!==SCHEMA||e.request_nonce!==request.request_nonce||!receiptValid(request.identity,e.receipt)||(hub&&JSON.stringify(e.route)!==JSON.stringify(request.route)))throw Error('phone_ssh_reply_unverified');
 return e;
}
function makeRequest(operation,identity,route){const r={schema:SCHEMA,operation,request_nonce:randomUUID(),identity,...(route?{route}:{})};if(!requestValid(r,!!route))throw Error('phone_request_invalid');return r;}
module.exports={SCHEMA,BINDINGS,UUID,targetValid,identityValid,requestValid,receiptValid,response,makeRequest};
