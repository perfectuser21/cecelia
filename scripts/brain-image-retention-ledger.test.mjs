import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from './brain-image-retention/storage.mjs';
import { createDeploymentLedger } from './brain-image-retention/ledger.mjs';
const image=n=>'sha256:'+String(n).repeat(64),sha=n=>String(n).repeat(40);
async function setup(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'image-ledger-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=createStore(root),state={current:1,health:1};
 const docker={snapshot:async()=>({containers:[{id:'a'.repeat(64),name:'/cecelia-node-brain',running:true,image_id:image(state.current)}],
  images:[1,2,3].map(n=>({id:image(n),tags:[`cecelia-brain:1.0.${n}`],git_sha:sha(n)}))})};
 const health=async()=>({version:`1.0.${state.health}`,git_sha:sha(state.health),status:'healthy'});
 return {store,state,ledger:createDeploymentLedger({store,docker,health}),request:{deployment_id:randomUUID(),version:'1.0.2',git_sha:sha(2)}};
}
test('部署intent持久保护到真实健康版本SHA与容器镜像一致；同intent幂等',async t=>{
 const x=await setup(t);await x.ledger.begin(x.request);
 assert.equal((await x.store.read('ledger.json')).pending.deployment_id,x.request.deployment_id);
 await x.ledger.begin(x.request);await assert.rejects(x.ledger.begin({...x.request,deployment_id:randomUUID()}),/DEPLOYMENT_PENDING/);
 x.state.current=2;await assert.rejects(x.ledger.finish(x.request.deployment_id,'success'),/DEPLOY_HEALTH_MISMATCH/);
 assert.ok((await x.store.read('ledger.json')).pending);
 x.state.health=2;const result=await x.ledger.finish(x.request.deployment_id,'success');assert.equal(result.image_id,image(2));
 assert.equal((await x.store.read('ledger.json')).pending,null);assert.equal((await x.store.read('ledger.json')).successes.length,1);
 assert.deepEqual(await x.ledger.finish(x.request.deployment_id,'success'),result);
});
test('成功证明落盘后ledger提交回执丢失，原intent对账不重复成功史',async t=>{
 const x=await setup(t);await x.ledger.begin(x.request);x.state.current=x.state.health=2;
 const save=x.store.save;let lost=true;
 const store={...x.store,save:async(name,value,lease)=>{await save(name,value,lease);if(name==='ledger.json'&&!value.pending&&lost){lost=false;throw Error('lost acknowledgement');}}};
 const ledger=createDeploymentLedger({store,docker:{snapshot:async()=>assert.fail('恢复不重做已封存证明')},health:async()=>assert.fail()});
 const actual=createDeploymentLedger({store,docker:{snapshot:async()=>({containers:[{name:'/cecelia-node-brain',running:true,image_id:image(2)}],images:[{id:image(2),tags:['cecelia-brain:1.0.2'],git_sha:sha(2)}]})},health:async()=>({status:'healthy',version:'1.0.2',git_sha:sha(2)})});
 await assert.rejects(actual.finish(x.request.deployment_id,'success'),/lost acknowledgement/);
 assert.equal((await ledger.finish(x.request.deployment_id,'success')).image_id,image(2));
 assert.equal((await x.store.read('ledger.json')).successes.length,1);
});
test('只允许精确原镜像恢复回执解除失败部署保护；不会登记失败目标为成功',async t=>{
 const x=await setup(t);await x.ledger.begin(x.request);
 x.state.current=x.state.health=3;await assert.rejects(x.ledger.finish(x.request.deployment_id,'recovered'),/DEPLOY_IMAGE_MISMATCH/);
 x.state.current=x.state.health=1;await x.ledger.finish(x.request.deployment_id,'recovered');
 const state=await x.store.read('ledger.json');assert.equal(state.pending,null);assert.equal(state.successes.length,0);
});
test('失败部署只能复用原pending恢复previous完整身份，未知目标不能清保护',async t=>{
 const x=await setup(t);await x.ledger.begin(x.request);x.state.current=x.state.health=2;
 const request={deployment_id:randomUUID(),version:'1.0.1',git_sha:sha(1),image_id:image(1)};
 await assert.rejects(x.ledger.rollback({...request,image_id:image(3)}),/ROLLBACK_TARGET_MISMATCH/);
 const result=await x.ledger.rollback(request);
 assert.equal(result.deployment_id,x.request.deployment_id);assert.equal(result.outcome,'recovered');assert.equal(result.image_id,image(1));
 assert.deepEqual(await x.ledger.rollback(request),result);
 assert.ok((await x.store.read('ledger.json')).pending);
 await assert.rejects(x.ledger.finish(x.request.deployment_id,'success'),/DEPLOYMENT_RECOVERING/);
 x.state.current=x.state.health=1;await x.ledger.finish(result.deployment_id,result.outcome);
 assert.equal((await x.store.read('ledger.json')).pending,null);assert.equal((await x.store.read('ledger.json')).successes.length,0);
});
test('没有未决部署时rollback建立正常回滚保护，并绑定实际目标完整ID',async t=>{
 const x=await setup(t),request={deployment_id:randomUUID(),version:'1.0.3',git_sha:sha(3),image_id:image(3)};
 const result=await x.ledger.rollback(request);assert.equal(result.deployment_id,request.deployment_id);assert.equal(result.outcome,'success');
 x.state.current=x.state.health=3;await x.ledger.finish(result.deployment_id,result.outcome);
 assert.equal((await x.store.read('ledger.json')).successes[0].image_id,image(3));
});
test('独立rollback预约回执丢失，同UUID及shell新UUID均复用原目标身份',async t=>{
 const x=await setup(t),request={deployment_id:randomUUID(),version:'1.0.3',git_sha:sha(3),image_id:image(3)};
 const first=await x.ledger.rollback(request);
 assert.deepEqual(await x.ledger.rollback(request),first);
 assert.deepEqual(await x.ledger.rollback({...request,deployment_id:randomUUID()}),first);
 await assert.rejects(x.ledger.rollback({...request,deployment_id:randomUUID(),git_sha:sha(2)}),/ROLLBACK_TARGET_MISMATCH/);
 assert.equal((await x.store.read('ledger.json')).pending.deployment_id,first.deployment_id);
 x.state.current=x.state.health=3;await x.ledger.finish(first.deployment_id,first.outcome);
 assert.equal((await x.store.read('ledger.json')).successes[0].image_id,image(3));
});
for (const duringHealth of [false, true]) {
 test(`sidecar固定容器在finish${duringHealth?'健康中':'开始前'}被同镜像容器替换，仍拒绝落成功回执`,async t=>{
  const x=await setup(t);await x.ledger.begin(x.request);
  let id=duringHealth?'a'.repeat(64):'b'.repeat(64);
  const ledger=createDeploymentLedger({store:x.store,expectedContainerId:'a'.repeat(64),
   docker:{snapshot:async()=>({containers:[{id,name:'/cecelia-node-brain',running:true,image_id:image(2)}],images:[{id:image(2),tags:['cecelia-brain:1.0.2'],git_sha:sha(2)}]})},
   health:async()=>{id='b'.repeat(64);return {status:'healthy',version:'1.0.2',git_sha:sha(2)};}});
  await assert.rejects(ledger.finish(x.request.deployment_id,'success'),/DEPLOY_CONTAINER_MISMATCH/);
  assert.ok((await x.store.read('ledger.json')).pending);
  assert.equal((await x.store.read(`deployment-${x.request.deployment_id}.json`)).receipt,null);
 });
}

