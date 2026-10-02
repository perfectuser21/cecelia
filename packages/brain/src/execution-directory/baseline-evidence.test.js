import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {createHmac,randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);
const {createFleetWorkerServer}=require('../../scripts/fleet-worker/fleet-worker.cjs');
it('服务器获取真实维护HMAC回签，缺配置摘要或非静默拒绝，不接受客户端报告',async()=>{
 const {createBaselineEvidenceClient}=await import('./baseline-evidence.js');
 const token='baseline-worker-token-'.repeat(3),boot=randomUUID();let digest='a'.repeat(64),quiescent=true;
 const gate={snapshot:()=>({boot_id:boot,draining:quiescent,in_flight_launches:0,activity_revision:1})};
 const server=createFleetWorkerServer({machineId:'xian-mac-m4',attemptToken:token,launchAdmission:gate,runtimeConfigDigest:digest,
 attemptRunner:{prepare(){},start(){},inspect(){},cancel(){},terminal(){},async reconcile(){},maintenance:()=>({pending:0})},scriptRunner:{maintenance:()=>({pending:0})},orchestratorRunner:{maintenance:()=>({preparing:0,prepared:0,running_processes:0})}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const node={canonical_id:'xian-mac-m4',endpoints:{worker:`http://127.0.0.1:${server.address().port}/`}};
 try{const client=createBaselineEvidenceClient({token});expect(await client.maintenance(node)).toMatchObject({boot_id:boot,config_digest:digest,quiescent:true});
  quiescent=false;await expect(client.maintenance(node)).rejects.toThrow('execution_baseline_worker_unconfirmed');
  await expect(createBaselineEvidenceClient({token:'wrong'.repeat(9)}).maintenance(node)).rejects.toThrow();
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
it.each(['missing-config','expired','negative-pending','wrong-nonce','bad-signature','wrong-machine'])('受签维护回执%s不能冒充准入证据',async(mode)=>{
 const {verifyMaintenance}=await import('./baseline-evidence.js'),token='baseline-proof-key-'.repeat(3),nonce=randomUUID();
 const receipt={schema_version:'fleet-maintenance/v1',machine_id:'xian-mac-m4',boot_id:randomUUID(),request_nonce:nonce,config_digest:'a'.repeat(64),observed_at:new Date().toISOString(),draining:true,observation_stable:true,quiescent:true,in_flight_launches:0,activity_revision:1,attempts:{pending:0},scripts:{pending:0},orchestrators:{preparing:0,prepared:0,running_processes:0},app_servers:{pending:0}};
 if(mode==='missing-config')delete receipt.config_digest;if(mode==='expired')receipt.observed_at='2000-01-01T00:00:00Z';if(mode==='negative-pending')receipt.scripts.pending=-1;if(mode==='wrong-nonce')receipt.request_nonce=randomUUID();if(mode==='wrong-machine')receipt.machine_id='xian-mac-m1';
 const signature=mode==='bad-signature'?'b'.repeat(64):createHmac('sha256',token).update(JSON.stringify(receipt)).digest('hex');
 expect(()=>verifyMaintenance({receipt,signature},{token,nonce,machineId:'xian-mac-m4'})).toThrow('execution_baseline_worker_unconfirmed');
});
it('专用固定基线proof严格绑定真实OS/boot/config/owned清理及工具版本，generic CANARY_OK不得激活',async()=>{
 const {verifyBaselineProof}=await import('./baseline-evidence.js'),token='baseline-proof-token-'.repeat(3),nonce=randomUUID(),boot=randomUUID(),digest='c'.repeat(64),image='sha256:aeaf290525a623a2182fdce5376ca914e9de2d0b1bab0ba18d7d07b9ea379033';
 const expected={nonce,bootId:boot,configDigest:digest,image,os:'26.6.2',versions:{node:'25.8.0',git:'2.39.5',codex:'0.147.0'},machineId:'xian-mac-m4',token,activityRevision:0};
 const receipt={schema_version:'fleet-baseline-proof/v1',activity_revision_before:0,activity_revision_after:4,machine_id:expected.machineId,request_nonce:nonce,boot_id:boot,config_digest:digest,image_digest:image,image_id:image,os_version:'26.6.2',container_id:'a'.repeat(64),observed_at:new Date().toISOString(),workspace_cleanup:{confirmed:true,absent:true},cleanup:{confirmed:true,absent:true,container_id:'a'.repeat(64)},tools:{node:'v25.8.0',git:'git version 2.39.5',codex:'codex-cli 0.147.0',workspace:true,sandbox:true}};
 const sign=r=>({receipt:r,signature:createHmac('sha256',token).update(JSON.stringify(r)).digest('hex')});
 expect(verifyBaselineProof(sign(receipt),expected)).toEqual(receipt);
 for(const bad of [{...receipt,schema_version:'harness-result/canary-v1'},{...receipt,cleanup:{confirmed:false}},{...receipt,config_digest:'d'.repeat(64)},{...receipt,image_id:'sha256:'+ 'b'.repeat(64)},{...receipt,tools:{...receipt.tools,codex:'codex-cli 0.100.0'}},{...receipt,os_version:'15.6.1'}])expect(()=>verifyBaselineProof(sign(bad),expected)).toThrow();
});
