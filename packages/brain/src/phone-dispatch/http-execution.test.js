import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {node,token,wire,signed,serverFixture,endpoint} from '../__tests__/fixtures/phone-http.js';
import {resolvePhoneHubBinding,resolvePhoneHttpLeaseBinding} from './http-binding.js';
import {createPhoneHttpClient} from './http-client.js';
import {isPhoneHttpExecutionReceipt} from './http-execution.js';
async function binding(){const n=node();return resolvePhoneHubBinding({query:async()=>({rows:[n]})},{executionVersionId:n.id,machineId:n.canonical_id});}
async function executionBinding(){
 const n=node(),e=endpoint(),row={id:randomUUID(),task_id:randomUUID(),reservation_id:randomUUID(),execution_version_id:n.id,execution_grant_id:randomUUID(),lease_token:randomUUID(),execution_id:randomUUID(),transport_mode:'http',machine_id:n.canonical_id,worker_id:n.worker_id,worker_boot_id:n.worker_boot_id,host:'fixture-host',serial:'fixture-serial',profile:'fixture-profile',account_id:'fixture-account',action:'adb_get_state',config_digest:'f'.repeat(64),http_binding:{execution_version_id:n.id,...e},canonical_id:n.canonical_id,version_worker_id:n.worker_id,version_boot_id:n.worker_boot_id,version_endpoints:n.endpoints};
 return resolvePhoneHttpLeaseBinding({query:async()=>({rows:[row]})},{dispatchId:row.id});
}
const leaseKeys=['dispatch_id','reservation_id','task_id','machine_id','host','serial','profile','account_id','execution_version_id','execution_grant_id','lease_token','execution_id','worker_id','worker_boot_id','action','config_digest'];
function executionWire(b,request){
 const r=wire('capabilities',request.request_nonce);
 for(const k of ['machine_id','worker_id','physical_boot_id','action','action_digest','resources','adb_daemon','external_locks','maintenance','physical_config_digest','physical_build_digest','physical_observed_at'])delete r[k];
 return {...r,schema:'phone-execution/v1',execution:true,operation:request.operation,physical:b.physical,physical_observed_at:new Date().toISOString(),identity:{...request.identity,status:'unknown'}};
}
it('C2真实HTTP三方法只接受DB历史lease，完整身份入wire且新nonce，不开放普通版本binding',async()=>{
 let calls=0;const nonces=new Set(),b=await executionBinding();
 await serverFixture((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{calls++;const request=JSON.parse(raw);expect(req.url).toBe('/phones/'+b.serial+'/'+request.operation);expect(req.headers.authorization).toBe('Bearer '+token);expect(request.identity).toEqual(Object.fromEntries(leaseKeys.map(k=>[k,b[k]])));nonces.add(request.request_nonce);res.end(JSON.stringify(signed(executionWire(b,request))));});},async()=>{
  const client=createPhoneHttpClient({token});for(const operation of ['start','inspect','cancel']){const receipt=await client[operation](b);expect(receipt).toMatchObject({operation,identity:{status:'unknown'}});expect(isPhoneHttpExecutionReceipt(receipt)).toBe(true);expect(isPhoneHttpExecutionReceipt({...receipt})).toBe(false);expect(Object.isFrozen(receipt.identity)).toBe(true);}
  expect(calls).toBe(3);expect(nonces.size).toBe(3);
  for(const bad of [await binding(),{...b}])await expect(client.start(bad)).rejects.toThrow('phone_runtime_not_connected');expect(calls).toBe(3);
 });
});
it('C2认证执行wire拒绝租约或双端身份错配、旧物理观测、nonce替换与终态证据缺失',async()=>{
 const b=await executionBinding();
 const mutations=[r=>r.identity.task_id=randomUUID(),r=>r.identity.lease_token=randomUUID(),r=>r.identity.config_digest='0'.repeat(64),r=>r.physical.physical_boot_id='wrong',r=>r.physical.action_digest='0'.repeat(64),r=>r.config_digest='0'.repeat(64),r=>r.physical_observed_at=new Date(Date.now()-60000).toISOString(),r=>r.request_nonce=randomUUID(),r=>r.identity.status='completed',r=>r.extra=true];
 for(const mutate of mutations)await serverFixture((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const r=executionWire(b,JSON.parse(raw));r.physical={...r.physical};mutate(r);res.end(JSON.stringify(signed(r)));});},async()=>{await expect(createPhoneHttpClient({token}).inspect(b)).rejects.toThrow('phone_http_unconfirmed');});
});
it('C2丢失启动回复只有一次请求，总deadline销毁真实socket，不自动补发',async()=>{
 const b=await executionBinding();let calls=0,closed=false;
 await serverFixture((req,res)=>{calls++;req.resume();req.on('end',()=>{res.writeHead(200);res.write('{');});res.on('close',()=>closed=true);},async()=>{
  await expect(createPhoneHttpClient({token,timeoutMs:50}).start(b)).rejects.toThrow('phone_http_unconfirmed');await new Promise(r=>setTimeout(r,20));expect(calls).toBe(1);expect(closed).toBe(true);
 });
});

it('http-execution: 每条租约和physical字段必须匹配，签名有效也不能代替身份',async()=>{
 const b=await executionBinding();
 for(const group of ['identity','physical'])for(const key of group==='identity'?leaseKeys:Object.keys(b.physical))await serverFixture((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const r=executionWire(b,JSON.parse(raw));r[group]={...r[group],[key]:'mismatch'};res.end(JSON.stringify(signed(r)));});},async()=>{await expect(createPhoneHttpClient({token}).inspect(b)).rejects.toThrow('phone_http_unconfirmed');});
});
it('http-execution: 完整终态退出和自己的解锁证据方可认证，缺少任何一项拒绝',async()=>{
 const b=await executionBinding();
 for(const missing of [null,'execution_exited','lock_released','lock_owner'])await serverFixture((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const r=executionWire(b,JSON.parse(raw));r.identity={...r.identity,status:'completed',execution_exited:true,lock_released:true,lock_owner:b.lease_token};if(missing)delete r.identity[missing];res.end(JSON.stringify(signed(r)));});},async()=>{const pending=createPhoneHttpClient({token}).inspect(b);if(missing)await expect(pending).rejects.toThrow('phone_http_unconfirmed');else expect((await pending).identity).toMatchObject({status:'completed',execution_exited:true,lock_released:true});});
});
