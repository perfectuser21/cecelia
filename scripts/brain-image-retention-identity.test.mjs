import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStore} from './brain-image-retention/storage.mjs';
import {createDockerAdapter} from './brain-image-retention/docker.mjs';
import {createRetentionEngine} from './brain-image-retention/engine.mjs';
import {US_MACHINE_ID} from './brain-image-retention/policy.mjs';
for(const mode of ['exact','daemon-before','daemon-after','data-before','data-after','exit2','stdout-invalid']) test(`完整缺失证据身份边界 ${mode}`,async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'image-identity-review-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const image='sha256:'+'4'.repeat(64),executable=join(root,'docker.cjs');
 await writeFile(join(root,'state.json'),JSON.stringify({info:0}));
 await writeFile(executable,`#!/usr/bin/env node
const fs=require('fs'),a=process.argv.slice(2),mode=${JSON.stringify(mode)},id=${JSON.stringify(image)},p=__dirname+'/state.json',s=JSON.parse(fs.readFileSync(p));
if(a[0]==='info'){
 s.info++;fs.writeFileSync(p,JSON.stringify(s));const changed=mode.endsWith('before')?s.info>=2:mode.endsWith('after')?s.info>=3:false;
 console.log(JSON.stringify({ID:changed&&mode.startsWith('daemon')?'changed':'daemon',DockerRootDir:changed&&mode.startsWith('data')?'/other':'/mnt/data/docker',OSType:'linux'}));
}else if(a[0]==='image'&&a[1]==='ls'){}
else if(a[0]==='container'&&a[1]==='ls'){}
else if(a[0]==='image'&&a[1]==='inspect'){
 process.stdout.write(mode==='stdout-invalid'?'{}':'[]');process.stderr.write('Error response from daemon: No such image: '+id);process.exit(mode==='exit2'?2:1);
}else process.exit(3);
`,{mode:0o700});
 const expected={machine_registry_id:US_MACHINE_ID,daemon_id:'daemon',docker_root_dir:'/mnt/data/docker',volume_dev:(await stat(root)).dev};
 const store=createStore(root),docker=createDockerAdapter({root,dataPath:root,expected,executable}),engine=createRetentionEngine({store,docker});
 const request={run_id:randomUUID(),image_id:image,intent_id:randomUUID(),task_id:randomUUID()};
 await store.withLock(async lease=>{
 await store.claim(request,lease,{attempted:true,identity:expected,before:{total_bytes:100*2**30,available_bytes:10*2**30,observed_at:new Date().toISOString()}});
 await store.save('ledger.json',{generation:1,cleanup_run_id:request.run_id},lease);
 await store.save(`plan-${request.run_id}.json`,{status:'running',run_id:request.run_id,identity:expected,images:[{id:image}],claims:[request]},lease);
 });
 const receipt=await engine.receipt(request.intent_id),finish=await engine.finishPlan(request.run_id);
 assert.equal(receipt.status,mode==='exact'?'success':'unconfirmed');assert.equal(finish.status,mode==='exact'?'success':'unconfirmed');
 assert.equal((await store.read('ledger.json')).cleanup_run_id,mode==='exact'?null:request.run_id);
 if(mode!=='exact')assert.equal((await store.intent(request.intent_id)).receipt,null);
});
