import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {node,token,wire,signed,serverFixture,physical,maintenance,endpoint} from '../__tests__/fixtures/phone-http.js';
import {resolvePhoneHubBinding} from './http-binding.js';
import {createPhoneHttpClient,readPhoneCapacityObservation} from './http-client.js';
async function binding(){const n=node();return resolvePhoneHubBinding({query:async()=>({rows:[n]})},{executionVersionId:n.id,machineId:n.canonical_id});}
it('真实HTTP Bearer与每次fresh nonce，对接现有Hub service的精确HMAC wire',async()=>{
 const require=createRequire(import.meta.url),{createPhoneHubServer}=require('../../scripts/phone-hub/service.cjs'),e=endpoint();
 const handler=createPhoneHubServer({token,identity:{hub_id:e.hub_id,boot_id:e.hub_boot_id,build_digest:e.hub_build_digest,config_digest:e.hub_config_digest,http_endpoint:e.http_endpoint,hub_process_identity:{pid:123,boot_id:e.hub_boot_id,start_time:'fixture-process-start',pgid:123,state:'S'}},capabilities:async()=>physical(),maintenance:async()=>({proof_scope:'hub-control',hub_control:maintenance(),targets:[{machine_id:e.physical.machine_id,status:'verified',...maintenance()}],pending:0,stable:false,quiescent:false})});
 await serverFixture((req,res)=>handler.emit('request',req,res),async()=>{
  const b=await binding(),client=createPhoneHttpClient({token});
  const one=await client.capabilities(b),two=await client.capabilities(b);expect(one.request_nonce).not.toBe(two.request_nonce);expect(one.resources.cpu_count).toBe(4);const m=await client.maintenance(b);expect(m).toMatchObject({proof_scope:'hub-control',pending:0});expect(()=>readPhoneCapacityObservation(m,b)).toThrow('phone_capacity_observation_required');expect(readPhoneCapacityObservation(one,b).nonce).toBe(one.request_nonce);
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
