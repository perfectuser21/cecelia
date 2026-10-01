import {it,expect} from 'vitest';
import http from 'node:http';
import {createRequire} from 'node:module';
import {randomUUID,createHmac} from 'node:crypto';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const require=createRequire(import.meta.url),{createFleetWorkerServer}=require('./fleet-worker.cjs'),{createLocalLaunchAdmission,wrapLaunchRunner}=require('./local-resource-admission.cjs');
it('真实maintenance HTTP认证nonce回签：在途异步与prepared账阻止假静默，清理后同boot稳定',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'drain-status-')),marker=path.join(root,'drain'),token='maintenance-secret-'.repeat(3),gate=createLocalLaunchAdmission({markerPath:marker});
 let release;const held=new Promise(r=>release=r);let pending=0;
 const attempt=wrapLaunchRunner({async prepare(){await held;pending=1;},async start(){},async inspect(){},async cancel(){pending=0;},async terminal(){},async reconcile(){},async maintenance(){return {pending};}},gate);
 const server=createFleetWorkerServer({attemptToken:token,machineId:'us-mac-m4',launchAdmission:gate,attemptRunner:attempt,scriptRunner:{maintenance:()=>({pending:0})},orchestratorRunner:{maintenance:()=>({preparing:0,prepared:0,running_processes:0})}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/maintenance/status`;
 const call=async(auth=token)=>{const request_nonce=randomUUID();const response=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${auth}`,'content-type':'application/json'},body:JSON.stringify({request_nonce})});return {response,request_nonce,value:await response.json()};};
 try{
  expect((await call('wrong')).response.status).toBe(401);const work=attempt.prepare();fs.writeFileSync(marker,'maintenance');
  const a=await call();expect(a.response.status).toBe(200);expect(a.value.receipt).toMatchObject({request_nonce:a.request_nonce,draining:true,in_flight_launches:1,quiescent:false});expect(a.value.signature).toBe(createHmac('sha256',token).update(JSON.stringify(a.value.receipt)).digest('hex'));
  release();await work;const b=await call();expect(b.value.receipt.in_flight_launches).toBe(0);expect(b.value.receipt.attempts.pending).toBe(1);expect(b.value.receipt.quiescent).toBe(false);
  await attempt.cancel();const c=await call();expect(c.value.receipt.quiescent).toBe(true);expect(c.value.receipt.boot_id).toBe(a.value.receipt.boot_id);
 }finally{release();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
});

