import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createStore } from './brain-image-retention/storage.mjs';
import { createRuntime, readHealth } from './brain-image-retention/runtime.mjs';
import { US_MACHINE_ID } from './brain-image-retention/policy.mjs';
test('默认无受信配置没有删除能力，可信配置严格固定US与实际数据卷',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'image-runtime-')));t.after(()=>rm(root,{recursive:true,force:true}));
 assert.equal(await createRuntime({root,dataPath:root}),null);
 const store=createStore(root),config={schema_version:1,machine_registry_id:US_MACHINE_ID,daemon_id:'daemon',docker_root_dir:'/mnt/data/docker',volume_dev:(await stat(root)).dev};
 await store.withLock(lease=>store.save('config.json',config,lease));
 assert.ok(await createRuntime({root,dataPath:root}));
 await store.withLock(lease=>store.save('config.json',{...config,command:'anything'},lease));
 await assert.rejects(createRuntime({root,dataPath:root}),/INVALID_HOST_CONFIG/);
});
test('真实HTTP健康读取限时限量、拒绝redirect；只返回version SHA与健康状态',async t=>{
 let mode='ok';const server=createServer((_req,res)=>{
  if(mode==='redirect'){res.writeHead(302,{Location:'http://example.invalid'});res.end();return;}
  res.end(mode==='huge'?'x'.repeat(300000):JSON.stringify({status:'healthy',version:'1.0.1',git_sha:'a'.repeat(40),other:'ignored'}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url=`http://127.0.0.1:${server.address().port}`;
 assert.deepEqual(await readHealth(url),{status:'healthy',version:'1.0.1',git_sha:'a'.repeat(40)});
 mode='redirect';await assert.rejects(readHealth(url));mode='huge';await assert.rejects(readHealth(url),/HEALTH_OUTPUT_LIMIT/);
});
