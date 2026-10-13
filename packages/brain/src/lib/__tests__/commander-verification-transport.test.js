import { it, expect, vi } from 'vitest';
import { verificationPrompt, verificationMetadata, verificationRuntime, verificationLaunch, isCommanderVerification } from '../commander-verification-transport.js';
const fixed={task_id:'parent',run_id:'business-run',attempt:1,definition_sha256:'hash',input_sha256:'input'};
function official(over={}) {return JSON.stringify({runId:'official',status:'ok',result:{meta:{agentMeta:{provider:'openai',model:'gpt-6.1-sol',terminalReceipt:{runId:'official',rerouted:false,requested:{provider:'openai',model:'gpt-6.1-sol'},effective:{provider:'openai',model:'gpt-6.1-sol'},successfulToolNames:['bash']}},executionTrace:{winnerProvider:'openai',winnerModel:'gpt-6.1-sol',fallbackUsed:false,...over}}}});}
it('实际官方回执的provider/model三处一致且无fallback才接受，文本自述不能替代',()=>{
 expect(verificationRuntime(official(),'wfv-logical')).toMatchObject({provider:'openai',model:'gpt-6.1-sol',logical_run_id:'wfv-logical'});
 for(const tail of [official({fallbackUsed:true}),official({winnerModel:'other'}),'model openai/gpt-6.1-sol'])expect(()=>verificationRuntime(tail,'wfv-logical')).toThrow();
});
it('独立transport身份不借qiumi，未知任务和过期预算零父任务查询',async()=>{
 const payload=verificationMetadata(fixed),task={id:'child',task_type:'research',payload};
 expect(isCommanderVerification(task)).toBe(true);expect(isCommanderVerification({...task,task_type:'qiumi_task'})).toBe(false);
 expect(payload.run_id).not.toBe(fixed.run_id);expect(payload.qiumi_department).toBeUndefined();
 const pool={query:vi.fn()};
 await expect(verificationLaunch(pool,{...task,payload:{...payload,verification_deadline_at:new Date(0).toISOString()}})).rejects.toThrow('预算');
 expect(pool.query).not.toHaveBeenCalled();
});
it('派发核验必须由父控制器绑定同子任务及完整固定主run身份',async()=>{
 const payload=verificationMetadata(fixed),task={id:'child',task_type:'research',payload};
 payload.workflow_verification.definition={snapshot_sha256:'hash'};
 const control={verify_task_id:'other',envelope:{task_id:'parent',run_id:'business-run',attempt:1,definition:{snapshot_sha256:'hash'},input_sha256:'input'}};
 const pool={query:vi.fn(async()=>({rows:[{id:'parent',status:'in_progress',result:{workflow_control:control}}]}))};
 await expect(verificationLaunch(pool,task)).rejects.toThrow('父控制器');
 control.verify_task_id='child';expect(await verificationLaunch(pool,task)).toMatchObject({department:'skill-factory',model:'openai/gpt-6.1-sol'});
 payload.workflow_verification.run_id='other';await expect(verificationLaunch(pool,task)).rejects.toThrow('固定');
});

it('缺trace时仍须官方requested/effective及rerouted=false证明，无证明拒绝',()=>{
 const value=JSON.parse(official());delete value.result.meta.executionTrace;
 expect(verificationRuntime(JSON.stringify(value),'logical').rerouted).toBe(false);
 delete value.result.meta.agentMeta.terminalReceipt.rerouted;
 expect(()=>verificationRuntime(JSON.stringify(value),'logical')).toThrow('无改派证据');
});

import { prepareVerificationRun } from '../commander-verification-transport.js';
it('独立run及租约必须同事务提交才允许调用方起跑，失败回滚且零提交',async()=>{
 const task={id:'child',payload:{run_id:'wfv-run',verification_transport:'openclaw-agent-v1',verification_deadline_at:new Date(Date.now()+900000).toISOString()}},params={department:'skill-factory',model:'openai/gpt-6.1-sol',timeoutSec:600};
 const db={query:vi.fn(async sql=>({rows:sql.startsWith('SELECT status,payload')?[{status:'queued',payload:task.payload}]:sql.startsWith('SELECT task_id')?[{task_id:'child',status:'running',ended_at:null}]:[]})),release:vi.fn()};
 const pool={connect:async()=>db},start=vi.fn(async()=>({id:'run-row'})),lease=vi.fn(async()=>({lease_until:new Date(Date.now()+900000).toISOString()}));
 await prepareVerificationRun(pool,task,params,{startRun:start,setLease:lease});
 expect(db.query).toHaveBeenCalledWith('COMMIT');expect(start).toHaveBeenCalledWith(expect.objectContaining({taskId:'child',runId:'wfv-run'}),{pool:db});
 db.query.mockClear();lease.mockResolvedValue(null);
 await expect(prepareVerificationRun(pool,task,params,{startRun:start,setLease:lease})).rejects.toThrow('租约');
 expect(db.query).toHaveBeenCalledWith('ROLLBACK');expect(db.query).not.toHaveBeenCalledWith('COMMIT');
});

it('真实CLI漂亮打印超过100个对象仍保留顶层回执，允许前置日志且不放宽模型门禁',()=>{
 const value=JSON.parse(official());
 value.result.meta.executionTrace.attempts=Array.from({length:193},()=>({provider:'openai',model:'gpt-6.1-sol',result:'success',stage:'assistant'}));
 const pretty=JSON.stringify(value,null,2);
 expect([...pretty.matchAll(/^[ \t]*\{/gm)].length).toBeGreaterThan(100);
 for(const prefix of ['', 'OpenClaw starting\n']) expect(verificationRuntime(prefix+pretty,'wfv-logical')).toMatchObject({official_run_id:'official',logical_run_id:'wfv-logical'});
 value.result.meta.executionTrace.attempts[150].model='other';
 expect(()=>verificationRuntime(JSON.stringify(value,null,2),'wfv-logical')).toThrow('fallback');
});

it('只读核验明确禁用subagents全部动作，官方RPC只读回固定child终态',()=>{
 const task={id:'verification-task',payload:verificationMetadata(fixed),description:'固定合同'};
 const prompt=verificationPrompt(task);
 for(const text of ['verification_task_id=verification-task','verification_transport_run_id=wfv-',
   '禁止subagents全部动作（包括wait/list）','sessions_spawn','sessions_send','gateway_exec',
   'openclaw gateway call agent.wait','child_run_id','endedAt','INCONCLUSIVE','wf-status']) expect(prompt).toContain(text);
});
it.each(['subagents','sessions_spawn','sessions_send'])('严格拒绝%s，即使核验者称仅wait/list只读', tool=>{
 const value=JSON.parse(official());
 value.result.meta.agentMeta.terminalReceipt.successfulToolNames=['gateway_exec'];
 expect(verificationRuntime(JSON.stringify(value),'wfv-logical').official_run_id).toBe('official');
 value.result.meta.agentMeta.terminalReceipt.successfulToolNames.push(tool);
 expect(()=>verificationRuntime(JSON.stringify(value),'wfv-logical')).toThrow('核验不能委托');
});
