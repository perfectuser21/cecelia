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
 const store=createStore(root),docker=createDockerAdapter({root,expected,executable:fixture});
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
