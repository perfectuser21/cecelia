import {test,expect} from 'vitest';
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
