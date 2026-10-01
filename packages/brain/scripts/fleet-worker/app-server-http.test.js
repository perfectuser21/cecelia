import {it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHmac} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createFleetWorkerServer}=require('./fleet-worker.cjs');
const {createAppServerRunner}=require('./app-server-runner.cjs');
const {profileDigest,generationOwner}=require('./app-server-profile.cjs');
const token='appserver-http-integration-secret-32-characters';
it('真实Worker HTTP拒未认证/额外权限字段，并回签start-inspect-cancel精确身份',async()=>{
 const stateRoot=fs.mkdtempSync(path.join(os.tmpdir(),'appserver-http-'));
 const profile={image:`sha256:${'a'.repeat(64)}`,cpus:1,memoryBytes:1024**3,pidsLimit:128,user:'1000:1000',tmpBytes:1024**2,network:'none',homeKey:'b'.repeat(64),workspaceKey:'c'.repeat(64)};
 const bootId=randomUUID(),containers=new Map();let created=0;
 const docker={async create({name,identity}){created++;const id='d'.repeat(64);containers.set(id,{id,name,status:'created',labels:Object.fromEntries(Object.entries(identity).map(([k,v])=>[`cecelia.appserver.${k}`,String(v)]))});return id;},async inspect(id){return containers.get(id)??null;},async start(id){containers.get(id).status='running';},async remove(id){containers.delete(id);}};
 const runner=createAppServerRunner({stateRoot,machineId:'xian-mac-m1',workerId:'xian-mac-m1',bootId,profiles:{chat:profile},docker,assertLocalResources:async()=>{}});
 const server=createFleetWorkerServer({attemptToken:token,appServerRunner:runner});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const root=`http://127.0.0.1:${server.address().port}`;
 const identity={reservation_id:randomUUID(),intent_id:randomUUID(),launch_generation:1,machine_id:'xian-mac-m1',worker_id:'xian-mac-m1',worker_boot_id:bootId,home_key:profile.homeKey,profile:'chat',config_digest:profileDigest(profile)};identity.owner_key=generationOwner(identity);
 const call=(action,body,auth=token)=>fetch(`${root}/app-servers/${identity.reservation_id}/${action}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${auth}`},body:JSON.stringify(body)});
 try{
  expect((await call('start',identity,'wrong')).status).toBe(401);expect(created).toBe(0);
  expect((await call('start',{...identity,limits:{cpus:64}})).status).toBe(409);expect(created).toBe(0);
  const nonce=randomUUID(),response=await call('start',{...identity,request_nonce:nonce});expect(response.status).toBe(200);
  const envelope=await response.json();expect(envelope.receipt).toMatchObject({...identity,request_nonce:nonce,status:'running'});
  expect(envelope.signature).toBe(createHmac('sha256',token).update(JSON.stringify(envelope.receipt)).digest('hex'));
  expect((await call('inspect',identity)).status).toBe(200);
  const cancel=await call('cancel',{...identity,container_id:envelope.receipt.container_id,challenge:randomUUID()});expect((await cancel.json()).receipt.status).toBe('cleaned');expect(containers.size).toBe(0);
 }finally{await new Promise(r=>server.close(r));fs.rmSync(stateRoot,{recursive:true,force:true});}
});
