import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {cleanupReplayFixture} from './fixtures/owned-replay-fixture.mjs';
const helper=new URL('./fixtures/owned-replay-fixture.mjs',import.meta.url).href;
test('真实test timeout时保留活writer目录；外层driver等writer实际close后才清理',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'replay-timeout-driver-'));const directory=path.join(root,'work');fs.mkdirSync(directory);
 const report=path.join(root,'report.json'),entry=path.join(root,'inner.mjs');
 fs.writeFileSync(entry,`import test from 'node:test';import fs from 'node:fs';import {spawn} from 'node:child_process';import {cleanupReplayFixture} from ${JSON.stringify(helper)};
const directory=${JSON.stringify(directory)},report=${JSON.stringify(report)},facts={};let closed=false;
test('owned writer is still pending',{timeout:150},async t=>{
 const child=spawn(process.execPath,['--input-type=module','-e',\`import fs from 'node:fs';setTimeout(()=>{try{fs.writeFileSync(process.env.ROOT+'/final','durable');process.send({final_write:'ok'});}catch(e){process.send({final_write:e.code});}process.disconnect();},350);\`],{env:{...process.env,ROOT:directory},stdio:['ignore','ignore','ignore','ipc']});
 child.on('message',value=>{facts.writer=value;});child.once('close',()=>{closed=true;facts.closed=true;facts.owned_pid=child.pid;fs.writeFileSync(report,JSON.stringify(facts));});
 t.after(()=>{facts.closed_at_cleanup=closed;facts.cleanup=cleanupReplayFixture({directory,closed,verified:false,aborted:t.signal.aborted});facts.root_retained=fs.existsSync(directory);});
 await new Promise(()=>{});
});`);
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const child=spawn(process.execPath,['--test',entry],{env,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 try{
  const result=await done;assert.equal(result.signal,null);assert.notEqual(result.code,0);assert.match(output,/test timed out/);
  const facts=JSON.parse(fs.readFileSync(report));assert.equal(facts.closed,true);assert.throws(()=>process.kill(facts.owned_pid,0),{code:'ESRCH'});
  assert.equal(facts.closed_at_cleanup,false);assert.equal(facts.cleanup.removed,false);assert.equal(facts.root_retained,true);assert.equal(facts.writer.final_write,'ok');assert.equal(fs.readFileSync(path.join(directory,'final'),'utf8'),'durable');
 }finally{
  // The controlled inner process and its owned writer have exited before removing anything.
  await done;const facts=fs.existsSync(report)?JSON.parse(fs.readFileSync(report)):null;
  if(facts?.closed){assert.throws(()=>process.kill(facts.owned_pid,0),{code:'ESRCH'});fs.rmSync(root,{recursive:true,force:true});}
  else t.diagnostic(`保留未证实writer退出的外层fixture: ${root}`);
 }
});
for(const state of [{closed:false,verified:true,aborted:false},{closed:true,verified:false,aborted:false},{closed:true,verified:true,aborted:true}])test('未close/未验证/abort保留产物 '+JSON.stringify(state),()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'replay-retain-'));try{const result=cleanupReplayFixture({directory,...state});assert.equal(result.removed,false);assert.ok(fs.existsSync(directory));}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('已实际close且业务已验证并未abort才删除',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'replay-closed-'));assert.equal(cleanupReplayFixture({directory,closed:true,verified:true,aborted:false}).removed,true);assert.equal(fs.existsSync(directory),false);
});
