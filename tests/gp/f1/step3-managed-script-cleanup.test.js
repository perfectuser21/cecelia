import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import workerModule from '../../../packages/brain/scripts/fleet-worker/fleet-worker.cjs';
import runnerModule from '../../../packages/brain/scripts/fleet-worker/script-runner.cjs';
import {createScriptWorkerClient} from '../../../packages/brain/src/script-worker-client.js';
let root,server,runner;
afterEach(async()=>{runner?.close();if(server)await new Promise(r=>server.close(r));if(root)rmSync(root,{recursive:true,force:true});});
it('F1造完真验：已确认清理的脚本意图，认证协议拒绝任何迟到启动',async()=>{
  root=mkdtempSync(path.join(tmpdir(),'gp-managed-script-'));
  const machine='us-mac-m4',token='gp-script-worker-token-'.repeat(3);
  const profile={image:`alpine@sha256:${'b'.repeat(64)}`,cpus:1,memoryBytes:67108864,pidsLimit:16,logMaxSizeBytes:1048576,logMaxFiles:2,user:'1000:1000',cwd:'/job'};
  const job={profile:'safe',cmd:'printf harmless',timeout_sec:30,env:{}};
  const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
  let creates=0;
  runner=runnerModule.createScriptRunner({stateRoot:root,machineId:machine,workerId:machine,bootId:'gp-boot',
    profiles:{safe:profile},assertLocalResources:async()=>{},docker:{inspect:async()=>null,create:async()=>{creates++;throw new Error('late launch');}}});
  server=workerModule.createFleetWorkerServer({machineId:machine,attemptToken:token,scriptRunner:runner});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  // 本例验证真实认证协议与取消墓碑；目录授权由真实PG integration独立验证。
  const endpoint=`http://127.0.0.1:${server.address().port}`;
  const actions=[];
  const client=createScriptWorkerClient({token,authorizeRequest:async(target,action,body,operation)=>{
    expect(target).toBe(machine);actions.push(action);return operation(endpoint);
  }});
  const request={reservation_id:randomUUID(),intent_id:randomUUID(),machine_id:machine,owner_key:`script-${randomUUID()}-a1`,
    launch_generation:1,worker_id:machine,worker_boot_id:'gp-boot',config_digest:digest({job,profile_digest:digest(profile)})};
  const clean=await client.cancel(machine,{...request,container_id:null,challenge:randomUUID()});
  expect(clean).toMatchObject({authenticated:true,receipt:{status:'cleaned',tombstoned:true,absent:true}});
  await expect(client.start(machine,{...request,job})).rejects.toThrow('http_409');
  expect(creates).toBe(0);
  expect(actions).toEqual(['cancel','start']);
});
