import {it,expect,vi} from 'vitest';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {createAppServerRouter} from '../app-server.js';
it('内部API没有token即停用，不接受loopback豁免或自报执行身份',async()=>{
 const env={},controller={ensure:vi.fn(async()=>({status:'running'})),inspect:vi.fn(),cancel:vi.fn()};
 const app=express();app.use(express.json());app.use(createAppServerRouter({env,controller}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const root=`http://127.0.0.1:${server.address().port}`;
 const post=(url,body={},token)=>fetch(root+url,{method:'POST',headers:{'content-type':'application/json',...(token?{'x-cecelia-token':token}:{})},body:JSON.stringify(body)});
 try{
  expect((await post('/generations')).status).toBe(503);env.CECELIA_INTERNAL_TOKEN='a'.repeat(32);
  expect((await post('/generations')).status).toBe(401);expect(controller.ensure).not.toHaveBeenCalled();
  expect((await post('/generations',{home_id:'chat-a',request_key:randomUUID()},env.CECELIA_INTERNAL_TOKEN)).status).toBe(200);
  expect((await post(`/generations/${randomUUID()}/cancel`,{worker_id:'fake'},env.CECELIA_INTERNAL_TOKEN)).status).toBe(409);expect(controller.cancel).not.toHaveBeenCalled();
 }finally{await new Promise(r=>server.close(r));}
});
it('验收入口沿用内部鉴权且仅返回脱敏状态；撤销不接收附加指令',async()=>{
 const env={CECELIA_INTERNAL_TOKEN:'b'.repeat(32)},id=randomUUID(),calls=[];
 const authorizationStore={async prepare(input){calls.push(input);return {id,state:'prepared',nonce:'must-not-be-returned',home:{homeKey:'private'},grant_id:randomUUID()};},async revoke(){return {id,state:'revoked'};}};
 const app=express();app.use(express.json());app.use(createAppServerRouter({env,controller:{},authorizationStore}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const post=(url,body,token)=>fetch(`http://127.0.0.1:${server.address().port}`+url,{method:'POST',headers:{'content-type':'application/json',...(token?{'x-cecelia-token':token}:{})},body:JSON.stringify(body)});
 try{
  expect((await post('/authorizations/prepare',{})).status).toBe(401);expect(calls).toHaveLength(0);
  const response=await post('/authorizations/prepare',{home_id:'chat-test'},env.CECELIA_INTERNAL_TOKEN);expect(response.status).toBe(200);
  expect(await response.json()).toEqual({id,state:'prepared'});
  expect((await post(`/authorizations/${id}/revoke`,{command:'arbitrary'},env.CECELIA_INTERNAL_TOKEN)).status).toBe(409);
  expect((await post(`/authorizations/${id}/revoke`,{},env.CECELIA_INTERNAL_TOKEN)).status).toBe(200);
 }finally{await new Promise(r=>server.close(r));}
});
it('内部推进只接收授权ID且不给客户端流票或任意协议输入',async()=>{
 const env={CECELIA_INTERNAL_TOKEN:'b'.repeat(32)},id=randomUUID(),advance=vi.fn(async()=>({id,state:'active',token:'private-ticket'}));
 const app=express();app.use(express.json());app.use(createAppServerRouter({env,controller:{},authorizationStore:{},canaryService:{advance}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const post=body=>fetch(`http://127.0.0.1:${server.address().port}/authorizations/${id}/advance`,{method:'POST',headers:{'content-type':'application/json','x-cecelia-token':env.CECELIA_INTERNAL_TOKEN},body:JSON.stringify(body)});
 try{
  expect((await post({method:'turn/start'})).status).toBe(409);expect(advance).not.toHaveBeenCalled();
  expect(await (await post({})).json()).toEqual({id,state:'active'});expect(advance).toHaveBeenCalledWith(id);
 }finally{await new Promise(r=>server.close(r));}
});
