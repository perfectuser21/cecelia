import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, symlink, realpath, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { selectImages, canStart, recovered, POLICY, US_MACHINE_ID } from './brain-image-retention/policy.mjs';
import { createStore } from './brain-image-retention/storage.mjs';
const GiB=2**30, now=Date.now();
const image=(n,tags=[`cecelia-brain:1.0.${n}`])=>({id:`sha256:${String(n).padStart(64,'0')}`,tags,digests:[],created_at:new Date(now-2*86400000).toISOString()});
function fixture(){
 const images=[1,2,3,4,5].map(n=>image(n));
 return {snapshot:{machine_registry_id:US_MACHINE_ID,daemon_id:'daemon-1',docker_root_dir:'/mnt/data/docker',volume_dev:1,
  observed_at:new Date(now).toISOString(),images,containers:[{id:'a'.repeat(64),image_id:images[0].id,name:'/cecelia-node-brain',running:true}],
  disk:{total_bytes:100*GiB,available_bytes:10*GiB}},ledger:{schema_version:1,generation:3,pending:null,successes:[1,2,3].map(n=>({deployment_id:randomUUID(),image_id:image(n).id,version:`1.0.${n}`,git_sha:'a'.repeat(40),confirmed_at:new Date(now-n*1000).toISOString()}))}};
}
test('高水位只选当前与两次不同成功回滚以外的两个最老单tag镜像',()=>{
 const {snapshot,ledger}=fixture();assert.deepEqual(selectImages(snapshot,ledger,now).map(x=>x.id),[image(4).id,image(5).id]);
 assert.equal(POLICY,'us-brain-image-retention-v1');
});
test('容量阈值85%或15GiB触发，80%且20GiB恢复；共享层只使用真实容量',()=>{
 assert.equal(canStart({total_bytes:200*GiB,available_bytes:30*GiB}),true);
 assert.equal(canStart({total_bytes:50*GiB,available_bytes:14*GiB}),true);
 assert.equal(canStart({total_bytes:100*GiB,available_bytes:25*GiB}),false);
 assert.equal(recovered({total_bytes:100*GiB,available_bytes:20*GiB}),true);
 assert.equal(recovered({total_bytes:50*GiB,available_bytes:19*GiB}),false);
});
for(const kind of ['stopped-reference','extra-tag','other-repo','digest','latest','fallback','young'])test(`候选排除 ${kind}`,()=>{
 const {snapshot,ledger}=fixture(),target=snapshot.images[3];
 if(kind==='stopped-reference')snapshot.containers.push({id:'b'.repeat(64),image_id:target.id,name:'/stopped',running:false});
 if(kind==='extra-tag')target.tags.push('cecelia-brain:older');
 if(kind==='other-repo')target.tags=['other:1.0.4'];
 if(kind==='digest')target.digests=['cecelia-brain@sha256:'+'a'.repeat(64)];
 if(kind==='latest')target.tags=['cecelia-brain:latest'];
 if(kind==='fallback')target.tags=['cecelia-brain:blue-fallback'];
 if(kind==='young')target.created_at=new Date(now-86399000).toISOString();
 assert.equal(selectImages(snapshot,ledger,now).some(x=>x.id===target.id),false);
});
for(const kind of ['one-rollback','missing-rollback','pending-deploy','no-current','wrong-machine','bad-image','stale','unknown-disk'])test(`未知拒绝 ${kind}`,()=>{
 const {snapshot,ledger}=fixture();
 if(kind==='one-rollback')ledger.successes=ledger.successes.slice(0,2);
 if(kind==='missing-rollback')snapshot.images=snapshot.images.filter(x=>x.id!==image(3).id);
 if(kind==='pending-deploy')ledger.pending={deployment_id:randomUUID()};
 if(kind==='no-current')snapshot.containers=[];
 if(kind==='wrong-machine')snapshot.machine_registry_id=randomUUID();
 if(kind==='bad-image')snapshot.images[3].id='short';
 if(kind==='stale')snapshot.observed_at=new Date(now-120001).toISOString();
 if(kind==='unknown-disk')snapshot.disk.available_bytes=null;
 assert.throws(()=>selectImages(snapshot,ledger,now));
});
test('真实flock跨实例互斥，不因mtime老而强夺，释放后可恢复',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'image-retention-')));const a=createStore(root),b=createStore(root);
 try{await a.withLock(async lease=>{
  await lease.assertHeld();await utimes(join(root,'operation.lock'),new Date(0),new Date(0));
  await assert.rejects(b.withLock(async()=>assert.fail('不能进入')),/IMAGE_RETENTION_BUSY/);
 });await b.withLock(async lease=>lease.assertHeld());}finally{await rm(root,{recursive:true,force:true});}
});
test('持久账原子写读一致、有界、私有权限；符号链接与宽权限拒绝',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'image-retention-')));const store=createStore(root);
 try{await store.withLock(async lease=>{
  await store.save('ledger.json',{a:1},lease);assert.deepEqual(await store.read('ledger.json'),{a:1});
  await assert.rejects(store.save('ledger.json',{large:'a'.repeat(2**20+1)},lease),/JOURNAL_TOO_LARGE/);
  assert.deepEqual(await store.read('ledger.json'),{a:1});
  await chmod(join(root,'ledger.json'),0o644);await assert.rejects(store.read('ledger.json'),/UNTRUSTED/);
 });await symlink(join(root,'ledger.json'),join(root,'config.json'));await assert.rejects(store.read('config.json'),/UNTRUSTED/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('持久intent不可改绑任务、镜像或nonce，回执可原子补写',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'image-retention-')));const store=createStore(root),id=randomUUID();
 const request={intent_id:id,task_id:randomUUID(),image_id:image(4).id};
 try{await store.withLock(async lease=>{
  await store.claim(request,lease);assert.deepEqual((await store.claim(request,lease)).request,request);
  await assert.rejects(store.claim({...request,task_id:randomUUID()},lease),/INTENT_CONFLICT/);
  await store.complete(id,{status:'success',absent:true},lease);
  assert.equal((await store.intent(id)).receipt.absent,true);
  await assert.rejects(store.complete(id,{status:'success',absent:false},lease),/RECEIPT_CONFLICT/);
 });}finally{await rm(root,{recursive:true,force:true});}
});

