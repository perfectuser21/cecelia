import { it, expect } from 'vitest';
import { verificationRequest, readVerification, reconcileCommanderV2 } from '../commander-v2-control.js';
import { resolveDispatchRoute } from '../dispatch-route.js';
const e={task_id:'task',workflow_key:'report',run_id:'run',attempt:1,definition:{snapshot_sha256:'hash'}};
const v={task_id:'task',run_id:'run',attempt:1,definition_sha256:'hash',verdict:'PASS',assertions:[{name:'cleanup',pass:true}],evidence:['independent']};
it('独立research核验走限定OpenClaw，固定Codex且不借qiumi身份',()=>{
 const spec=verificationRequest({id:'task'},{envelope:e,delivery:{outputs:{path:'/remote/report.json'}},execution_location:{ssh_target:'worker@actual-host'}});
 expect(resolveDispatchRoute({task_type:'research',payload:spec.metadata}).route).toBe('openclaw-agent');
 expect(spec.metadata).toMatchObject({verification_transport:'openclaw-agent-v1',verification_agent:'skill-factory',model:'openai/gpt-6.1-sol'});
 expect(spec.metadata.run_id).toMatch(/^wfv-[0-9a-f-]{36}$/);expect(spec.metadata.run_id).not.toBe(e.run_id);
 expect(spec.metadata.qiumi_department).toBeUndefined();expect(spec.metadata.qiumi_source).toBeUndefined();
 expect(Date.parse(spec.metadata.verification_deadline_at)-Date.now()).toBeLessThanOrEqual(900000);
 expect(spec.metadata.workflow_verification.execution_location.ssh_target).toBe('worker@actual-host');
 expect(spec.description).toContain('只读SSH');
 expect(resolveDispatchRoute({task_type:'research',payload:{}}).route).toBe('codex-bridge');
});
it('仅解析固定核验子任务终态回调末行JSON，身份不匹配不接受PASS',()=>{
 const child={status:'completed',payload:{last_run_result:{result_summary:`报告\nWORKFLOW_VERIFICATION ${JSON.stringify(v)}`}}};
 expect(readVerification(child,{id:'task'},{envelope:e})).toEqual(v);
 expect(readVerification(child,{id:'other'},{envelope:e}).verdict).toBe('INCONCLUSIVE');
 expect(readVerification({...child,status:'in_progress'},{id:'task'},{envelope:e})).toBeNull();
});
it('公平巡检：20个无新证据blocked不会饿死第21个任务',async()=>{
 let clock=100;
 const tasks=Array.from({length:21},(_,i)=>{
  const id=`task-${i}`,run=`run-${i}`,verification={...v,task_id:id,run_id:run,verdict:'FAIL'};
  return {id,order:i,status:'in_progress',payload:{commander_protocol:'commander-v2'},result:{workflow_control:{phase:'blocked',verify_task_id:`verify-${i}`,envelope:{...e,run_id:run},verification}}};
 });
 const scanned=[],touched=[];
 const pool={connect:async()=>({...pool,release(){}}),async query(sql,params){
  if(sql.startsWith('SELECT id FROM tasks')){const rows=[...tasks].sort((a,b)=>a.order-b.order).slice(0,20);scanned.push(rows.map(t=>t.id));return {rows};}
  if(sql.startsWith('SELECT * FROM tasks')){
   if(params[0].startsWith('verify-')){const t=tasks[Number(params[0].slice(7))];return {rows:[{id:params[0],status:'completed',result:{workflow_verification:t.result.workflow_control.verification}}]};}
   return {rows:tasks.filter(t=>t.id===params[0])};
  }
  if(sql.startsWith('UPDATE tasks SET updated_at=NOW()')){const t=tasks.find(t=>t.id===params[0]);t.order=++clock;touched.push(t.id);}
  return {rows:[]};
 }};
 await reconcileCommanderV2(pool);await reconcileCommanderV2(pool);
 expect(scanned[0]).not.toContain('task-20');expect(scanned[1]).toContain('task-20');expect(touched).toContain('task-20');
});

it('OpenClaw receipt.text须匹配固定主run，缺真实模型或错run均不能PASS',()=>{
 const payload={verification_transport:'openclaw-agent-v1',run_id:'wfv-independent'};
 const child={task_type:'research',status:'completed_no_pr',payload,result:{receipt:{text:`WORKFLOW_VERIFICATION ${JSON.stringify(v)}`,verification_runtime:{provider:'openai',model:'gpt-6.1-sol',logical_run_id:payload.run_id,official_run_id:'official',rerouted:false}}}};
 expect(readVerification(child,{id:'task'},{envelope:e})).toEqual(v);
 expect(readVerification(child,{id:'task'},{envelope:{...e,run_id:'other'}}).verdict).toBe('INCONCLUSIVE');
 child.result.receipt.verification_runtime.model='fallback';expect(readVerification(child,{id:'task'},{envelope:e}).verdict).toBe('INCONCLUSIVE');
});

