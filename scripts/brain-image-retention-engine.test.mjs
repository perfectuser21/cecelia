import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from './brain-image-retention/storage.mjs';
import { createRetentionEngine } from './brain-image-retention/engine.mjs';
import { US_MACHINE_ID } from './brain-image-retention/policy.mjs';
const image=n=>'sha256:'+String(n).repeat(64),GiB=2**30;
async function setup(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'image-engine-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=createStore(root),now=Date.now(),state={ids:[1,2,3,4,5],removed:[],unknown:false,available:10*GiB};
 await store.withLock(lease=>store.save('ledger.json',{schema_version:1,generation:1,pending:null,successes:[1,2,3].map(n=>({deployment_id:randomUUID(),image_id:image(n),version:`1.0.${n}`,git_sha:'a'.repeat(40),confirmed_at:new Date(now-n*1000).toISOString()}))},lease));
 const docker={snapshot:async()=>({machine_registry_id:US_MACHINE_ID,daemon_id:'daemon',docker_root_dir:'/mnt/data/docker',volume_dev:1,observed_at:new Date().toISOString(),
  images:state.ids.map(n=>({id:image(n),tags:[`cecelia-brain:1.0.${n}`],digests:[],created_at:new Date(now-2*86400000).toISOString()})),
  containers:[{id:'a'.repeat(64),image_id:image(1),name:'/cecelia-node-brain',running:true}],disk:{total_bytes:100*GiB,available_bytes:state.available}}),
  remove:async id=>{state.removed.push(id);if(!state.unknown){state.ids=state.ids.filter(n=>image(n)!==id);state.available+=6*GiB;}if(state.loseResponse)throw Error('lost response');}};
 const engine=createRetentionEngine({store,docker});return {store,engine,state,run:randomUUID(),request:(plan,index=0)=>({run_id:plan.run_id,image_id:plan.images[index].id,intent_id:randomUUID(),task_id:randomUUID()})};
}
test('同run持久最多两项，精确删除/真实容量证明/同intent恢复不重删',async t=>{
 const x=await setup(t),plan=await x.engine.plan(x.run);assert.equal(plan.images.length,2);const a=x.request(plan);
 const receipt=await x.engine.execute(a);assert.equal(receipt.status,'success');assert.equal(receipt.evidence.absent,true);
 assert.equal(receipt.after.available_bytes-receipt.before.available_bytes,6*GiB);assert.deepEqual(await x.engine.execute(a),receipt);
 await x.engine.execute(x.request(plan,1));assert.equal(x.state.removed.length,2);
 assert.equal((await x.engine.finishPlan(x.run)).status,'success');
});
test('create后删除未知保留intent，重启对账只读不重发；精确缺失后才能收口',async t=>{
 const x=await setup(t),plan=await x.engine.plan(x.run),r=x.request(plan);x.state.unknown=true;
 assert.equal((await x.engine.execute(r)).status,'unconfirmed');assert.equal((await x.engine.execute(r)).status,'unconfirmed');
 assert.equal(x.state.removed.length,1);await assert.rejects(x.engine.plan(randomUUID()),/CLEANUP_RUN_PENDING/);
 assert.equal((await x.engine.finishPlan(x.run)).status,'unconfirmed');
 x.state.ids=x.state.ids.filter(n=>image(n)!==r.image_id);assert.equal((await x.engine.receipt(r.intent_id)).status,'success');
 assert.equal((await x.engine.finishPlan(x.run)).status,'success');assert.equal(x.state.removed.length,1);
});
test('删除已生效但回执丢失仍以精确缺失收口；任务/intent不可换绑',async t=>{
 const x=await setup(t),plan=await x.engine.plan(x.run),r=x.request(plan);x.state.loseResponse=true;
 assert.equal((await x.engine.execute(r)).status,'success');
 await assert.rejects(x.engine.execute({...r,task_id:randomUUID()}),/INTENT_CONFLICT/);
 await assert.rejects(x.engine.execute({...r,intent_id:randomUUID()}),/IMAGE_ALREADY_CLAIMED/);
});
test('plan后部署/水位变化最终闸拒绝，已登记任务取得明确无副作用回执',async t=>{
 const x=await setup(t),plan=await x.engine.plan(x.run),r=x.request(plan);
 await x.store.withLock(async lease=>{const ledger=await x.store.read('ledger.json');await x.store.save('ledger.json',{...ledger,generation:2,pending:{deployment_id:randomUUID()}},lease);});
 const result=await x.engine.execute(r);assert.equal(result.status,'skipped');assert.equal(result.attempted,false);assert.equal(x.state.removed.length,0);
});
