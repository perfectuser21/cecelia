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
 const docker={absent:async id=>!state.ids.some(n=>image(n)===id),snapshot:async()=>({machine_registry_id:US_MACHINE_ID,daemon_id:'daemon',docker_root_dir:'/mnt/data/docker',volume_dev:1,observed_at:new Date().toISOString(),
  images:state.ids.map(n=>({id:image(n),tags:[`cecelia-brain:1.0.${n}`],digests:[],created_at:new Date(now-2*86400000).toISOString()})),
  containers:[{id:'a'.repeat(64),image_id:image(1),name:'/cecelia-node-brain',running:true}],disk:{total_bytes:100*GiB,available_bytes:state.available}}),
  remove:async id=>{state.removed.push(id);if(!state.unknown){state.ids=state.ids.filter(n=>image(n)!==id);state.available+=6*GiB;}if(state.loseResponse)throw Error('lost response');}};
 const engine=createRetentionEngine({store,docker});return {store,docker,engine,state,run:randomUUID(),request:(plan,index=0)=>({run_id:plan.run_id,image_id:plan.images[index].id,intent_id:randomUUID(),task_id:randomUUID()})};
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
test('关闭plan已落盘但清指针丢回执，原run重读收口并允许新run',async t=>{
 const x=await setup(t),plan=await x.engine.plan(x.run);await x.engine.execute(x.request(plan));
 const save=x.store.save;let fail=true;
 const store={...x.store,save:async(name,value,lease)=>{if(name==='ledger.json'&&value.cleanup_run_id===null&&fail){fail=false;throw Error('lost pointer update');}return save(name,value,lease);}};
 const engine=createRetentionEngine({store,docker:{snapshot:async()=>assert.fail('终态恢复不能重新采样或执行')}});
 await assert.rejects(engine.finishPlan(x.run),/lost pointer update/);
 assert.equal((await engine.finishPlan(x.run)).status,'success');
 assert.equal((await x.store.read('ledger.json')).cleanup_run_id,null);
 assert.equal(x.state.removed.length,1);
});
test('明确未执行的拒绝在claim后中断，重读应补skipped不能永久未知',async t=>{
 const x=await setup(t),plan=await x.engine.plan(x.run),r=x.request(plan);
 await x.store.withLock(async lease=>{const ledger=await x.store.read('ledger.json');await x.store.save('ledger.json',{...ledger,generation:2},lease);});
 const complete=x.store.complete;let fail=true;
 const store={...x.store,complete:async(...args)=>{if(fail){fail=false;throw Error('receipt not written');}return complete(...args);}};
 const engine=createRetentionEngine({store,docker:{snapshot:async()=>assert.fail('已拒绝不访问Docker')}});
 await assert.rejects(engine.execute(r),/receipt not written/);
 const result=await engine.receipt(r.intent_id);assert.equal(result.status,'skipped');assert.equal(result.attempted,false);
 assert.equal((await engine.finishPlan(x.run)).status,'skipped');assert.equal(x.state.removed.length,0);
});
test('每次执行前复查容器引用和资源恢复，无法沿用旧plan放行',async t=>{
 const x=await setup(t),plan=await x.engine.plan(x.run);x.state.available=25*GiB;
 assert.equal((await x.engine.execute(x.request(plan))).status,'skipped');assert.equal(x.state.removed.length,0);
});
test('精确缺失必须仍属原daemon和data卷，身份漂移保持未知不再次删除',async t=>{
 const x=await setup(t),plan=await x.engine.plan(x.run),r=x.request(plan);x.state.unknown=true;
 await x.engine.execute(r);x.state.ids=x.state.ids.filter(n=>image(n)!==r.image_id);
 const wrong=createRetentionEngine({store:x.store,docker:{snapshot:async()=>({...await x.docker.snapshot(),daemon_id:'other-daemon'})}});
 assert.equal((await wrong.receipt(r.intent_id)).status,'unconfirmed');assert.equal((await wrong.finishPlan(x.run)).status,'unconfirmed');
 assert.equal(x.state.removed.length,1);assert.equal((await x.engine.receipt(r.intent_id)).status,'success');
});
test('两项上限、过期计划及新增停止容器引用都不能发起删除',async t=>{
 const x=await setup(t),plan=await x.engine.plan(x.run);
 await assert.rejects(x.engine.execute({...x.request(plan),image_id:image(6)}),/IMAGE_NOT_PLANNED/);
 const late=createRetentionEngine({store:x.store,docker:x.docker,now:()=>Date.now()+301000});
 assert.equal((await late.execute(x.request(plan))).reason,'PLAN_EXPIRED');
 const referenced=createRetentionEngine({store:x.store,docker:{snapshot:async()=>{const snapshot=await x.docker.snapshot();snapshot.containers.push({id:'b'.repeat(64),image_id:plan.images[1].id,name:'/stopped',running:false});return snapshot;},remove:async()=>assert.fail('不能删除引用镜像')}});
 assert.equal((await referenced.execute(x.request(plan,1))).status,'skipped');assert.equal(x.state.removed.length,0);
});
test('Brain任务先登记后断线，恢复仅持久未执行回执，不启动删除',async t=>{
 const x=await setup(t),plan=await x.engine.plan(x.run),r=x.request(plan);
 const result=await x.engine.recover(r);assert.equal(result.status,'skipped');assert.equal(result.attempted,false);
 assert.deepEqual(await x.engine.recover(r),result);assert.equal((await x.engine.finishPlan(x.run)).status,'skipped');assert.equal(x.state.removed.length,0);
});
