import {test,expect} from 'vitest';
import {verifySkillReadback,codexWorkerArgs} from '../../../scripts/commander-workflow/skill-protocol.mjs';
const request={task_id:'t',run_id:'r',run_tag:'tag',workflow:'101',activity:'collect',attempt:1,nonce:'n',checks:['policy','product']};
const valid=()=>({identity:Object.fromEntries(['task_id','run_id','run_tag','workflow','activity','attempt'].map(k=>[k,request[k]])),nonce:'n',outcome:'passed',checks:request.checks.map(id=>({id,status:'passed',evidence:[{source:'db:row',observation:{exists:true}}]})),output:{actual:42}});
test('独立readback核对完整identity、nonce、所有checks和真实证据',()=>{expect(verifySkillReadback(valid(),request).output).toEqual({actual:42});for(const mutate of [v=>v.identity.run_id='other',v=>v.nonce='old',v=>v.checks.pop(),v=>v.checks[0].evidence=[],v=>v.checks[0].evidence[0].observation={},v=>v.checks[0].status='unknown',v=>v.checks.push(v.checks[0])]){const v=valid();mutate(v);expect(()=>verifySkillReadback(v,request)).toThrow();}});
test('empty只在显式许可活动接受，提案输出不是真值',()=>{const v=valid();v.outcome='empty';expect(()=>verifySkillReadback(v,request)).toThrow();expect(verifySkillReadback(v,request,{allowEmpty:true}).output).toEqual({actual:42});});
test('同workflow新活动恢复同一Codex thread，拥有工具而非Judge',()=>{expect(codexWorkerArgs({args:['-c','sandbox_mode="danger-full-access"']},'thread-1','out')).toEqual(['-c','sandbox_mode="danger-full-access"','exec','resume','--json','--skip-git-repo-check','-o','out','thread-1','-']);});
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRuntime} from '../../../scripts/commander-workflow/skill-adapter.mjs';
test('真实监督进程执行工具worker，下一活动续同thread且只传播独立输出',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'commander-skill-'));fs.chmodSync(root,0o700);
 const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 fs.writeFileSync(path.join(root,'codex.cjs'),`const fs=require('fs');let prompt='';process.stdin.on('data',d=>prompt+=d);process.stdin.on('end',()=>{fs.appendFileSync('prompts.jsonl',JSON.stringify(prompt)+'\\n');fs.appendFileSync('envs.jsonl',JSON.stringify({key:process.env.COMMANDER_ACTIVITY_KEY,input:process.env.COMMANDER_ACTIVITY_INPUT_FILE})+'\\n');fs.appendFileSync('calls.jsonl',JSON.stringify(process.argv)+'\\n');fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],JSON.stringify({untrusted:999}));console.log(JSON.stringify({type:'thread.started',thread_id:'same-thread'}));});`);
 fs.writeFileSync(path.join(root,'check.cjs'),`let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const r=JSON.parse(s);console.log(JSON.stringify({identity:Object.fromEntries(['task_id','run_id','run_tag','workflow','activity','attempt'].map(k=>[k,r[k]])),nonce:r.nonce,outcome:'passed',checks:r.checks.map(id=>({id,status:'passed',evidence:[{source:'fixture-product',observation:{verified:true}}]})),output:{verified:42}}));});`);
 fs.writeFileSync(path.join(root,'skill.txt'),'执行当前活动');fs.writeFileSync(path.join(root,'tools.txt'),'允许工具');
 const checker={command:process.execPath,command_sha256:sha(process.execPath),entry:'check.cjs',start_checks:['authority'],required_checks:['product']};
 const profile={cwd:root,files:{'skill.txt':sha(path.join(root,'skill.txt')),'tools.txt':sha(path.join(root,'tools.txt')),'check.cjs':sha(path.join(root,'check.cjs'))},skill_runtime:{control_dir:'control',tools:'tools.txt',codex:{command:process.execPath,command_sha256:sha(process.execPath),args:[path.join(root,'codex.cjs')]},activities:{one:{skill:'skill.txt',checker},two:{skill:'skill.txt',checker}}}};
 const hashes=Object.fromEntries(Array.from({length:317},(_,i)=>['/frozen/program-'+i+'.mjs','a'.repeat(64)]));
 const run={task_id:'task',run_id:'run',input:{run_tag:'tag',keyword:'客户关键词',verification:{runtime_sha256:hashes,policy_version:29}},contract:{workflow:'fixture'}};
 try{const runtime=await createRuntime({profile,run});for(const key of ['one','two']){
  const activity={key,budget:{max_duration_s:10,heartbeat_s:1},runtime:{phase:'source',protocol:'json-stdio-v1',entry:'unused'}};
  const identity={task_id:'task',run_id:'run',activity_key:key,action_id:key},input={run_tag:'tag'};
  const output=await runtime.executeActivity(activity,input,{identity,cwd:root,deadlineMs:Date.now()+10000});
  expect(output.outputs).toEqual({verified:42});expect(output.execution_stopped).toBe(true);
  expect((await runtime.inspectActivity(activity,input,{identity})).result.outputs).toEqual({verified:42});
 }
 const calls=fs.readFileSync(path.join(root,'calls.jsonl'),'utf8').trim().split('\n').map(JSON.parse);expect(calls).toHaveLength(2);expect(calls[0]).not.toContain('resume');expect(calls[1]).toContain('resume');expect(calls[1]).toContain('same-thread');const envs=fs.readFileSync(path.join(root,'envs.jsonl'),'utf8').trim().split('\n').map(JSON.parse);expect(envs.map(e=>e.key)).toEqual(['one','two']);expect(JSON.parse(fs.readFileSync(envs[1].input,'utf8')).identity.activity_key).toBe('two');const fullInput=JSON.parse(fs.readFileSync(envs[1].input,'utf8'));expect(fullInput.context.verification.runtime_sha256).toEqual(hashes);const prompts=fs.readFileSync(path.join(root,'prompts.jsonl'),'utf8').trim().split('\n').map(JSON.parse);for(const prompt of prompts){expect(prompt).not.toContain('/frozen/program-316.mjs');expect(prompt).toContain('客户关键词');expect(prompt).toContain('runtime_sha256_not_inlined');}expect(prompts[1]).toContain(envs[1].input);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
},20000);

