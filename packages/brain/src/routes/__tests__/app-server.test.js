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
