import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import fixtureModule from '../../scripts/fleet-worker/linux-script-test-fixture.cjs';
import runtimeModule from '../../scripts/fleet-worker/linux-script-runtime.cjs';
import bridgeModule from '../../scripts/fleet-worker/linux-script-bridge.cjs';
import serverModule from '../../scripts/fleet-worker/linux-pool-server.cjs';
import profileModule from '../../scripts/fleet-worker/linux-pool-profile.cjs';
import permitModule from '../../scripts/fleet-worker/linux-script-permit.cjs';
import {createLinuxScriptAuthorization} from '../linux-pool/script-authority.js';
import {createScriptWorkerClient} from '../script-worker-client.js';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
it('真实Brain客户端→HTTP Worker→Unix root桥→持久runner→受限Docker完整回执链',async()=>{
 const f=fixtureModule.fixture(),root=fs.mkdtempSync(path.join(os.tmpdir(),'ls-chain-')),socketPath=path.join(root,'bridge.sock');
 const rootKey='a'.repeat(64),workerToken='b'.repeat(64),i=f.record.identity,pool=f.record.pool,profile=f.record.profile;
 const expected={machine_registry_id:pool.machine_registry_id,pool_config_digest:profileModule.validateLinuxPoolProfile(pool).config_digest,revision:'c'.repeat(40),
  host_boot_id:randomUUID(),worker_boot_id:i.worker_boot_id,daemon_id:f.record.daemon_id};
 const credential=(file,key)=>({file,binding:digest({file,token_digest:digest(key)})});
 const node={id:i.execution_version_id,machine_registry_id:pool.machine_registry_id,canonical_id:pool.machine_id,worker_id:i.worker_id,
  worker_boot_id:i.worker_boot_id,platform:'linux',state:'active',profile:{execution:true,linux_script:{schema_version:'linux-script-authority/v1',expected,
   profiles:{safe:digest(profile)},worker_credential:credential('/etc/worker.token',workerToken),execution_credential:credential('/etc/root.key',rootKey)}}};
 const grant={id:i.execution_grant_id,node_version_id:node.id,surface:'managed_script',provider:'script',profile_id:'safe',state:'active'};
 const reservation={...i,id:i.reservation_id,owner_kind:'script',status:'launching'};
 const runtime=runtimeModule.createLinuxScriptRuntime({stateRoot:path.join(root,'state'),pathRoot:root,ownerUid:process.getuid(),platform:'linux',getuid:()=>0,key:rootKey,
  deployment:{pool,...expected,execution_enabled:true,profiles:{safe:{profile,image_id:f.record.image_id,execution_version_id:node.id,execution_grant_id:grant.id}}},
  assertCanLaunch:async()=>{},run:f.options.run});
 const bridge=bridgeModule.createLinuxScriptBridge({key:rootKey,runtime});await new Promise(r=>bridge.listen(socketPath,r));
 const worker=serverModule.createLinuxPoolServer({profile:pool,token:workerToken,revision:expected.revision,
  scriptBridge:bridgeModule.createLinuxScriptBridgeClient({socketPath}),readWorkerBootId:()=>i.worker_boot_id});
 await new Promise(r=>worker.listen(0,'127.0.0.1',r));const endpoint='http://127.0.0.1:'+worker.address().port;
 const client=createScriptWorkerClient({authorizeRequest:async(_m,_a,_b,operation)=>operation(endpoint,{node,grant,reservation}),
  linuxAuthorization:createLinuxScriptAuthorization({readProtected:file=>file==='/etc/root.key'?rootKey:workerToken})});
 const body={...i,job:{profile:'safe',cmd:f.input.command,timeout_sec:30,env:f.input.env}};
 try{
  expect((await client.capabilities(pool.machine_id)).profiles.safe).toBe(digest(profile));
  const started=await client.start(pool.machine_id,body);expect(started).toMatchObject({authenticated:true,receipt:{status:'running',container_id:'a'.repeat(64),execution_grant_id:grant.id}});
  f.container.State.Status='exited';const inspected=await client.inspect(pool.machine_id,i);expect(inspected.receipt.terminal).toMatchObject({exit_code:0,stdout:'ok'});
  const cleaned=await client.cancel(pool.machine_id,{...i,container_id:started.receipt.container_id,challenge:randomUUID()});expect(cleaned.receipt).toMatchObject({absent:true,tombstoned:true});
  expect(f.calls.filter(a=>a[0]==='rm')).toEqual([['rm','--force',started.receipt.container_id]]);
  const forged={...body,request_nonce:randomUUID()};forged.permit=permitModule.signLinuxScriptPermit({key:workerToken,expected:{...expected,execution_version_id:node.id,execution_grant_id:grant.id,profile_digest:digest(profile)},action:'start',body:forged});
  const denied=await fetch(endpoint+'/scripts/'+i.reservation_id+'/start',{method:'POST',headers:{Authorization:'Bearer '+workerToken},body:JSON.stringify(forged)});
  expect(denied.status).toBe(409);expect(f.calls.filter(a=>a[0]==='create')).toHaveLength(1);
 }finally{runtime.close();await new Promise(r=>{worker.close(r);worker.closeAllConnections();});await new Promise(r=>{bridge.close(r);bridge.closeAllConnections();});fs.rmSync(root,{recursive:true,force:true});}
});