test('独立检查失败保留当时原件和nonce，过期身份仍拒绝',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'commander-readback-rejected-'));fs.chmodSync(root,0o700);
 const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 fs.writeFileSync(path.join(root,'check.cjs'),`let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const r=JSON.parse(s);console.log(JSON.stringify({identity:Object.fromEntries(['task_id','run_id','run_tag','workflow','activity','attempt'].map(k=>[k,r[k]])),nonce:r.nonce,outcome:'passed',checks:r.checks.map(id=>({id,status:'failed',evidence:[{source:'native-account-evidence.json',observation:{account_matches:true,age_s:202,max_age_s:120}}]})),output:{}}));});`);
 fs.writeFileSync(path.join(root,'skill.txt'),'当前活动');fs.writeFileSync(path.join(root,'tools.txt'),'冻结工具');
 const checker={command:process.execPath,command_sha256:sha(process.execPath),entry:'check.cjs',start_checks:['native_account_identity'],required_checks:['native_account_identity']};
 const profile={cwd:root,files:Object.fromEntries(['skill.txt','tools.txt','check.cjs'].map(file=>[file,sha(path.join(root,file))])),skill_runtime:{control_dir:'control',tools:'tools.txt',codex:{command:process.execPath,command_sha256:sha(process.execPath)},activities:{collect:{skill:'skill.txt',checker}}}};
 try{
  const runtime=await createRuntime({profile,run:{task_id:'task',run_id:'run',input:{run_tag:'tag'},contract:{workflow:'101'}}});
  await expect(runtime.checkActivity({key:'collect'},null,{phase:'start',input:{run_tag:'tag'}})).rejects.toThrow('skill_readback_unconfirmed');
  const checks=path.join(root,'control','run','checks');const files=fs.readdirSync(checks);expect(files).toHaveLength(1);
  const saved=JSON.parse(fs.readFileSync(path.join(checks,files[0]),'utf8'));
  expect(saved.status).toBe('rejected');expect(saved.reason).toBe('skill_readback_unconfirmed');
  expect(saved.request.phase).toBe('start');expect(saved.request.checks).toEqual(['native_account_identity']);
  expect(saved.observed.nonce).toBe(saved.request.nonce);expect(files[0]).toBe(saved.request.nonce+'.json');
  expect(saved.observed.checks[0]).toEqual({id:'native_account_identity',status:'failed',evidence:[{source:'native-account-evidence.json',observation:{account_matches:true,age_s:202,max_age_s:120}}]});
  expect(saved.verified).toBeUndefined();expect(saved.env).toBeUndefined();
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
