// F1步骤3：真实worker health副作用 → HMAC静默证据 → 维护独占闸。
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {it,expect} from 'vitest';
import {createBaselineEvidenceClient} from '../../../packages/brain/src/execution-directory/baseline-evidence.js';
const require=createRequire(import.meta.url);
const {createFleetWorkerServer}=require('../../../packages/brain/scripts/fleet-worker/fleet-worker.cjs');
const {createLocalLaunchAdmission}=require('../../../packages/brain/scripts/fleet-worker/local-resource-admission.cjs');
const {restoreCanonicalRunner}=require('../../../packages/brain/scripts/fleet-worker/canonical-runner-install.cjs');
const {createDrainOwner}=require('../../../packages/brain/scripts/fleet-worker/drain-owner.cjs');
it('实际HTTP health未结束拒受签静默，维护lease拒health新副作用，结束后才能验证静默',async()=>{
 const gate=createLocalLaunchAdmission({lstat:()=>({})}),token='gp-maintenance-evidence-token-'.repeat(3),configDigest='c'.repeat(64);let release,started,calls=0;
 const held=new Promise(r=>release=r),entered=new Promise(r=>started=r);
 const server=createFleetWorkerServer({machineId:'xian-mac-m4',attemptToken:token,launchAdmission:gate,runtimeConfigDigest:configDigest,healthCacheTtlMs:0,probeHealth:async()=>{calls++;started();await held;return {};},attemptRunner:{prepare(){},start(){},inspect(){},cancel(){},terminal(){},async reconcile(){},maintenance:()=>({pending:0})},scriptRunner:{maintenance:()=>({pending:0})},orchestratorRunner:{maintenance:()=>({preparing:0,prepared:0,running_processes:0})}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,node={canonical_id:'xian-mac-m4',endpoints:{worker:origin}},client=createBaselineEvidenceClient({token});let health;
 try{
  health=fetch(`${origin}/health`);await entered;expect(gate.snapshot().in_flight_launches).toBe(1);await expect(client.maintenance(node)).rejects.toThrow('execution_baseline_worker_unconfirmed');
  release();expect((await health).status).toBe(200);const receipt=await client.maintenance(node);expect(receipt).toMatchObject({quiescent:true,draining:true,boot_id:gate.snapshot().boot_id,config_digest:configDigest,in_flight_launches:0});
  await gate.withMaintenance(async()=>{expect((await fetch(`${origin}/health`)).status).toBe(503);});expect(calls).toBe(1);
  expect((await client.maintenance(node)).activity_revision).toBe(receipt.activity_revision+2);
  const response=await fetch(`${origin}/maintenance/status`,{method:'POST',headers:{authorization:'Bearer wrong-token'},body:JSON.stringify({request_nonce:randomUUID()})});expect(response.status).toBe(401);
 }finally{release();if(health)await health.catch(()=>{});server.closeAllConnections();await new Promise(r=>server.close(r));}
});
it('F1维护接力持真实owner/FD保护配置：canonical切换仅改runner，旧CAS和错marker不能跨边写入',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gp-canonical-owner-'));
 const marker=path.join(root,'fleet-worker.drain'),owner=randomUUID(),machine='xian-mac-m4';
 const plist=path.join(root,'worker.plist'),saved=path.join(root,'snapshot.json'),runtime='/usr/local/libexec/cecelia/fleet-worker';
 const helper=new URL('../../../packages/brain/scripts/fleet-worker/install-existing-config.py',import.meta.url).pathname;
 const utility=createDrainOwner({marker,runLaunchctl:()=>{}});let children=0;
 const original={Label:'com.perfect21.fleet-worker',UserName:'_cecelia',ProgramArguments:[process.execPath,`${runtime}/fleet-worker.cjs`],EnvironmentVariables:{CECELIA_MACHINE_ID:machine,CECELIA_RUNNER_DIGEST:`sha256:${'0'.repeat(64)}`,CUSTOM_SETTING:'preserved'},KeepAlive:true};
 const write=value=>{execFileSync('python3',['-c','import plistlib,json,sys;plistlib.dump(json.load(sys.stdin),open(sys.argv[1],"wb"),fmt=plistlib.FMT_BINARY)',plist],{input:JSON.stringify(value)});fs.chmodSync(plist,0o600);};
 const digest=()=>createHash('sha256').update(fs.readFileSync(plist)).digest('hex');
 const run=(command,args,options)=>{
  children++;expect(command).toBe('/bin/bash');expect(args.slice(1,4)).toEqual([machine,'--apply','--restore-canonical-runner']);
  expect(()=>utility.undrain(machine,owner)).toThrow('drain_owner_busy');
  // 仅替代安装的外部启动边：保护闸、真实FD、快照、raw CAS与合并使用真模块/子进程。
  return spawnSync('/bin/bash',['-c','python3 "$1" canonical-install-guard "$2" && python3 "$1" snapshot "$3" "$2" "$4" "$5" >/dev/null && python3 "$1" canonical-runner "$5" "$6" >/dev/null && python3 "$1" merge "$3" "$5"','gp-protected-cutover',helper,machine,plist,runtime,saved,args[4]],{
   ...options,env:{...options.env,NODE_ENV:'test',FLEET_NODECTL_DRAIN_MARKER:marker},stdio:['ignore','pipe','pipe',...options.stdio.slice(3)],
  });
 };
 try{
  write(original);utility.drain(machine,owner);const bytes=fs.readFileSync(plist),markerBytes=fs.readFileSync(marker),expected=digest();
  expect(()=>restoreCanonicalRunner(machine,expected,randomUUID(),{marker,run})).toThrow('drain_owner_mismatch');expect(children).toBe(0);
  expect(restoreCanonicalRunner(machine,expected,owner,{marker,run})).toEqual({installed:true});
  const actual=JSON.parse(execFileSync('python3',['-c','import json,plistlib,sys;print(json.dumps(plistlib.load(open(sys.argv[1],"rb"))))',plist],{encoding:'utf8'}));
  expect(actual).toEqual({...original,EnvironmentVariables:{...original.EnvironmentVariables,CECELIA_RUNNER_DIGEST:'sha256:aeaf290525a623a2182fdce5376ca914e9de2d0b1bab0ba18d7d07b9ea379033'}});
  const installedBytes=fs.readFileSync(plist);expect(installedBytes).not.toEqual(bytes);
  expect(()=>restoreCanonicalRunner(machine,expected,owner,{marker,run})).toThrow('canonical_runner_install_failed');expect(fs.readFileSync(plist)).toEqual(installedBytes);
  write({...original,EnvironmentVariables:{...original.EnvironmentVariables,CECELIA_DRAIN_MARKER:'/var/run/cecelia/unrelated-worker.drain'}});const wrongBytes=fs.readFileSync(plist);
  expect(()=>restoreCanonicalRunner(machine,digest(),owner,{marker,run})).toThrow('canonical_runner_install_failed');expect(fs.readFileSync(plist)).toEqual(wrongBytes);
  expect(fs.readFileSync(marker)).toEqual(markerBytes);expect(fs.existsSync(path.join(root,'.fleet-worker.drain.lock'))).toBe(false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
