// F1步骤3：真实worker health副作用 → HMAC静默证据 → 维护独占闸。
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {createBaselineEvidenceClient} from '../../../packages/brain/src/execution-directory/baseline-evidence.js';
const require=createRequire(import.meta.url);
const {createFleetWorkerServer}=require('../../../packages/brain/scripts/fleet-worker/fleet-worker.cjs');
const {createLocalLaunchAdmission}=require('../../../packages/brain/scripts/fleet-worker/local-resource-admission.cjs');
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
