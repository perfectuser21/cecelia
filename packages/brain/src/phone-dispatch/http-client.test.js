import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {node,token,wire,signed,serverFixture,physical,maintenance,endpoint} from '../__tests__/fixtures/phone-http.js';
import {resolvePhoneHubBinding,resolvePhoneHttpLeaseBinding} from './http-binding.js';
import {randomUUID} from 'node:crypto';
import {createPhoneHttpClient} from './http-client.js';
async function binding(){const n=node();return resolvePhoneHubBinding({query:async()=>({rows:[n]})},{executionVersionId:n.id,machineId:n.canonical_id});}
it('真实HTTP Bearer与每次fresh nonce，对接现有Hub service的精确HMAC wire',async()=>{
 const require=createRequire(import.meta.url),{createPhoneHubServer}=require('../../scripts/phone-hub/service.cjs'),e=endpoint();
 const handler=createPhoneHubServer({token,identity:{hub_id:e.hub_id,boot_id:e.hub_boot_id,build_digest:e.hub_build_digest,config_digest:e.hub_config_digest,http_endpoint:e.http_endpoint,hub_process_identity:{pid:123,boot_id:e.hub_boot_id,start_time:'fixture-process-start',pgid:123,state:'S'}},capabilities:async()=>physical(),maintenance:async()=>({proof_scope:'hub-control',hub_control:maintenance(),targets:[{machine_id:e.physical.machine_id,status:'verified',...maintenance()}],pending:0,stable:false,quiescent:false})});
 await serverFixture((req,res)=>handler.emit('request',req,res),async()=>{
  const b=await binding(),client=createPhoneHttpClient({token});
  const one=await client.capabilities(b),two=await client.capabilities(b);expect(one.request_nonce).not.toBe(two.request_nonce);expect(one.resources.cpu_count).toBe(4);expect(await client.maintenance(b)).toMatchObject({proof_scope:'hub-control',pending:0});
  await expect(createPhoneHttpClient({token:'wrong-private-token-'.repeat(3)}).capabilities(b)).rejects.toThrow('phone_http_unconfirmed');
 });
});
it('默认缺凭据／假binding以及执行三方法零network',async()=>{
 let calls=0;await serverFixture((req,res)=>{calls++;res.end('{}');},async()=>{
  const b=await binding();await expect(createPhoneHttpClient().capabilities(b)).rejects.toThrow();await expect(createPhoneHttpClient({token}).capabilities({...b})).rejects.toThrow();
  const client=createPhoneHttpClient({token});for(const op of ['start','inspect','cancel'])await expect(client[op](b)).rejects.toThrow('phone_runtime_not_connected');expect(calls).toBe(0);
 });
});
it('真实Hub新签名不能把物理旧采样时间刷新成新鲜观测',async()=>{
 const {createPhoneHubServer}=createRequire(import.meta.url)('../../scripts/phone-hub/service.cjs'),e=endpoint();
 const hub=createPhoneHubServer({token,identity:{hub_id:e.hub_id,boot_id:e.hub_boot_id,build_digest:e.hub_build_digest,config_digest:e.hub_config_digest,http_endpoint:e.http_endpoint,hub_process_identity:{pid:123,boot_id:e.hub_boot_id,start_time:'fixture-start',pgid:123,state:'S'}},capabilities:async()=>({...physical(),observed_at:new Date(Date.now()-60000).toISOString()}),maintenance:async()=>({})});
 await serverFixture((req,res)=>hub.emit('request',req,res),async()=>{await expect(createPhoneHttpClient({token}).capabilities(await binding())).rejects.toThrow('phone_http_unconfirmed');});
});
it('chunked超限、重定向、坏JSON与nonce替换真实HTTP拒绝且不跟随',async()=>{
 for(const kind of ['redirect','oversize','bad-json','nonce']){
  let calls=0;await serverFixture((req,res)=>{calls++;let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
   if(kind==='redirect'){res.writeHead(302,{location:'/maintenance/status'});res.end();}
   else if(kind==='oversize'){res.writeHead(200);res.write('x'.repeat(9000));res.end('x'.repeat(9000));}
   else if(kind==='bad-json')res.end('{');else res.end(JSON.stringify(signed(wire('capabilities','00000000-0000-4000-8000-000000000000'))));
  });},async()=>{await expect(createPhoneHttpClient({token}).capabilities(await binding())).rejects.toThrow('phone_http_unconfirmed');expect(calls).toBe(1);});
 }
});
it('总recvdeadline不能被持续分块延长，真实socket最终关闭',async()=>{
 let timer,closed=false;await serverFixture((req,res)=>{res.writeHead(200);res.write('{');timer=setInterval(()=>res.write(' '),10);res.on('close',()=>{closed=true;clearInterval(timer);});},async()=>{
  const started=Date.now();await expect(createPhoneHttpClient({token,timeoutMs:60}).capabilities(await binding())).rejects.toThrow('phone_http_unconfirmed');expect(Date.now()-started).toBeLessThan(1000);await new Promise(r=>setTimeout(r,20));expect(closed).toBe(true);
 });clearInterval(timer);
});

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
  const client=createPhoneHttpClient({token});for(const operation of ['start','inspect','cancel'])expect(await client[operation](b)).toMatchObject({operation,identity:{status:'unknown'}});
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
