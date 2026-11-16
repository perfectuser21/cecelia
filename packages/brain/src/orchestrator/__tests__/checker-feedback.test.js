import {test,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRuntime} from '../../../scripts/commander-workflow/skill-adapter.mjs';
import {verifySkillFailure} from '../../../scripts/commander-workflow/skill-protocol.mjs';
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(mode='normal'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'checker-feedback-'));fs.chmodSync(root,0o700);
 fs.writeFileSync(path.join(root,'codex.cjs'),`const fs=require('fs');let prompt='';process.stdin.on('data',d=>prompt+=d);process.stdin.on('end',()=>{const input=JSON.parse(fs.readFileSync(process.env.COMMANDER_ACTIVITY_INPUT_FILE));fs.appendFileSync('calls.jsonl',JSON.stringify({argv:process.argv,prompt,input})+'\\n');fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify({answer:input.identity.attempt===2?42:41}));console.log(JSON.stringify({type:'thread.started',thread_id:'original-thread'}));});`);
 fs.writeFileSync(path.join(root,'check.cjs'),`const fs=require('fs');let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const r=JSON.parse(s);fs.appendFileSync('checks.jsonl',JSON.stringify(r)+'\\n');const fail=r.phase==='end'&&r.attempt===1;const out={identity:Object.fromEntries(['task_id','run_id','run_tag','workflow','activity','attempt'].map(k=>[k,r[k]])),nonce:r.nonce,outcome:fail?'failed':'passed',retryable:true,external_effect:'none',checks:r.checks.map(id=>({id,status:fail?'failed':'passed',expected:42,actual:fail?41:42,reason:'answer 应为42',evidence:[{source:'product.json',observation:{answer:fail?41:42}}]})),output:{answer:fail?41:42}};if(fail&&${JSON.stringify(mode)}==='bad_identity')out.identity.run_id='other';if(fail&&${JSON.stringify(mode)}==='missing_detail')delete out.checks[0].actual;if(fail&&${JSON.stringify(mode)}==='unknown_effect')out.external_effect='unknown';console.log(JSON.stringify(out));});`);
 fs.writeFileSync(path.join(root,'skill.txt'),'交付答案42');fs.writeFileSync(path.join(root,'tools.txt'),'允许读取和修复本轮产物');
 const checker={command:process.execPath,command_sha256:sha(process.execPath),entry:'check.cjs',start_checks:['authority'],required_checks:['answer']};
 const activity={key:'answer',order:1,budget:{max_duration_s:10,heartbeat_s:1},failure:{empty_ok:[],retryable:[],fatal:[],needs_human:{cases:[]}},runtime:{executor_kind:'agent',phase:'source',protocol:'json-stdio-v1',entry:'work.mjs'}};
 const profile={cwd:root,files:Object.fromEntries(['skill.txt','tools.txt','check.cjs'].map(f=>[f,sha(path.join(root,f))])),skill_runtime:{control_dir:'control',tools:'tools.txt',codex:{command:process.execPath,command_sha256:sha(process.execPath),args:[path.join(root,'codex.cjs')]},activities:{answer:{skill:'skill.txt',checker}}}};
 const run={task_id:'task',run_id:'run',input:{run_tag:'tag'},contract:{workflow:'fixture',activities:[activity]}};
 const opts=attempt=>({identity:{task_id:'task',run_id:'run',activity_key:'answer',action_id:'answer-'+attempt,...(attempt>1?{attempt}:{})},cwd:root,deadlineMs:Date.now()+10000});
 const calls=()=>fs.existsSync(path.join(root,'calls.jsonl'))?fs.readFileSync(path.join(root,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse):[];
 return {root,profile,run,activity,opts,calls,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('独立checker失败明细回传同thread，第二轮真实监督执行修复后通过',async()=>{
 const f=fixture();try{
  const runtime=await createRuntime(f),input={run_tag:'tag'};
  const first=await runtime.executeActivity(f.activity,input,f.opts(1));
  expect(first.status).toBe('needs_review');expect(first.checker_feedback).toMatchObject({protocol:'checker-feedback/v1',activity_key:'answer',attempt:1,thread_id:'original-thread',previous_proposal:{answer:41},retryable:true,external_effect:'none',failed_checks:[{id:'answer',expected:42,actual:41,reason:'answer 应为42'}]});
  expect(fs.existsSync(first.checker_feedback.evidence_ref)).toBe(true);
  expect(await runtime.checkActivity(f.activity,first,{phase:'end',input})).toMatchObject({verdict:'fail'});
  const secondInput={run_tag:'tag',execution_attempt:2,checker_feedback:first.checker_feedback};
  const second=await runtime.executeActivity(f.activity,secondInput,f.opts(2));expect(second.status).toBe('completed');expect(second.outputs).toEqual({answer:42});
  expect((await runtime.inspectActivity(f.activity,secondInput,f.opts(2))).result.outputs).toEqual({answer:42});
  const calls=f.calls();expect(calls).toHaveLength(2);expect(calls[1].argv).toContain('resume');expect(calls[1].argv).toContain('original-thread');expect(calls[1].prompt).toContain('answer 应为42');expect(calls[1].prompt).toContain('"answer":41');
  const checks=fs.readFileSync(path.join(f.root,'checks.jsonl'),'utf8').trim().split('\n').map(JSON.parse);expect(checks.filter(c=>c.attempt===2)).toHaveLength(3);
 }finally{f.cleanup();}
},20000);
test.each(['missing','changed'])('原thread%s时返工拒绝启动新Agent',async mode=>{
 const f=fixture();try{const runtime=await createRuntime(f),first=await runtime.executeActivity(f.activity,{run_tag:'tag'},f.opts(1));expect(first.checker_feedback).toBeDefined();const file=path.join(f.root,'control','run','thread.json');if(mode==='missing')fs.unlinkSync(file);else fs.writeFileSync(file,JSON.stringify({run_id:'run',thread_id:'different-thread'}));
 const result=await runtime.executeActivity(f.activity,{run_tag:'tag',execution_attempt:2,checker_feedback:first.checker_feedback},f.opts(2));expect(result.status).toBe('needs_review');expect(f.calls()).toHaveLength(1);
 }finally{f.cleanup();}
},20000);
test.each(['bad_identity','missing_detail'])('checker %s 不产生可返工反馈',async mode=>{const f=fixture(mode);try{const runtime=await createRuntime(f),first=await runtime.executeActivity(f.activity,{run_tag:'tag'},f.opts(1));expect(first.status).toBe('needs_review');expect(first.checker_feedback).toBeUndefined();}finally{f.cleanup();}},20000);
test('副作用未知的失败保留诊断但不给返工许可',async()=>{const f=fixture('unknown_effect');try{const runtime=await createRuntime(f),first=await runtime.executeActivity(f.activity,{run_tag:'tag'},f.opts(1));expect(first.checker_feedback).toMatchObject({retryable:false,external_effect:'unknown'});expect(first.external_effect).toBe('unknown');}finally{f.cleanup();}},20000);
test('可修复失败协议拒绝错轮、旧nonce、漏check、空证据和含糊失败项',()=>{
 const req={task_id:'task',run_id:'run',run_tag:'tag',workflow:'wf',activity:'answer',attempt:2,nonce:'current',checks:['answer']};
 const value={identity:Object.fromEntries(['task_id','run_id','run_tag','workflow','activity','attempt'].map(k=>[k,req[k]])),nonce:req.nonce,outcome:'failed',retryable:true,external_effect:'none',checks:[{id:'answer',status:'failed',expected:42,actual:41,reason:'answer 应为42',evidence:[{source:'product.json',observation:{answer:41}}]}]};
 expect(verifySkillFailure(value,req)).toEqual(value);
 for(const mutate of [v=>v.identity.attempt=1,v=>v.nonce='old',v=>v.checks=[],v=>v.checks[0].evidence=[],v=>v.checks[0].evidence[0].observation={},v=>delete v.checks[0].expected,v=>delete v.checks[0].actual,v=>v.checks[0].reason='',v=>v.checks[0].status='unknown',v=>v.checks[0].status='passed',v=>delete v.external_effect,v=>delete v.retryable]){
  const candidate=structuredClone(value);mutate(candidate);expect(()=>verifySkillFailure(candidate,req)).toThrow('skill_readback_unconfirmed');
 }
});
