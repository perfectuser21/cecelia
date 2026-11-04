import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const run=promisify(execFile),sha='a'.repeat(40),version='fixture.1';
const script=fileURLToPath(new URL('../../staging-verify.sh',import.meta.url));
async function fixture(t,mode='good'){
 const dir=await mkdtemp(join(tmpdir(),'stage-machines-'));await mkdir(join(dir,'bin'));const hits=[];
 const server=http.createServer((q,s)=>{
  hits.push(q.url);
  if(q.url.endsWith('/machines')){
   if(mode==='network'){q.socket.destroy();return;}
   if(mode==='http'){s.writeHead(503);s.end('unavailable');return;}
   s.end(mode==='object'?'{}':mode==='malformed'?'bad-json':'[{"id":"fixture-machine"}]');return;
  }
  if(q.url.endsWith('/health'))s.end(JSON.stringify({status:'healthy',git_sha:sha,version,runtime:{isolated:true,background_automation:false}}));
  else if(q.url.endsWith('/tick/status'))s.end('{"enabled":false}');
  else if(q.url.includes('/tasks?'))s.end('[]');
  else{s.writeHead(404);s.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>{server.close(r);server.closeAllConnections();});await rm(dir,{recursive:true,force:true});});
 await writeFile(join(dir,'bin','docker'),`#!/usr/bin/env node
const fs=require('node:fs'),{spawnSync}=require('node:child_process');const args=process.argv.slice(2);
fs.appendFileSync(process.env.FIXTURE_ARGS,JSON.stringify(args)+'\\n');
if(args[0]!=='exec'||args[1]!=='cecelia-admission-brain')process.exit(90);
if(args[2]==='node'){process.stdout.write('{"database":"cecelia_staging","host":"stage-db","tasks_table":true}');process.exit(0);}
if(args[2]!=='curl')process.exit(91);
const origin='http://localhost:5222',url=args.at(-1);if(!url.startsWith(origin+'/'))process.exit(92);
const out=spawnSync('curl',[...args.slice(3,-1),process.env.FIXTURE_ORIGIN+url.slice(origin.length)],{stdio:'inherit'});process.exit(out.status??93);
`,{mode:0o700});
 const env={...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,EXPECTED_SHA:sha,EXPECTED_VERSION:version,STAGING_CONTAINER:'cecelia-admission-brain',FIXTURE_ORIGIN:`http://127.0.0.1:${server.address().port}`,FIXTURE_ARGS:join(dir,'args')};
 return {env,hits,args:async()=> (await readFile(join(dir,'args'),'utf8')).trim().split('\n').map(JSON.parse)};
}
test('正式候选shell真实GET/machines且保既有health/tick/tasks及15秒界限',async t=>{
 const f=await fixture(t);const r=await run('bash',[script],{env:f.env});assert.match(r.stdout,/STAGING_OK/);assert.equal(f.hits.filter(x=>x==='/api/brain/machines').length,1);
 for(const suffix of ['/health','/tick/status','/tasks?limit=1'])assert.ok(f.hits.some(x=>x.endsWith(suffix)));
 const calls=await f.args(),m=calls.filter(x=>x.at(-1)==='http://localhost:5222/api/brain/machines');assert.equal(m.length,1);assert.deepEqual(m[0].slice(0,7),['exec','cecelia-admission-brain','curl','-fsS','--max-time','15','http://localhost:5222/api/brain/machines']);
});
for(const mode of ['object','malformed','http','network'])test(`machines ${mode}必须阻断候选，不以健康成功替代`,async t=>{
 const f=await fixture(t,mode);await assert.rejects(run('bash',[script],{env:f.env}),e=>e.code!==0&&!e.stdout.includes('STAGING_OK'));assert.equal(f.hits.filter(x=>x==='/api/brain/machines').length,1);
});