import { verificationPrompt, verificationRuntime } from '../commander-verification-transport.js';
it('正式请求提供固定业务身份JSON，官方gateway回执通过后仍拒核验task与运输run串位',()=>{
 const envelope={...e,run_id:'wfd-business'},control={envelope,delivery:{outputs:{path:'/run/report.json'}}};
 const spec=verificationRequest({id:'task'},control);
 const verifier={id:'independent-task',task_type:'research',status:'completed',payload:spec.metadata,description:spec.description};
 const prompt=verificationPrompt(verifier);
 const line=prompt.match(/^WORKFLOW_VERIFICATION (\{[^\n]+\})$/m)?.[1];
 expect(line).toBeDefined();
 const template=JSON.parse(line);
 expect(template).toMatchObject({task_id:'task',run_id:'wfd-business',attempt:1,definition_sha256:'hash',verdict:'INCONCLUSIVE'});
 const result={...template,verdict:'PASS',assertions:[{name:'cleanup',pass:true}],evidence:['independent-readback']};
 const official={status:'ok',runId:'official',result:{meta:{agentMeta:{provider:'openai',model:'gpt-6.1-sol',terminalReceipt:{runId:'official',requested:{provider:'openai',model:'gpt-6.1-sol'},effective:{provider:'openai',model:'gpt-6.1-sol'},rerouted:false,successfulToolNames:['gateway_exec']}}}}};
 const receipt={text:`WORKFLOW_VERIFICATION ${JSON.stringify(result)}`,verification_runtime:verificationRuntime(JSON.stringify(official),spec.metadata.run_id)};
 verifier.result={receipt};
 expect(readVerification(verifier,{id:'task'},control)).toEqual(result);
 for(const wrong of [{task_id:verifier.id},{run_id:spec.metadata.run_id}]) {
   const bad={...verifier,result:{receipt:{...receipt,text:`WORKFLOW_VERIFICATION ${JSON.stringify({...result,...wrong})}`}}};
   expect(readVerification(bad,{id:'task'},control).verdict).toBe('INCONCLUSIVE');
 }
 const old={...verifier,status:'failed',result:{receipt:{text:receipt.text}}}, before=JSON.stringify(old);
 expect(readVerification(old,{id:'task'},control).verdict).toBe('INCONCLUSIVE');
 expect(JSON.stringify(old)).toBe(before);
});

import { recoveryAllowed } from '../commander-v2-contract.js';
it('核验指引限定合同可观察副作用，独立证实本地隔离后FAIL仍可安全重试',()=>{
 const control={envelope:{...e,deadline_at:new Date(Date.now()+60000).toISOString(),recovery:{retry_safe:true,retry_on:['verification_failed'],max_attempts:2}},execution_stopped:true,delivery:{outputs:{},effects:[],cleanup:{completed:true}}};
 const request=verificationRequest({id:'task'},control);
 for(const text of ['冻结合同声明的外部提交和本地写路径','resources={}或effects=[]不能作为安全证据',
   'realpath','符号链接','固定helper','child终态','新attempt独立目录','旧失败证据',
   'POST/发布','源码摘要漂移','INCONCLUSIVE','effects_safe_to_retry','仍保持FAIL']) expect(request.description).toContain(text);
 const safe={...v,verdict:'FAIL',assertions:[{name:'artifact_hash',pass:false},{name:'effects_safe_to_retry',pass:true,evidence:['fixed-helper-sha','GET-only','realpath-in-run','official-child-ended','new-run-isolation']}],evidence:['independent-readback']};
 control.verification=readVerification({status:'completed',result:{workflow_verification:safe}},{id:'task'},control);
 expect(control.verification.verdict).toBe('FAIL');
 expect(recoveryAllowed(control,'verification_failed')).toBe(true);
 // 未知/有外部写而未独立读回时不应生成安全断言；空资源和空effects不会替代它。
 for(const reason of ['POST/发布未读回','越界或符号链接','源码摘要漂移','child终态未知']) {
  control.verification={...safe,assertions:[{name:'effects_safe_to_retry',pass:false,reason}]};
  expect(recoveryAllowed(control,'verification_failed')).toBe(false);
 }
 control.verification=safe;control.delivery.effects=[{key:'publish',status:'unknown'}];
 expect(recoveryAllowed(control,'verification_failed')).toBe(false);
});

it('缺正式运输确认准确标识核验单，不把真实模型正确的tool拒绝误报成模型错误',()=>{
 const child={id:'verify-rejected',task_type:'research',status:'failed',payload:{verification_transport:'openclaw-agent-v1',run_id:'wfv-rejected'},result:{receipt:{text:'sensitive raw diagnostic'}}};
 const result=readVerification(child,{id:'task'},{envelope:e});
 expect(result).toMatchObject({verdict:'INCONCLUSIVE',reason:'核验运输未获正式确认',verification_task_id:'verify-rejected'});
 expect(JSON.stringify(result)).not.toContain('sensitive');
});
