import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {setup,image,container,sha} from './__tests__/fixtures/deploy-settlement-process.mjs';

test('settlement只核验固定容器及收据镜像，不枚举janitor完整库存',async t=>{
 const x=await setup(t),result=await x.ledger.settlement(sha);
 assert.equal(result.container_id,container);
 const calls=await x.calls();
 assert.equal(calls.some(a=>a.includes('ls')),false);
 assert.deepEqual(calls.filter(a=>a[0]==='inspect'),[['inspect','cecelia-node-brain',image],['inspect','cecelia-node-brain',image]]);
 assert.equal(calls.filter(a=>a[0]==='info').length,2);
});
test('逐步都未超时的真实子进程仍受共享累计预算约束，释放锁后可恢复',async t=>{
 const x=await setup(t);x.state.delay=180;await x.save();
 const started=Date.now();
 await assert.rejects(x.ledger.settlement(sha,{timeoutMs:650}),/DEPLOY_STATUS_TIMEOUT/);
 assert.ok(Date.now()-started<1800,'不能把多次单步预算串成无限长查询');
 await x.store.withLock(lease=>lease.assertHeld());
 x.state.delay=0;await x.save();assert.equal((await x.ledger.settlement(sha)).image_id,image);
});
test('总预算终止真实悬挂后代、保留ledger且确认锁释放，随后恢复',async t=>{
 const x=await setup(t);x.state.mode='hang';await x.save();
 const before=await x.store.read('ledger.json'),started=Date.now();
 await assert.rejects(x.ledger.settlement(sha,{timeoutMs:500}),/DEPLOY_STATUS_TIMEOUT/);
 assert.ok(Date.now()-started<1600);
 const pid=Number(await readFile(join(x.root,'descendant.pid'),'utf8'));
 let processState='';try{processState=execFileSync('ps',['-o','stat=','-p',String(pid)],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
 assert.ok(!processState||processState.startsWith('Z'),'后代不可继续持锁运行');
 await x.store.withLock(lease=>lease.assertHeld());
 assert.deepEqual(await x.store.read('ledger.json'),before);
 x.state.mode='ok';await x.save();assert.equal((await x.ledger.settlement(sha)).git_sha,sha);
});
test('调用方断开同样取消真实进程并释放锁',async t=>{
 const x=await setup(t);x.state.mode='hang';await x.save();
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),500);
 try{await assert.rejects(x.ledger.settlement(sha,{timeoutMs:2500,signal:controller.signal}),/DEPLOY_STATUS_ABORTED/);}finally{clearTimeout(timer);}
 await x.store.withLock(lease=>lease.assertHeld());
});
for(const mode of ['container-drift','wrong-image','image-sha','bad-health','daemon-drift','ledger-drift'])test(`定向读取仍拒绝身份/健康变化：${mode}`,async t=>{
 const x=await setup(t);x.state.mode=mode;await x.save();
 await assert.rejects(x.ledger.settlement(sha));
});

for(const mode of ['business-503','business-invalid','business-object','business-redirect'])test(`只读结算拒绝任务读取失败且不改生产账本：${mode}`,async t=>{
 const x=await setup(t);x.state.mode=mode;await x.save();const before=await x.store.read('ledger.json');
 await assert.rejects(x.ledger.settlement(sha),/DEPLOY_BUSINESS_UNAVAILABLE/);assert.deepEqual(await x.store.read('ledger.json'),before);
 assert.ok((await x.calls()).some(a=>a.includes(container)&&a.some(x=>x.includes('/tasks?limit=1'))));
});
