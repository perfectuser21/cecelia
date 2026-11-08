import {test,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
const {createFleetWorkerRuntime}=createRequire(import.meta.url)('./fleet-worker.cjs');
test('workflow-only runtime uses fixed workflow profiles without Docker/harness credentials or fabricated image digest',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-only-'));let runtime;
 try{
  const entry=path.join(root,'activity.mjs');fs.writeFileSync(entry,'export const fixed=true;');
  const profile={cwd:root,files:{'activity.mjs':createHash('sha256').update(fs.readFileSync(entry)).digest('hex')},cleanup_required:false,resources:[],contract:{workflow:'fixed',activities:[{key:'work',order:1,budget:{max_duration_s:5,heartbeat_s:1},runtime:{entry:'activity.mjs',phase:'source'}}]},metadata:{work:{activity_id:randomUUID(),executor_kind:'code'}}};
  const profiles=path.join(root,'profiles.json'),token=path.join(root,'token');fs.writeFileSync(profiles,JSON.stringify({schema_version:1,profiles:{fixed:profile}}),{mode:0o600});fs.writeFileSync(token,'a'.repeat(40),{mode:0o600});
  const env={CECELIA_MACHINE_ID:'us-mac-m4',CECELIA_FLEET_WORKER_SURFACE:'workflow',CECELIA_FLEET_DATA_ROOT:root,CECELIA_FLEET_WORKER_TOKEN_FILE:token,CECELIA_WORKFLOW_PROFILES_FILE:profiles,CECELIA_DRAIN_MARKER:path.join(root,'drain')};
  runtime=createFleetWorkerRuntime({env,runCommand:()=>{throw Error('unexpected_external_process');},probeCredentialHome:()=>{throw Error('unexpected_harness_credentials');}});
  expect(runtime.workflowRunner.start).toBeTypeOf('function');expect(runtime.workflowProfileCatalog('fixed')).toMatch(/^[a-f0-9]{64}$/);expect(runtime.getRuntimeConfigDigest()).toMatch(/^[a-f0-9]{64}$/);
  for(const name of ['attemptRunner','orchestratorRunner','scriptRunner','appServerRunner','baselineProbe'])expect(runtime[name]).toBeUndefined();
  expect(()=>runtime.workflowProfileCatalog('missing')).toThrow();
  fs.appendFileSync(entry,'//drift');expect(()=>runtime.workflowProfileCatalog('fixed')).toThrow('source_mismatch');
 }finally{runtime?.workflowRunner?.close();fs.rmSync(root,{recursive:true,force:true});}
});


test('protected workflow catalog retains complete multi-megabyte frozen contracts',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-catalog-'));
 const {loadWorkflowProfiles}=createRequire(import.meta.url)('./workflow-profile.cjs');
 try{
  const profiles=Object.fromEntries(['discovery','processing','scoring'].map(name=>[name,{domain_adapter:{config:{snapshot:{release:{payload:{contract:'x'.repeat(4*1024*1024)}}}}}}]));
  const file=path.join(root,'profiles.json');fs.writeFileSync(file,JSON.stringify({schema_version:1,profiles}),{mode:0o600});
  expect(loadWorkflowProfiles(file)).toEqual(profiles);
  fs.chmodSync(file,0o644);expect(()=>loadWorkflowProfiles(file)).toThrow('workflow_profiles_unprotected');
  fs.chmodSync(file,0o600);const link=path.join(root,'linked.json');fs.symlinkSync(file,link);expect(()=>loadWorkflowProfiles(link)).toThrow();
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('workflow catalog rejects more than 16 MiB before parsing its content',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-catalog-limit-'));
 const {loadWorkflowProfiles}=createRequire(import.meta.url)('./workflow-profile.cjs');
 try{
  const file=path.join(root,'profiles.json');fs.writeFileSync(file,'{not-json',{mode:0o600});fs.truncateSync(file,16*1024*1024+1);
  expect(()=>loadWorkflowProfiles(file)).toThrow('workflow_profiles_unprotected');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});


test('workflow catalog accepts exact bound and rejects growth after stat',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'workflow-catalog-race-'));
 const {loadWorkflowProfiles}=createRequire(import.meta.url)('./workflow-profile.cjs');let stat;
 try{
  const file=path.join(root,'profiles.json'),body=JSON.stringify({schema_version:1,profiles:{}});
  fs.writeFileSync(file,body+' '.repeat(16*1024*1024-Buffer.byteLength(body)),{mode:0o600});
  expect(loadWorkflowProfiles(file)).toEqual({});
  fs.writeFileSync(file,body);const actual=fs.fstatSync;
  stat=vi.spyOn(fs,'fstatSync').mockImplementation(fd=>{const value=actual(fd);value.size-=1;return value;});
  expect(()=>loadWorkflowProfiles(file)).toThrow('workflow_profiles_unprotected');
 }finally{stat?.mockRestore();fs.rmSync(root,{recursive:true,force:true});}
});
