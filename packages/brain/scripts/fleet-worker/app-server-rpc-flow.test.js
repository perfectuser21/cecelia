import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {createAppServerClient} from '../../src/app-server/client.js';
import {createAppServerRouter} from '../../src/routes/app-server.js';
const require=createRequire(import.meta.url),{runShim}=require('./app-server-shim.cjs'),{createFleetWorkerServer}=require('./fleet-worker.cjs');
it('真实Brain控制HTTP→shim→Worker直连双向RPC；账号token不经过Brain，显式取消只关闭数据流',async()=>{
 const internal='internal-test-'.repeat(4),controlToken='worker-test-'.repeat(4),rpcToken='ephemeral-model-token',streamId=randomUUID();let marked=0,killed=0;
 const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),rpcAccountId:'bound-account',kill(){killed++;this.emit('close');}});
 const worker=createFleetWorkerServer({attemptToken:controlToken,appServerRunner:{async attach(){return child;},async markRpcStarted(){marked++;}}});await new Promise(r=>worker.listen(0,'127.0.0.1',r));
 const endpoint=`http://127.0.0.1:${worker.address().port}`;
 const row={id:randomUUID(),intent_id:randomUUID(),launch_generation:1,machine_id:'xian-mac-m1',worker_id:'xian-mac-m1',worker_boot_id:randomUUID(),owner_key:'openclaw-'+ 'a'.repeat(64),home_key:'b'.repeat(64),config_digest:'c'.repeat(64),config:{profile:'chat'},stream:{id:streamId,prepare_deadline:new Date(Date.now()+5000)}};
 const client=createAppServerClient({store:{async reserveStream(){return row.stream;},async withOperation(id,action,fn){expect(id).toBe(row.id);expect(action).toBe('prepare-stream');return fn(row,endpoint);}},env:{KERNEL_FLEET_BRIDGE_TOKEN:controlToken}});
 const audited=[];const app=express();app.use(express.json());app.use((req,_res,next)=>{audited.push(req.body);next();});
 app.use('/api/brain/internal/app-server',createAppServerRouter({env:{CECELIA_INTERNAL_TOKEN:internal},controller:{async ensure(input){expect(Object.keys(input).sort()).toEqual(['home_id','request_key']);return {reservation_id:row.id,status:'running'};},prepareStream:id=>client.prepareStream(id)}}));
 const brain=app.listen(0,'127.0.0.1');await new Promise(r=>brain.once('listening',r));
 const input=new PassThrough(),output=new PassThrough();let received='';output.on('data',x=>received+=x);output.on('error',()=>{});
 child.stdin.on('data',chunk=>{const f=JSON.parse(chunk);expect(f.params.accessToken).toBe(rpcToken);child.stdout.write(JSON.stringify({id:f.id,result:{type:'chatgptAuthTokens'}})+'\n');});
 let failure;
 const finished=runShim({brainUrl:`http://127.0.0.1:${brain.address().port}`,internalToken:internal,homeId:'chat-test',requestKey:randomUUID()},input,output).catch(e=>failure=e);
 try{
  input.write(JSON.stringify({id:1,method:'account/login/start',params:{type:'chatgptAuthTokens',accessToken:rpcToken,chatgptAccountId:'bound-account'}})+'\n');
  for(let i=0;i<100&&!received;i++)await new Promise(r=>setTimeout(r,10));
  expect(JSON.parse(received).id).toBe(1);expect(marked).toBe(1);expect(JSON.stringify(audited)).not.toContain(rpcToken);expect(audited).toHaveLength(2);
  child.kill();await finished;expect(killed).toBeGreaterThan(0);expect(failure?.message).toBe('appserver_stream_unconfirmed');
 }finally{input.destroy();output.destroy();worker.closeAllConnections();brain.closeAllConnections();await Promise.all([new Promise(r=>worker.close(r)),new Promise(r=>brain.close(r))]);}
});
