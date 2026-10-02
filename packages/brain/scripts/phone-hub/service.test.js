import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {randomUUID,createHmac} from 'node:crypto';
import http from 'node:http';
const require=createRequire(import.meta.url),token='private-fixture-token-'.repeat(3);
async function fixture(options={},run){
 const {createPhoneHubServer}=require('./service.cjs');
 const server=createPhoneHubServer(options);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{await run(base);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
const post=async(base,path,body,auth=token)=>{
 const response=await fetch(base+path,{method:'POST',headers:{authorization:`Bearer ${auth}`},body:JSON.stringify(body)});
 return {status:response.status,body:await response.json()};
};
const configured=()=>({token,identity:{hub_id:'fixture-hub',boot_id:'fixture-real-observation',build_digest:'a'.repeat(64)},
 capabilities:async machine=>({machine_id:machine,physical_boot_id:'fixture-physical-observation'}),
 maintenance:async()=>({scope:'phone-hub',pending:1,quiescent:false})});
it('真实HTTP区分Hub与physical的不同config/build digest且全部进入HMAC',async()=>{
 const hubConfig='b'.repeat(64),physicalConfig='c'.repeat(64),physicalBuild='d'.repeat(64);
 const physicalTime=new Date(Date.now()-60000).toISOString();
 await fixture({...configured(),identity:{...configured().identity,config_digest:hubConfig},capabilities:async()=>({config_digest:physicalConfig,build_digest:physicalBuild,observed_at:physicalTime})},async base=>{
  const result=await post(base,'/phones/capabilities',{request_nonce:randomUUID(),machine_id:'fixture-machine'});
  expect(result.body.receipt).toMatchObject({config_digest:hubConfig,build_digest:'a'.repeat(64),physical_config_digest:physicalConfig,physical_build_digest:physicalBuild,physical_observed_at:physicalTime});
  expect(Date.parse(result.body.receipt.observed_at)).toBeGreaterThan(Date.parse(physicalTime));
  expect(result.body.signature).toBe(createHmac('sha256',token).update(JSON.stringify(result.body.receipt)).digest('hex'));
 });
});
it('默认无配置与无凭据都503，不签执行或维护成功',async()=>{
 for(const options of [{},{...configured(),token:undefined},{...configured(),identity:undefined}]){
  await fixture(options,async base=>{
   expect((await fetch(base+'/health')).status).toBe(503);
   expect(await post(base,'/maintenance/status',{request_nonce:randomUUID()})).toEqual({status:503,body:{error:'phone_hub_unconfigured'}});
  });
 }
});
it('真实HTTP Bearer认证与nonce HMAC回签绑定受信hub身份',async()=>{
 await fixture(configured(),async base=>{
  const nonce=randomUUID();expect((await post(base,'/phones/capabilities',{request_nonce:nonce,machine_id:'fixture-machine'},'wrong')).status).toBe(401);
  const result=await post(base,'/phones/capabilities',{request_nonce:nonce,machine_id:'fixture-machine'});
  expect(result.status).toBe(200);expect(result.body.receipt).toMatchObject({request_nonce:nonce,hub_id:'fixture-hub',machine_id:'fixture-machine',execution:false});
  expect(result.body.signature).toBe(createHmac('sha256',token).update(JSON.stringify(result.body.receipt)).digest('hex'));
  expect((await post(base,'/phones/capabilities',{request_nonce:nonce,machine_id:'fixture-machine'})).status).toBe(409);
 });
});
it('caller不能设置URL/SSH参数/command，畸形nonce和多余键拒绝且不调用probe',async()=>{
 let calls=0;await fixture({...configured(),capabilities:async()=>{calls++;}},async base=>{
  for(const extra of [{url:'http://attacker'},{command:'rm'},{host:'attacker'},{port:22},{env:{HOME:'bad'}}])
   expect((await post(base,'/phones/capabilities',{request_nonce:randomUUID(),machine_id:'fixture-machine',...extra})).status).toBe(400);
  expect((await post(base,'/maintenance/status',{request_nonce:'invalid'})).status).toBe(400);
  expect(calls).toBe(0);
 });
});
it('执行路径永远503，GET能力与错误方法拒绝，不产生业务副作用',async()=>{
 await fixture(configured(),async base=>{
  for(const action of ['start','inspect','cancel'])expect(await post(base,`/phones/${randomUUID()}/${action}`,{request_nonce:randomUUID()})).toEqual({status:503,body:{error:'phone_runtime_not_connected'}});
  expect((await fetch(base+'/phones/capabilities',{headers:{authorization:`Bearer ${token}`}})).status).toBe(405);
  expect(await (await fetch(base+'/health')).json()).toMatchObject({execution:false,scope:'phone-hub'});
 });
});
it('坏JSON、超限与probe失败不泄漏原始诊断、不签unknown为空',async()=>{
 await fixture({...configured(),capabilities:async()=>{throw Error('private diagnostic /secret');}},async base=>{
  const failed=await post(base,'/phones/capabilities',{request_nonce:randomUUID(),machine_id:'fixture-machine'});
  expect(failed).toEqual({status:503,body:{error:'phone_capabilities_unconfirmed'}});
  for(const body of ['{','x'.repeat(16385)]){
   const r=await fetch(base+'/phones/capabilities',{method:'POST',headers:{authorization:`Bearer ${token}`},body});expect(r.status).toBe(400);
  }
 });
});
it('probe与不完成请求都受硬deadline约束',async()=>{
 await fixture({...configured(),timeoutMs:50,capabilities:()=>new Promise(()=>{})},async base=>{
  expect((await post(base,'/phones/capabilities',{request_nonce:randomUUID(),machine_id:'fixture-machine'})).status).toBe(503);
  const result=await new Promise((resolve,reject)=>{
   const req=http.request(base+'/phones/capabilities',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-length':'1000'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write('{');
  });expect(result).toBe(408);
 });
});
it('phone maintenance只签自己的scope；unknown失败503，不能回签pending0',async()=>{
 await fixture(configured(),async base=>{const r=await post(base,'/maintenance/status',{request_nonce:randomUUID()});expect(r.status).toBe(200);expect(r.body.receipt).toMatchObject({scope:'phone-hub',pending:1,quiescent:false});});
 await fixture({...configured(),maintenance:async()=>{throw Error('unknown');}},async base=>{expect(await post(base,'/maintenance/status',{request_nonce:randomUUID()})).toEqual({status:503,body:{error:'phone_maintenance_unconfirmed'}});});
});
