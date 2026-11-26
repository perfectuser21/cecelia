import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,chmod,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createStore} from './brain-image-retention/storage.mjs';
import {assertReleaseOrder,RELEASE_ORDER_LOCK_WAIT_MS} from './brain-image-retention/release-order.mjs';
import {US_MACHINE_ID} from './brain-image-retention/policy.mjs';
const storage=pathToFileURL(join(import.meta.dirname,'brain-image-retention/storage.mjs')).href;
async function fixture(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'release-order-wait-')));await chmod(root,0o700);
 const children=[];
 t.after(async()=>{for(const child of children){if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await child.done;}await rm(root,{recursive:true,force:true});});
 const git=args=>execFileSync('git',['-c','core.hooksPath=/dev/null','-C',root,...args],{stdio:['ignore','pipe','pipe']}).toString().trim();
 git(['init','-q']);git(['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','A']);
 const a=git(['rev-parse','HEAD']);git(['-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','B']);
 const b=git(['rev-parse','HEAD']);git(['update-ref','refs/remotes/origin/main',b]);
 const store=createStore(root);
 function track(p){p.done=new Promise((resolve,reject)=>{p.once('error',reject);p.once('exit',(code,signal)=>resolve({code,signal}));});children.push(p);return p;}
 function child(code,ipc=false){
  const p=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe',...(ipc?['ipc']:[])]});
  p.output='';p.stderr.on('data',x=>p.output+=x);return track(p);
 }
 async function holder(){
  const p=child(`import {createStore} from ${JSON.stringify(storage)};await createStore(${JSON.stringify(root)}).withLock(async()=>{process.send('held');await new Promise(r=>process.once('message',r));});process.disconnect();`,true);
  assert.equal((await once(p,'message'))[0],'held');return p;
 }
 let snapshots=0,current=a;
 const runtime={store,docker:{snapshot:async lease=>{await lease.assertHeld();snapshots++;return {containers:[{name:'/cecelia-node-brain',id:'c'.repeat(64),image_id:'sha256:'+'d'.repeat(64),running:true}],images:[{id:'sha256:'+'d'.repeat(64),git_sha:current}]};}}};
 return {root,store,runtime,a,b,holder,child,track,get snapshots(){return snapshots;},set current(value){current=value;}};
}
test('真实跨进程flock短暂竞争释放后重新读取身份，只运行一次双快照',async t=>{
 const f=await fixture(t), holder=await f.holder();let busy=0,entered=0;
 f.runtime.store={withLock:async cb=>{try{return await f.store.withLock(lease=>{entered++;return cb(lease);});}catch(error){if(error.code==='IMAGE_RETENTION_BUSY'){busy++;assert.equal(f.snapshots,0);f.current=f.b;holder.send('release');await holder.done;}throw error;}}};
 const result=await assertReleaseOrder({repo:f.root,target:f.b,runtime:f.runtime,lockWaitMs:1000});
 assert.ok(busy>=1);assert.equal(entered,1);assert.equal(f.snapshots,2);assert.equal(result.git_sha,f.b);
 await f.store.withLock(lease=>lease.assertHeld());
});
test('真实持锁超过预算仍闭锁，不读取快照；共享store仍默认立即BUSY',async t=>{
 const f=await fixture(t),holder=await f.holder();
 await assert.rejects(f.store.withLock(()=>assert.fail('default store entered')), {code:'IMAGE_RETENTION_BUSY'});
 const start=performance.now();
 await assert.rejects(assertReleaseOrder({repo:f.root,target:f.b,runtime:f.runtime,lockWaitMs:150}),{code:'DEPLOY_ORDER_LOCK_TIMEOUT'});
 assert.ok(performance.now()-start>=150);assert.ok(performance.now()-start<3000);assert.equal(f.snapshots,0);
 assert.equal(holder.exitCode,null);holder.send('release');await holder.done;await f.store.withLock(lease=>lease.assertHeld());
});
test('非BUSY取锁错误立即拒绝且不重试',async t=>{
 const f=await fixture(t);let calls=0;
 f.runtime.store={withLock:async()=>{calls++;throw Object.assign(Error('invalid'),{code:'UNTRUSTED_LOCK'});}};
 await assert.rejects(assertReleaseOrder({repo:f.root,target:f.b,runtime:f.runtime,lockWaitMs:1000}),{code:'UNTRUSTED_LOCK'});assert.equal(calls,1);assert.equal(f.snapshots,0);
});
test('callback内BUSY绝不重试或重复副作用，真实lease最终释放',async t=>{
 const f=await fixture(t);let calls=0;
 f.runtime.docker.snapshot=async()=>{calls++;throw Object.assign(Error('callback busy'),{code:'IMAGE_RETENTION_BUSY'});};
 await assert.rejects(assertReleaseOrder({repo:f.root,target:f.b,runtime:f.runtime,lockWaitMs:1000}),{code:'IMAGE_RETENTION_BUSY'});assert.equal(calls,1);await f.store.withLock(lease=>lease.assertHeld());
});
test('实际顺序仍拒绝旧祖先，目标未合并及身份漂移仍拒绝',async t=>{
 const f=await fixture(t);f.current=f.b;
 await assert.rejects(assertReleaseOrder({repo:f.root,target:f.a,runtime:f.runtime}),{code:'DEPLOY_TARGET_STALE'});
 execFileSync('git',['-C',f.root,'update-ref','refs/remotes/origin/main',f.a]);
 await assert.rejects(assertReleaseOrder({repo:f.root,target:f.b,runtime:f.runtime}),{code:'DEPLOY_TARGET_UNMERGED'});
 execFileSync('git',['-C',f.root,'update-ref','refs/remotes/origin/main',f.b]);
 const snapshot=f.runtime.docker.snapshot;let calls=0;f.runtime.docker.snapshot=async lease=>{f.current=++calls===1?f.a:f.b;return snapshot(lease);};
 await assert.rejects(assertReleaseOrder({repo:f.root,target:f.b,runtime:f.runtime}),{code:'DEPLOY_CURRENT_CHANGED'});
});
for(const signal of ['SIGTERM','SIGINT'])test(`真实CLI ${signal}取消等待，只退出本人且不影响holder或遗留lease`,async t=>{
 const f=await fixture(t);
 await f.store.withLock(lease=>f.store.save('config.json',{schema_version:1,machine_registry_id:US_MACHINE_ID,daemon_id:'fixture',docker_root_dir:f.root,volume_dev:0},lease));
 const holder=await f.holder(), lockBefore=await stat(join(f.root,'operation.lock'));
 const cli=spawn(process.execPath,[join(import.meta.dirname,'brain-image-retention/release-order.mjs'),f.root,f.b],{env:{...process.env,CECELIA_IMAGE_RETENTION_DIR:f.root},stdio:['ignore','pipe','pipe']});
 f.track(cli);
 let output='';cli.stderr.on('data',x=>output+=x);const done=once(cli,'exit');
 // The real lock helper attempt is visible as a BUSY wait diagnostic, not an arbitrary sleep.
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CLI never waited')),3000);cli.stderr.on('data',()=>{if(output.includes('DEPLOY_ORDER_LOCK_WAIT')){clearTimeout(timer);resolve();}});cli.once('exit',()=>{clearTimeout(timer);reject(Error(`premature CLI exit: ${output}`));});});
 cli.kill(signal);const [code]=await done;assert.equal(code,1);assert.throws(()=>process.kill(cli.pid,0),{code:'ESRCH'});t.diagnostic(`owned waiter PID ${cli.pid} exited; external holder PID ${holder.pid} retained`);assert.match(output,/DEPLOY_ORDER_CANCELLED/);assert.equal(holder.exitCode,null);
 await assert.rejects(f.store.withLock(()=>assert.fail('holder lost lock')),{code:'IMAGE_RETENTION_BUSY'});
 holder.send('release');await holder.done;await f.store.withLock(lease=>lease.assertHeld());
 assert.equal((await stat(join(f.root,'operation.lock'))).ino,lockBefore.ino);
});

test('生产预算固定且不接受扩大预算；真实不可信store错误原样拒绝',async t=>{
 const f=await fixture(t);assert.equal(RELEASE_ORDER_LOCK_WAIT_MS,120000);
 await assert.rejects(assertReleaseOrder({repo:f.root,target:f.b,runtime:f.runtime,lockWaitMs:Infinity}),{code:'DEPLOY_ORDER_UNKNOWN'});
 await f.store.withLock(lease=>lease.assertHeld());await chmod(join(f.root,'operation.lock'),0o644);
 await assert.rejects(assertReleaseOrder({repo:f.root,target:f.b,runtime:f.runtime}),{code:'UNTRUSTED_LOCK'});assert.equal(f.snapshots,0);
});
