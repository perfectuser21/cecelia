import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,stat,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createStore} from './brain-image-retention/storage.mjs';
import {createDockerAdapter} from './brain-image-retention/docker.mjs';
import {createRetentionEngine} from './brain-image-retention/engine.mjs';
import {US_MACHINE_ID} from './brain-image-retention/policy.mjs';
for (const omitted of [false,true]) test(`列表遗漏=${omitted}时实际存在完整 ID 不能被签为已删除`,async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'image-hidden-review-')));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const image='sha256:'+'4'.repeat(64), executable=join(root,'docker.cjs');
 await writeFile(executable,`#!/usr/bin/env node
const fs=require('fs'),a=process.argv.slice(2),id=${JSON.stringify(image)};
fs.appendFileSync(__dirname+'/calls',JSON.stringify(a)+'\\n');
if(a[0]==='info')console.log(JSON.stringify({ID:'daemon',DockerRootDir:'/mnt/data/docker',OSType:'linux'}));
else if(a[0]==='image'&&a[1]==='ls'){if(!${omitted}&&a.includes('--all'))console.log(id);}
else if(a[0]==='container'&&a[1]==='ls'){}
else if(a[0]==='image'&&a[1]==='inspect')console.log(JSON.stringify([{Id:id,RepoTags:[],RepoDigests:[],Created:'2026-01-01T00:00:00Z'}]));
else process.exit(2);
`,{mode:0o700});
 const expected={machine_registry_id:US_MACHINE_ID,daemon_id:'daemon',docker_root_dir:'/mnt/data/docker',volume_dev:(await stat(root)).dev};
 const store=createStore(root),docker=createDockerAdapter({root,dataPath:root,expected,executable}),engine=createRetentionEngine({store,docker});
 const request={run_id:randomUUID(),image_id:image,intent_id:randomUUID(),task_id:randomUUID()};
 await store.withLock(async lease=>{
  await store.claim(request,lease,{attempted:true,identity:expected,before:{total_bytes:100*2**30,available_bytes:10*2**30,observed_at:new Date().toISOString()}});
  await store.save('ledger.json',{generation:1,cleanup_run_id:request.run_id},lease);
  await store.save(`plan-${request.run_id}.json`,{status:'running',run_id:request.run_id,identity:expected,images:[{id:image}],claims:[request]},lease);
 });
 const result=await engine.receipt(request.intent_id),finish=await engine.finishPlan(request.run_id);
 const calls=(await readFile(join(root,'calls'),'utf8')).trim().split('\n').map(JSON.parse);
 const exact=JSON.parse(execFileSync(executable,['image','inspect',image],{encoding:'utf8'}));
 if(omitted)assert.ok(calls.some(a=>a[0]==='image'&&a[1]==='inspect'&&a[2]===image));
 assert.equal(exact[0].Id,image,'精确 inspect 确认目标仍实际存在');
 assert.equal(result.status,'unconfirmed','列表遗漏不能封存精确缺失回执或解除未知 run');
 assert.equal(finish.status,'unconfirmed');assert.equal((await store.read('ledger.json')).cleanup_run_id,request.run_id);
});
