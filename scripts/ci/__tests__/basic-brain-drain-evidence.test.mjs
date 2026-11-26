import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
const root=new URL('../../../',import.meta.url).pathname;
const drainId='11111111-1111-4111-8111-111111111111';
const otherId='22222222-2222-4222-8222-222222222222';
const taskId='33333333-3333-4333-8333-333333333333';
const runId='44444444-4444-4444-8444-444444444444';
const ready={protocol:'brain-process-drain-v1',drain_id:drainId,draining:true,safe_to_swap:true,remaining:0,blockers:[],independent_task_count:149};
const busy={...ready,safe_to_swap:false,remaining:1,blockers:[{kind:'shared_controller',task_id:taskId,run_id:runId,reason:'invocation_completion_unconfirmed'}]};
const quote=x=>`'${String(x).replaceAll("'","'\\''")}'`;
async function exercise(t,poll,{post=ready}={}){
 const directory=await mkdtemp(join(tmpdir(),'drain-evidence-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const calls=[];const server=createServer(async(req,res)=>{
  let text='';for await(const chunk of req)text+=chunk;calls.push({method:req.method,path:req.url,body:text});
  const value=req.url==='/api/brain/tick/status'?{}:req.url==='/api/brain/tick/drain'?post:req.url==='/api/brain/tick/drain-status'?poll:{success:true,drain_id:drainId};
  res.setHeader('Content-Type','application/json');res.end(typeof value==='string'?value:JSON.stringify(value));
 });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const address=`http://127.0.0.1:${server.address().port}`;
 const helper=await readFile(join(root,'scripts/lib/brain-drain-client.sh'),'utf8');
 // Only the transport URL is redirected to this owned loopback server; the actual
 // client/parser/timeout/cancel functions run unchanged with real curl and Bash.
 const script=join(directory,'run.sh');await writeFile(script,`#!/bin/bash
set -uo pipefail
DRY_RUN=false
DRAIN_TIMEOUT_SECS=5
curl(){
 local args=() arg
 for arg in "$@"; do
  case "$arg" in http://localhost:5221/*) arg=${quote(address)}"\${arg#http://localhost:5221}";; esac
  args+=("$arg")
 done
 /usr/bin/curl "\${args[@]}"
}
docker(){ if [[ "$1" == container ]]; then echo cecelia-node-brain; else echo running; fi; }
sleep(){ :; }
${helper}
if drain_before_swap; then echo SWAP_REACHED; else echo SWAP_BLOCKED; exit 1; fi
`);
 const child=spawn('/bin/bash',[script],{env:{PATH:`${dirname(process.execPath)}:/usr/bin:/bin`,HOME:directory},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);const done=once(child,'exit');
 const timer=setTimeout(()=>child.kill('SIGTERM'),10000);let status;
 try{[status]=await done;}finally{clearTimeout(timer);}
 assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});
 const evidence=stderr.split('\n').filter(x=>x.startsWith('BRAIN_DRAIN_EVIDENCE ')).map(x=>JSON.parse(x.slice('BRAIN_DRAIN_EVIDENCE '.length)));
 return {stdout,stderr,status,calls,evidence};
}
test('真实loopback API和实际CLI超时保留本轮最后合法阻塞证据，仍拒绝切换并只取消本轮',async t=>{
 const r=await exercise(t,busy);assert.equal(r.status,1);assert.match(r.stdout,/SWAP_BLOCKED/);assert.match(r.stderr,/等待本机执行排空超时/);
 const last=r.evidence.at(-1);assert.ok(last,'超时日志必须保留严格校验后的阻塞证据');
 assert.equal(last.drain_id,drainId);assert.equal(last.remaining,1);assert.equal(last.independent_task_count,149);assert.equal(last.safe_to_swap,false);assert.ok(Number.isFinite(Date.parse(last.observed_at)));
 assert.deepEqual(last.blockers,busy.blockers);
 const cancels=r.calls.filter(x=>x.path.endsWith('/drain-cancel'));assert.equal(cancels.length,1);assert.equal(JSON.parse(cancels[0].body).drain_id,drainId);
});
test('严格校验后仅输出白名单字段，payload/标题/未知类型/任意reason及非法标识不能污染诊断',async t=>{
 const poison='DO_NOT_LOG_PRIVATE_PAYLOAD';const r=await exercise(t,{...busy,title:poison,payload:{secret:poison},blockers:[{kind:poison,reason:poison,task_id:poison,run_id:poison,title:poison,payload:{secret:poison}}]});
 assert.equal(r.status,1);assert.ok(r.evidence.length);assert.doesNotMatch(r.stdout+r.stderr,new RegExp(poison));
 assert.deepEqual(r.evidence.at(-1).blockers,[{kind:'unknown',reason:'unrecognized_reason'}]);
});
for(const [name,poll] of [['异代',{...busy,drain_id:otherId}],['畸形JSON','{bad'],['计数不匹配',{...busy,remaining:0}],['协议不符',{...busy,protocol:'legacy'}]])test(`真实API ${name}响应不能冒充本轮诊断或就绪证据`,async t=>{
 const r=await exercise(t,poll);assert.equal(r.status,1);assert.match(r.stdout,/SWAP_BLOCKED/);assert.ok(r.evidence.every(e=>e.drain_id===drainId&&e.remaining===0));assert.ok(!r.evidence.some(e=>e.blockers.some(b=>b.task_id===taskId)));
});
test('真实API合法同代就绪仍可切换且无取消；诊断不替代原许可',async t=>{
 const r=await exercise(t,ready);assert.equal(r.status,0);assert.match(r.stdout,/SWAP_REACHED/);assert.equal(r.calls.filter(x=>x.path.endsWith('/drain-cancel')).length,0);assert.ok(r.evidence.some(e=>e.safe_to_swap===true&&e.remaining===0));
});