// 自动补收账（任务 502f2852）：下一次部署 begin 撞上 pending 时，仅当运行中容器已是 pending 目标且健康，
// 才复用 finish 的完整核验补收账；核验不过/仍在新鲜期/恢复中一律不改状态。
async function reconcileSetup(t,{ageMs}){
 const x=await setup(t);let clock=Date.parse('2026-10-09T19:51:00Z');
 const ledger=createDeploymentLedger({store:x.store,docker:{snapshot:async()=>({containers:[{id:'a'.repeat(64),name:'/cecelia-node-brain',running:true,image_id:image(x.state.current)}],images:[1,2,3].map(n=>({id:image(n),tags:[`cecelia-brain:1.0.${n}`],git_sha:sha(n)}))})},
  health:async()=>({version:`1.0.${x.state.health}`,git_sha:sha(x.state.health),status:'healthy'}),now:()=>clock});
 await ledger.begin(x.request);clock+=ageMs;return {...x,ledger};
}
test('reconcile：无pending返回null，不写任何状态',async t=>{
 const x=await setup(t);assert.equal(await x.ledger.reconcile(),null);assert.equal(await x.store.read('ledger.json'),null);
});
test('reconcile：pending目标已在跑且健康（陈旧pending）→ 复用finish核验补收账，清pending并记成功史',async t=>{
 const x=await reconcileSetup(t,{ageMs:60*60*1000});x.state.current=x.state.health=2;
 const receipt=await x.ledger.reconcile();
 assert.equal(receipt.deployment_id,x.request.deployment_id);assert.equal(receipt.outcome,'success');assert.equal(receipt.image_id,image(2));
 const state=await x.store.read('ledger.json');assert.equal(state.pending,null);assert.equal(state.successes.length,1);
 await x.ledger.begin({...x.request,deployment_id:randomUUID()});
});
test('reconcile：运行中仍是旧镜像（核验不过）→ 抛错且pending原样保留，不登记成功',async t=>{
 const x=await reconcileSetup(t,{ageMs:60*60*1000});
 await assert.rejects(x.ledger.reconcile(),/DEPLOY_IMAGE_MISMATCH|DEPLOY_HEALTH_MISMATCH/);
 const state=await x.store.read('ledger.json');assert.equal(state.pending.deployment_id,x.request.deployment_id);assert.equal(state.successes.length,0);
});
test('reconcile：pending仍在新鲜期（部署可能在途）→ 拒绝且不改状态',async t=>{
 const x=await reconcileSetup(t,{ageMs:60*1000});x.state.current=x.state.health=2;
 await assert.rejects(x.ledger.reconcile(),/DEPLOYMENT_PENDING_FRESH/);
 assert.equal((await x.store.read('ledger.json')).pending.deployment_id,x.request.deployment_id);
});
test('reconcile：pending处于恢复中（rollback在途）→ 拒绝且不改状态',async t=>{
 const x=await reconcileSetup(t,{ageMs:60*60*1000});x.state.current=x.state.health=2;
 await x.ledger.rollback({deployment_id:randomUUID(),version:'1.0.1',git_sha:sha(1),image_id:image(1)});
 await assert.rejects(x.ledger.reconcile(),/DEPLOYMENT_RECOVERING/);
 assert.ok((await x.store.read('ledger.json')).pending.recovering);
});