test('持锁父进程被杀时，在途子进程继承同一锁直至真正退出',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'image-retention-'))),store=createStore(root);
 const source=`import {createStore} from ${JSON.stringify(new URL('./brain-image-retention/storage.mjs',import.meta.url).href)};
 import {spawn} from 'node:child_process';
 await createStore(${JSON.stringify(root)}).withLock(async lease=>{
 const child=spawn(process.execPath,['-e','process.stdout.write("ready");setInterval(()=>{},1000)'],{stdio:['ignore','pipe','ignore',lease.fd]});
 child.stdout.once('data',()=>process.stdout.write(JSON.stringify({pid:child.pid})+'\\n'));
 await new Promise(resolve=>child.once('close',resolve));});`;
 const parent=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','pipe','inherit']});let childPid;
 try{
  const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('lock child timeout')),3000);
   parent.stdout.once('data',data=>{clearTimeout(timer);resolve(JSON.parse(data.toString()));});});childPid=result.pid;
  const closed=once(parent,'close');parent.kill('SIGKILL');await closed;
  await assert.rejects(store.withLock(async()=>assert.fail('后代仍持锁')),/IMAGE_RETENTION_BUSY/);
  process.kill(childPid,'SIGKILL');childPid=null;
  await new Promise(resolve=>setTimeout(resolve,50));await store.withLock(async lease=>lease.assertHeld());
 }finally{parent.kill('SIGKILL');if(childPid)process.kill(childPid,'SIGKILL');await rm(root,{recursive:true,force:true});}
});