it('真实HTTP prepare客户端断开仍计数，late drain阻止副作用直到异步结束',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'drain-abort-')),marker=path.join(root,'drain'),token='maintenance-token-'.repeat(3),gate=createLocalLaunchAdmission({markerPath:marker});
 let release,entered,finished;const held=new Promise(r=>release=r),started=new Promise(r=>entered=r),done=new Promise(r=>finished=r);let launches=0;
 const attempt=wrapLaunchRunner({async prepare(){entered();try{await held;gate.assertCanLaunch();launches++;}finally{finished();}},async start(){},async inspect(){},async cancel(){},async terminal(){},async reconcile(){},maintenance:()=>({pending:0})},gate);
 const server=createFleetWorkerServer({attemptToken:token,machineId:'us-mac-m4',launchAdmission:gate,attemptRunner:attempt,scriptRunner:{maintenance:()=>({pending:0})},orchestratorRunner:{maintenance:()=>({preparing:0,prepared:0,running_processes:0})}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const status=async()=>{const response=await fetch(base+'/maintenance/status',{method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.stringify({request_nonce:randomUUID()})});return (await response.json()).receipt;};
 try{
  const req=http.request(base+'/harness/attempts/prepare',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'}});req.on('error',()=>{});req.end('{}');await started;
  req.destroy();fs.writeFileSync(marker,'maintenance');expect(await status()).toMatchObject({in_flight_launches:1,quiescent:false});
  release();await done;expect(await status()).toMatchObject({in_flight_launches:0,quiescent:true});expect(launches).toBe(0);
 }finally{release();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
});
it('默认runtime共享真实marker，orchestrator新prepare拒绝且不执行命令，维护查询可用',async()=>{
 const {createFleetWorkerRuntime}=require('./fleet-worker.cjs');const root=fs.mkdtempSync(path.join(os.tmpdir(),'drain-runtime-')),marker=path.join(root,'drain'),tokenFile=path.join(root,'token');let commands=0;
 fs.writeFileSync(tokenFile,'protected-worker-token-at-least-32-bytes',{mode:0o600});fs.writeFileSync(marker,'maintenance');
 try{
  const runtime=createFleetWorkerRuntime({env:{CECELIA_MACHINE_ID:'us-mac-m4',CECELIA_RUNNER_DIGEST:`sha256:${'a'.repeat(64)}`,CECELIA_FLEET_WORKER_TOKEN_FILE:tokenFile,CECELIA_FLEET_DATA_ROOT:path.join(root,'data'),CECELIA_DRAIN_MARKER:marker},runCommand:async()=>{commands++;throw Error('unexpected command');},probeCredentialHomeFn:()=>{}});
  expect(runtime.launchAdmission.snapshot().draining).toBe(true);
  expect(runtime.appServerRunner.capabilities().worker_boot_id).toBe(runtime.launchAdmission.snapshot().boot_id);
  await expect(runtime.appServerRunner.start({})).rejects.toThrow('worker_draining');
  expect(await runtime.appServerRunner.maintenance()).toEqual({pending:0});
  await expect(runtime.orchestratorRunner.prepare({run_id:randomUUID(),task_id:randomUUID(),repo:'perfectuser21/cecelia'})).rejects.toThrow('worker_draining');
  expect(commands).toBe(0);expect(runtime.launchAdmission.snapshot().in_flight_launches).toBe(0);
  expect(await runtime.attemptRunner.maintenance()).toEqual({pending:0});expect(await runtime.scriptRunner.maintenance()).toEqual({pending:0});expect(await runtime.orchestratorRunner.maintenance()).toEqual({preparing:0,prepared:0,running_processes:0});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
it.each(['pending','failed'])('启动reconcile处于%s时绝不签发静默回执',async(mode)=>{
 const token='protected-maintenance-token-'.repeat(3),gate=createLocalLaunchAdmission({lstat:()=>({})});let release,entered;
 const held=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const attempt={prepare:async()=>{},start:async()=>{},inspect:async()=>{},cancel:async()=>{},terminal:async()=>{},reconcile:async()=>{entered();if(mode==='failed')throw Error('docker_unavailable');await held;},maintenance:()=>({pending:0})};
 const server=createFleetWorkerServer({attemptToken:token,launchAdmission:gate,attemptRunner:attempt,scriptRunner:{maintenance:()=>({pending:0})},orchestratorRunner:{maintenance:()=>({preparing:0,prepared:0,running_processes:0})}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));await started;
 try{
  const response=await fetch(`http://127.0.0.1:${server.address().port}/maintenance/status`,{method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.stringify({request_nonce:randomUUID()})});
  expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'worker_maintenance_unconfirmed'});
 }finally{release();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
it('真实maintenance回执包含聊天未清理实例，不能因旧三类为空就签静默',async()=>{
 const token='chat-maintenance-token-'.repeat(3),gate=createLocalLaunchAdmission({lstat:()=>({})});let pending=1;
 const attempt={prepare:async()=>{},start:async()=>{},inspect:async()=>{},cancel:async()=>{},terminal:async()=>{},reconcile:async()=>{},maintenance:()=>({pending:0})};
 const server=createFleetWorkerServer({attemptToken:token,launchAdmission:gate,attemptRunner:attempt,scriptRunner:{maintenance:()=>({pending:0})},orchestratorRunner:{maintenance:()=>({preparing:0,prepared:0,running_processes:0})},appServerRunner:{maintenance:()=>({pending})}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const status=async()=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/maintenance/status`,{method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.stringify({request_nonce:randomUUID()})});return (await response.json()).receipt;};
 try{expect(await status()).toMatchObject({app_servers:{pending:1},quiescent:false});pending=0;expect(await status()).toMatchObject({app_servers:{pending:0},quiescent:true});}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
