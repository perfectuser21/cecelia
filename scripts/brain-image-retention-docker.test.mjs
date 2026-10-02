import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from './brain-image-retention/storage.mjs';
import { createDockerAdapter } from './brain-image-retention/docker.mjs';
import { US_MACHINE_ID } from './brain-image-retention/policy.mjs';
const image='sha256:'+'a'.repeat(64),container='b'.repeat(64);
async function setup(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'image-docker-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const fixture=join(root,'docker-fixture.cjs');
 await writeFile(fixture,`#!/usr/bin/env node
const fs=require('fs'),path=require('path');const root=__dirname,args=process.argv.slice(2);fs.appendFileSync(path.join(root,'calls'),JSON.stringify(args)+'\\n');
const s=JSON.parse(fs.readFileSync(path.join(root,'daemon.json')));let v;
if(args[0]==='info')v={ID:s.daemon,DockerRootDir:s.data,OSType:'linux'};
else if(args[0]==='image'&&args[1]==='ls'){process.stdout.write(s.absent?'':s.image+'\\n');process.exit(0);}
else if(args[0]==='container'&&args[1]==='ls'){process.stdout.write(s.container+'\\n');process.exit(0);}
else if(args[0]==='image'&&args[1]==='inspect')v=[{Id:s.image,RepoTags:['cecelia-brain:1.0.1'],RepoDigests:[],Created:'2026-01-01T00:00:00Z'}];
else if(args[0]==='container'&&args[1]==='inspect')v=[{Id:s.container,Image:s.image,Name:'/cecelia-node-brain',State:{Running:true}}];
else if(args[0]==='image'&&args[1]==='rm'){if(s.fail)process.exit(1);s.absent=true;fs.writeFileSync(path.join(root,'daemon.json'),JSON.stringify(s));process.stdout.write('Deleted');process.exit(0);}
else process.exit(2);
if(s.huge)process.stdout.write('x'.repeat(3*1024*1024));else process.stdout.write(JSON.stringify(v));
`,{mode:0o700});
 const state={daemon:'daemon',data:'/mnt/data/docker',image,container};await writeFile(join(root,'daemon.json'),JSON.stringify(state));
 const expected={machine_registry_id:US_MACHINE_ID,daemon_id:'daemon',docker_root_dir:'/mnt/data/docker',volume_dev:(await stat(root)).dev};
 const store=createStore(root),docker=createDockerAdapter({root,dataPath:root,expected,executable:fixture});
 return {root,store,docker,state,save:()=>writeFile(join(root,'daemon.json'),JSON.stringify(state))};
}
test('实际子进程adapter读取完整Docker身份及同卷statfs，仅完整ID无force删除',async t=>{
 const x=await setup(t);await x.store.withLock(async lease=>{
  const snapshot=await x.docker.snapshot(lease);assert.equal(snapshot.images[0].id,image);assert.equal(snapshot.containers[0].id,container);
  assert.equal(snapshot.machine_registry_id,US_MACHINE_ID);assert.ok(snapshot.disk.total_bytes>0);
  await x.docker.remove(image,lease);assert.equal((await x.docker.snapshot(lease)).images.length,0);
 });const calls=(await readFile(join(x.root,'calls'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.deepEqual(calls.filter(a=>a[1]==='rm'),[['image','rm',image]]);assert.equal(calls.some(a=>a.includes('--force')||a.includes('prune')),false);
});
test('daemon/data卷身份变化及短ID拒绝，Docker非零或超限回执不可当成功',async t=>{
 const x=await setup(t);await x.store.withLock(async lease=>{
  x.state.daemon='other';await x.save();await assert.rejects(x.docker.snapshot(lease),/DAEMON_IDENTITY_CHANGED/);
  await assert.rejects(x.docker.remove(image,lease),/DAEMON_IDENTITY_CHANGED/);
  x.state.daemon='daemon';x.state.data='/other';await x.save();await assert.rejects(x.docker.snapshot(lease),/DAEMON_IDENTITY_CHANGED/);
  x.state.data='/mnt/data/docker';x.state.fail=true;await x.save();await assert.rejects(x.docker.remove(image,lease),/DOCKER_UNCONFIRMED/);
  await assert.rejects(x.docker.remove('aaaa',lease),/INVALID_IMAGE/);
  x.state.huge=true;await x.save();await assert.rejects(x.docker.snapshot(lease),/DOCKER_OUTPUT_LIMIT/);
 });
});
for (const leaderExits of [false,true]) test(`超时/leader先退出=${leaderExits}时整组后代结束，有界收口并释放真实锁`,async t=>{
 const x=await setup(t);let descendant;
 const executable=join(x.root,'descendant-fixture.cjs');
 await writeFile(executable,`#!/usr/bin/env node
const fs=require('node:fs'),{spawn}=require('node:child_process');
const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit',3]});
fs.writeFileSync(__dirname+'/child.pid',String(child.pid));
${leaderExits?'process.exit(0);':'setInterval(()=>{},1000);'}
`,{mode:0o700});
 const docker=createDockerAdapter({root:x.root,dataPath:x.root,expected:{machine_registry_id:US_MACHINE_ID,daemon_id:'daemon',docker_root_dir:'/mnt/data/docker',volume_dev:(await stat(x.root)).dev},executable,timeoutMs:1000});
 let done=false;const result=x.store.withLock(lease=>docker.snapshot(lease)).then(()=>{done=true;return null;},error=>{done=true;return error;});
 try{
  await new Promise(resolve=>setTimeout(resolve,2250));
  descendant=Number(await readFile(join(x.root,'child.pid'),'utf8'));
  assert.equal(done,true,'必须在预算内收口，不能等待未终止后代关闭pipe');
  assert.ok(await result);
  const {execFile}=await import('node:child_process');
  const state=await new Promise(resolve=>execFile('ps',['-o','stat=','-p',String(descendant)],(_error,stdout)=>resolve(stdout.trim())));
  assert.ok(state===''||state.startsWith('Z'),`后代不得继续运行: ${state}`);
  await x.store.withLock(async lease=>lease.assertHeld());
 }finally{
  if(descendant){try{process.kill(descendant,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
  await result;
 }
});
