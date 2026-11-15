import {test,expect,afterEach,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const judge=vi.hoisted(()=>vi.fn());
vi.mock('../../../scripts/coding-workflow/lib/codex-judge.mjs',()=>({callCodexJudge:judge}));
import {createCodexCommander} from '../commander-codex.js';
import {createRuntime} from '../../../scripts/commander-workflow/skill-adapter.mjs';
const roots=[];
afterEach(()=>{judge.mockReset();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function temporary(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'commander-usage-wiring-'));fs.chmodSync(root,0o700);roots.push(root);return root;}
function ledger(root){
 const directory=path.join(root,'ledger');fs.mkdirSync(directory,{mode:0o700});
 return {directory,policy:{},identity:{task_id:'task',run_id:'run'},
  beginCall:vi.fn(()=>{const call_id=randomUUID(),directory=path.join(root,'ledger',call_id);fs.mkdirSync(directory,{mode:0o700});return {call_id,directory,started_at_ms:Date.now()};}),finishCall:vi.fn(),
  beginAttempt:vi.fn(()=>({attempt_id:'one-attempt'})),finishAttempt:vi.fn(),
  beginObservation:vi.fn(()=>({observation_id:randomUUID()})),endObservation:vi.fn(),checkBudget:vi.fn(()=>({allowed:true}))};
}
const events=[{type:'thread.started',thread_id:'t'},{type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:40,output_tokens:7}}];
function native(options,rows=events){fs.writeFileSync(options.transcriptPath,rows.map(JSON.stringify).join('\n')+'\n');}
test('Commander每次物理调用单独原生证据，JSON非法仍记token且全局文件不重复计费',async()=>{
 const root=temporary(),book=ledger(root),global=path.join(root,'all.jsonl');
 judge.mockImplementation(async(_request,options)=>{native(options);return {content:judge.mock.calls.length===1?'not-json':'{"action":"complete"}',usage:{input_tokens:999999}};});
 const decide=createCodexCommander({model:'gpt-6-astra',codexHome:root,transcriptPath:global,ledger:book});
 const req={sequence:1,run_id:'run',input:{}};
 await expect(decide(req,{timeoutMs:1000})).rejects.toThrow();await expect(decide({...req,sequence:2},{timeoutMs:1000})).resolves.toEqual({action:'complete'});
 expect(book.beginCall).toHaveBeenCalledTimes(2);expect(book.beginCall.mock.calls.map(([m])=>m.decision_sequence)).toEqual([1,2]);
 expect(book.beginCall.mock.calls[0][0]).toMatchObject({role:'commander',provider:'codex',model:'gpt-6-astra'});
 expect(book.finishCall).toHaveBeenCalledTimes(2);
 for(const [,result]of book.finishCall.mock.calls){expect(result.usage).toMatchObject({input_tokens:100,cached_input_tokens:40,output_tokens:7,total_tokens:107});expect(result.dispatch_status).toBe('dispatched');}
 expect(book.finishCall.mock.calls[0][1].status).toBe('failed');expect(book.finishCall.mock.calls[1][1].status).toBe('completed');
 expect(judge.mock.calls[0][1].transcriptPath).not.toBe(judge.mock.calls[1][1].transcriptPath);expect(judge.mock.calls[0][1].transcriptPath).not.toBe(global);
 expect(fs.readFileSync(global,'utf8').trim().split('\n')).toHaveLength(4);
});
test('Commander失败原生用量保留，预算拒绝不调用模型且reason不改写',async()=>{
 const root=temporary(),book=ledger(root);
 judge.mockImplementation(async(_r,o)=>{native(o);throw Error('judge_codex_failed');});
 const decide=createCodexCommander({model:'gpt-6-astra',codexHome:root,transcriptPath:path.join(root,'all'),ledger:book});
 await expect(decide({sequence:1,input:{}},{timeoutMs:1000})).rejects.toThrow('judge_codex_failed');
 expect(book.finishCall).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({status:'failed',usage:expect.objectContaining({total_tokens:107})}));
 book.beginCall.mockImplementation(()=>{throw Error('usage_token_budget_exceeded');});
 await expect(decide({sequence:2,input:{}},{timeoutMs:1000})).rejects.toThrow('usage_token_budget_exceeded');expect(judge).toHaveBeenCalledTimes(1);
});
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function codeFixture(){
 const root=temporary(),book=ledger(root);
 fs.writeFileSync(path.join(root,'work.cjs'),`let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const i=JSON.parse(s);console.log(JSON.stringify({schema_version:1,run_tag:i.run_tag,status:'completed',outputs:{done:true},metrics:{},evidence:[],execution_stopped:i.unknown!==true}));});`);
 fs.writeFileSync(path.join(root,'check.cjs'),`let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const r=JSON.parse(s);console.log(JSON.stringify({identity:Object.fromEntries(['task_id','run_id','run_tag','workflow','activity','attempt'].map(k=>[k,r[k]])),nonce:r.nonce,outcome:'passed',checks:r.checks.map(id=>({id,status:'passed',evidence:[{source:'fixture',observation:{exists:true}}]})),output:{done:true}}));});`);
 const profile={cwd:root,files:Object.fromEntries(['work.cjs','check.cjs'].map(f=>[f,sha(path.join(root,f))])),skill_runtime:{control_dir:'control',activities:{cleanup:{checker:{command:process.execPath,command_sha256:sha(process.execPath),entry:'check.cjs',start_checks:['authority'],required_checks:['product']}}}}};
 const activity={key:'cleanup',budget:{max_duration_s:5,heartbeat_s:1},runtime:{phase:'finalize',executor_kind:'code',entry:'work.cjs',protocol:'json-stdio-v1'}},run={task_id:'task',run_id:'run',input:{run_tag:'tag'},contract:{workflow:'fixture'}};
 return {root,profile,run,ledger:book,activity,input:{run_tag:'tag'},options:{identity:{task_id:'task',run_id:'run',activity_key:'cleanup',action_id:'action'},cwd:root,deadlineMs:Date.now()+5000}};
}
test('Code执行只记一次attempt，恢复只记readback，checker观察独立，预算耗尽仍可清理',async()=>{
 const f=codeFixture();f.ledger.checkBudget.mockReturnValue({allowed:false,reason_code:'usage_token_budget_exceeded'});
 const runtime=await createRuntime(f),out=await runtime.executeActivity(f.activity,f.input,f.options);
 await runtime.checkActivity(f.activity,out,{phase:'end',input:f.input});await runtime.inspectActivity(f.activity,f.input,f.options);
 expect(f.ledger.beginAttempt).toHaveBeenCalledTimes(1);expect(f.ledger.beginAttempt).toHaveBeenCalledWith({activity_key:'cleanup',action_id:'action',attempt:1,kind:'code'});
 expect(f.ledger.finishAttempt).toHaveBeenCalledTimes(1);expect(f.ledger.finishAttempt.mock.calls[0][1].status).toBe('completed');
 expect(f.ledger.beginObservation.mock.calls.map(([m])=>m.kind)).toEqual(['checker','checker','recovery_readback']);
 expect(f.ledger.endObservation).toHaveBeenCalledTimes(3);expect(f.ledger.beginCall).not.toHaveBeenCalled();expect(f.ledger.checkBudget).not.toHaveBeenCalled();
});
test('未知执行不能把attempt记成完成，恢复不增尝试',async()=>{
 const f=codeFixture(),runtime=await createRuntime(f),input={...f.input,unknown:true};
 await runtime.executeActivity(f.activity,input,f.options);await runtime.inspectActivity(f.activity,input,f.options);
 expect(f.ledger.beginAttempt).toHaveBeenCalledTimes(1);
 expect(f.ledger.finishAttempt.mock.calls.every(([,r])=>r.status==='unknown')).toBe(true);
 expect(f.ledger.beginObservation.mock.calls.some(([m])=>m.kind==='recovery_readback')).toBe(true);
});
