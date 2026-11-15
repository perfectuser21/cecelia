import {test,expect,afterEach} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
const moduleFile=fileURLToPath(new URL('../commander-usage-ledger.js',import.meta.url));
const api=()=>import(pathToFileURL(moduleFile).href);
const roots=[];afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const identity={task_id:'task-1',run_id:'run-1'};
const meta={role:'activity',activity_key:'write',action_id:'a1',attempt:1,provider:'openai',model:'fixture-model',auth_mode:'api-only'};
const usage={input_tokens:100,output_tokens:20,cached_input_tokens:40,cache_write_input_tokens:0,reasoning_output_tokens:5};
const pricing={provider:'openai',model:'fixture-model',version:'frozen-1',source:'fixture-only',input_per_million:10,cached_input_per_million:1,output_per_million:20};
async function fixture(policy={}){const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'usage-ledger-'));roots.push(root);const directory=path.join(root,'ledger');return {root,directory,ledger:(await api()).createRunLedger({directory,identity,policy})};}
test('持久call记录CLI准备与完整usage，缓存推理不重复累加，读回不重计',async()=>{
 const {directory,ledger}=await fixture({pricing});const started=ledger.beginCall(meta);
 expect(started.call_id).toMatch(/^[a-f0-9-]{36}$/);expect(fs.statSync(directory).mode&0o777).toBe(0o700);
 const incomplete=ledger.snapshot();expect(incomplete.pending_call_ids).toEqual([started.call_id]);expect(incomplete.summary.total_tokens).toBeNull();
 const value={status:'completed',dispatch_status:'dispatched',usage};ledger.finishCall(started.call_id,value);ledger.finishCall(started.call_id,value);
 const out=(await api()).readRunLedger({directory,identity});expect(out.calls).toHaveLength(1);expect(out.summary.total_tokens).toBe(120);expect(out.summary.cost.estimated_usd).toBeCloseTo(0.00104);expect(out.summary.cost.actual_usd).toBe(0);
 expect(out.calls[0].prepared_at_ms).toBe(started.started_at_ms);expect(out.calls[0].duration_ms).toBeGreaterThanOrEqual(0);expect(out.coverage.complete).toBe(true);
 expect(()=>ledger.finishCall(started.call_id,{...value,usage:{...usage,output_tokens:21}})).toThrow('usage_ledger_terminal_conflict');
 expect((await api()).createRunLedger({directory,identity,policy:{pricing}}).snapshot().summary.total_tokens).toBe(120);
});
test('每次物理CLI重试新call，失败与中断不消失，未知不填零',async()=>{
 const {ledger}=await fixture();const a=ledger.beginCall(meta),b=ledger.beginCall({...meta,role:'commander'});expect(a.call_id).not.toBe(b.call_id);
 ledger.finishCall(a.call_id,{status:'failed',usage:null,reason_code:'provider_failed'});
 const out=ledger.snapshot();expect(out.calls).toHaveLength(2);expect(out.pending_call_ids).toEqual([b.call_id]);expect(out.summary.total_tokens).toBeNull();expect(out.summary.cost.kind).toBe('unknown');expect(out.summary.unknown_usage_calls).toBe(2);
});
test('attempt按动作稳定，恢复观察独立计时，不增加原执行attempt',async()=>{
 const {ledger}=await fixture();const a=ledger.beginAttempt({activity_key:'write',action_id:'a1',attempt:1,kind:'agent',started_at_ms:100});
 expect(ledger.beginAttempt({activity_key:'write',action_id:'a1',attempt:1,kind:'agent'}).attempt_id).toBe(a.attempt_id);
 ledger.finishAttempt(a.attempt_id,{status:'completed',ended_at_ms:150});
 const o=ledger.beginObservation({kind:'recovery_readback',attempt_id:a.attempt_id,activity_key:'write',started_at_ms:200});ledger.endObservation(o.observation_id,{status:'passed',ended_at_ms:230});
 const out=ledger.snapshot();expect(out.attempts).toHaveLength(1);expect(out.attempts[0].duration_ms).toBe(50);expect(out.observations[0].duration_ms).toBe(30);expect(out.summary.cost.kind).toBe('not_applicable');
 expect(()=>ledger.finishAttempt(a.attempt_id,{status:'failed',ended_at_ms:150})).toThrow('usage_ledger_terminal_conflict');
});
test('normalizeTurns汇总多turn且不把缺缓存/推理伪装零',async()=>{
 const {normalizeTurns}=await api();expect(normalizeTurns([])).toBeNull();
 const out=normalizeTurns([{type:'thread.started'},{type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:40,output_tokens:20}},{type:'turn.completed',usage:{input_tokens:10,cached_input_tokens:4,output_tokens:2}}]);
 expect(out).toMatchObject({input_tokens:110,output_tokens:22,cached_input_tokens:44,total_tokens:132,reasoning_output_tokens:null});
 expect(normalizeTurns([{type:'turn.completed',usage:{input_tokens:1}}])).toMatchObject({input_tokens:1,output_tokens:null,total_tokens:null});
 expect(()=>normalizeTurns([{type:'turn.completed',usage:{input_tokens:2,output_tokens:1,cached_input_tokens:3}}])).toThrow('usage_ledger_usage_invalid');
});
test.each(['max_total_tokens','max_cost_usd'])('已有incomplete且配置%s时预算failclosed',async field=>{
 const {ledger}=await fixture({[field]:100});expect(ledger.checkBudget().allowed).toBe(true);ledger.beginCall(meta);
 expect(ledger.checkBudget().allowed).toBe(false);expect(()=>ledger.beginCall(meta)).toThrow(field==='max_total_tokens'?'usage_token_budget_unknown':'usage_cost_budget_unknown');
});
test('已到token上限拒新模型；明确not_started不伪造usage也不占未知额度',async()=>{
 const {ledger}=await fixture({max_total_tokens:120});const a=ledger.beginCall(meta);ledger.finishCall(a.call_id,{status:'not_started',dispatch_status:'not_started',usage:null});
 expect(ledger.snapshot().calls[0].usage).toBeNull();expect(ledger.checkBudget().allowed).toBe(true);
 const b=ledger.beginCall(meta);ledger.finishCall(b.call_id,{status:'completed',usage});expect(()=>ledger.beginCall(meta)).toThrow('usage_token_budget_exceeded');
});
test('actual与estimated费用分列，冻结费率只用于匹配provider/model',async()=>{
 const {ledger}=await fixture({max_cost_usd:0.5,pricing});const a=ledger.beginCall(meta);ledger.finishCall(a.call_id,{status:'completed',usage,cost_usd:0.5});expect(ledger.snapshot().summary.cost).toMatchObject({actual_usd:0.5,estimated_usd:0,total_usd:0.5});expect(()=>ledger.beginCall(meta)).toThrow('usage_cost_budget_exceeded');
 const {ledger:other}=await fixture({pricing});const b=other.beginCall({...meta,model:'other'});other.finishCall(b.call_id,{status:'completed',usage});expect(other.snapshot().summary.cost.kind).toBe('unknown');
});
test('订阅不记实付0，缺核心usage或缓存分项不能估价',async()=>{
 const {ledger}=await fixture({pricing});const a=ledger.beginCall({...meta,auth_mode:'subscription'});
 expect(()=>ledger.finishCall(a.call_id,{status:'completed',usage,cost_usd:0})).toThrow('usage_ledger_cost_invalid');ledger.finishCall(a.call_id,{status:'completed',usage});expect(ledger.snapshot().summary.cost.kind).toBe('unknown');
 const {ledger:other}=await fixture({pricing});const b=other.beginCall(meta);other.finishCall(b.call_id,{status:'completed',usage:{input_tokens:10,output_tokens:1}});expect(other.snapshot().summary.cost.kind).toBe('unknown');
});
test('身份/政策漂移与非白名单字段拒绝；时间不能逆行',async()=>{
 const {directory,ledger}=await fixture();const {createRunLedger}=await api();expect(()=>createRunLedger({directory,identity:{...identity,run_id:'other'}})).toThrow('usage_ledger_identity_conflict');expect(()=>createRunLedger({directory,identity,policy:{max_total_tokens:1}})).toThrow('usage_ledger_policy_conflict');
 expect(()=>ledger.beginCall({...meta,prompt:'must-not-persist'})).toThrow('usage_ledger_metadata_invalid');const a=ledger.beginCall({...meta,started_at_ms:100});expect(()=>ledger.finishCall(a.call_id,{status:'completed',usage,ended_at_ms:99})).toThrow('usage_ledger_time_invalid');
});
test('只读缺账ENOENT且不创建；宽权限和符号链接不得读写',async()=>{
 const {directory,root,ledger}=await fixture();const {readRunLedger,createRunLedger}=await api();const missing=path.join(root,'missing');expect(()=>readRunLedger({directory:missing,identity})).toThrow();expect(fs.existsSync(missing)).toBe(false);
 fs.chmodSync(directory,0o755);expect(()=>ledger.snapshot()).toThrow('usage_ledger_directory_unprotected');fs.chmodSync(directory,0o700);
 const alias=path.join(root,'alias');fs.symlinkSync(directory,alias);expect(()=>createRunLedger({directory:alias,identity})).toThrow('usage_ledger_directory_unprotected');
 const call=ledger.beginCall(meta),file=path.join(directory,'calls',call.call_id+'.json');fs.chmodSync(file,0o644);expect(()=>ledger.snapshot()).toThrow('usage_ledger_file_unprotected');
});
test('晚到终态合并旧DBOS快照，不覆盖冲突、不重复算费',async()=>{
 const {ledger}=await fixture({pricing});const a=ledger.beginCall(meta),old=ledger.snapshot();ledger.finishCall(a.call_id,{status:'completed',usage});const current=ledger.snapshot(),{mergeLedgerSnapshots}=await api();
 const out=mergeLedgerSnapshots(old,current);expect(out.summary.total_tokens).toBe(120);expect(out.pending_call_ids).toEqual([]);expect(mergeLedgerSnapshots(current,old).summary).toEqual(out.summary);
 const bad=structuredClone(current);bad.calls[0].usage.output_tokens=99;expect(()=>mergeLedgerSnapshots(current,bad)).toThrow('usage_ledger_terminal_conflict');
});
test('残锁failclosed但只读完整事实仍可用',async()=>{
 const {directory,ledger}=await fixture();fs.writeFileSync(path.join(directory,'.write-lock'),JSON.stringify({owner:'unknown'}),{mode:0o600});
 expect(()=>ledger.beginCall(meta)).toThrow('usage_ledger_busy');expect(ledger.snapshot().calls).toEqual([]);expect(ledger.checkBudget()).toMatchObject({allowed:false,reason_code:'usage_ledger_busy'});
});
test('跨独立进程预算检查与prepared同一原子占位，只放行一次',async()=>{
 const {directory,root}=await fixture({max_total_tokens:100});const gate=path.join(root,'go');
 const script=`import fs from 'node:fs';import {createRunLedger} from ${JSON.stringify(pathToFileURL(moduleFile).href)};while(!fs.existsSync(${JSON.stringify(gate)}))await new Promise(r=>setTimeout(r,2));try{const l=createRunLedger({directory:${JSON.stringify(directory)},identity:${JSON.stringify(identity)},policy:{max_total_tokens:100}});l.beginCall(${JSON.stringify(meta)});console.log('allowed');}catch(e){console.log(e.message);}`;
 const children=Array.from({length:2},()=>{const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);return new Promise(resolve=>child.once('close',code=>resolve({code,stdout:stdout.trim(),stderr})));});
 fs.writeFileSync(gate,'go');const out=await Promise.all(children);expect(out.every(x=>x.code===0&&x.stderr==='')).toBe(true);expect(out.filter(x=>x.stdout==='allowed')).toHaveLength(1);expect(out.filter(x=>/usage_(?:ledger_busy|token_budget_unknown)/.test(x.stdout))).toHaveLength(1);
});
