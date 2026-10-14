import { expect, it, vi } from 'vitest';
import { dispatchWorkflowCommanderTasks, reapWorkflowCommanderRuns } from '../workflow-commander-dispatch.js';
import { buildTerminalUpdate } from '../task-terminal.js';
import { reapExpiredLeases } from '../task-lease.js';
const task = { id:'aaaaaaaa-1111-2222-3333-444444444444', task_type:'workflow_dispatch', status:'in_progress', run_id:'wfd-test', payload:{commander_protocol:'commander-v2',run_id:'wfd-test'} };
it('旧reaper不能以自述completed终结v2或释放锁', async()=>{
 const pool={query:vi.fn(async()=>({rows:[task]}))}, sshProbe=vi.fn(async()=> 'EXIT=0\nCOMMANDER_RESULT {"status":"completed"}'), releaseLock=vi.fn();
 await reapWorkflowCommanderRuns(pool,{sshProbe,releaseLock});
 expect(sshProbe).not.toHaveBeenCalled(); expect(releaseLock).not.toHaveBeenCalled();
 expect(pool.query).toHaveBeenCalledTimes(1);
});
it('旧租约过期不误判v2死亡、不放锁、不重排',async()=>{
 const pool={query:vi.fn(async()=>({rows:[{...task,task_id:task.id,source:'brain',expired_sec:99999}]}))},probe=vi.fn(async()=> 'unknown');
 const result=await reapExpiredLeases(pool,{probe});
 expect(result.failed).toBe(0);expect(probe).not.toHaveBeenCalled();expect(pool.query).toHaveBeenCalledTimes(1);
});
it('通用终态SQL必须以持久控制器终判为闸',()=>{
 const sql=buildTerminalUpdate(task.id,'completed').sql;
 expect(sql).toContain('commander-v2');expect(sql).toContain('workflow_control');expect(sql).toContain('final');
});
it('未知显式协议不得降级为旧手机派发',async()=>{
 const queued={...task,status:'queued',payload:{commander_protocol:'commander-v99',workflow_key:'phone'}};
 const pool={query:vi.fn(async sql=>({rows:/SELECT|RETURNING/.test(sql)?[queued]:[]}))};
 const lockGate=vi.fn(async()=>({pass:true})),sshDispatch=vi.fn(async()=> 'DISPATCHED');
 await dispatchWorkflowCommanderTasks(pool,{lockGate,sshDispatch,resolveConfig:()=>({commander:{capability:'x',machine:'x',biz:'x'},device:{serial:'x',profile:'x'}})});
 expect(lockGate).not.toHaveBeenCalled();expect(sshDispatch).not.toHaveBeenCalled();
});

import { makeEnvelope, digest, validateContract, recoveryAllowed } from '../commander-v2-contract.js';
import { authoringMutationError } from '../../workflow-authoring/task-guard.js';
import { judgeTask } from '../factory-judge.js';
const contract={key:'report',input_schema:{type:'object',required:['text']},resources:{},recovery:{max_attempts:2,total_timeout_sec:60,cleanup_timeout_sec:30,retry_safe:true,retry_on:['verification_failed']}};
it('输入schema失败与越界预算拒绝，空数组及键排序摘要稳定',()=>{
 expect(digest({b:[],a:'中文\n'})).toBe(digest({a:'中文\n',b:[]}));
 const t={...task,payload:{...task.payload,workflow_key:'report',workflow_input:{text:'ok'}}};
 expect(validateContract(t,contract).max_attempts).toBe(2);
 expect(()=>validateContract({...t,payload:{...t.payload,workflow_input:[]}},contract)).toThrow('不符合同');
 expect(()=>validateContract(t,{...contract,recovery:{max_attempts:999}})).toThrow('越界');
 const e=makeEnvelope(t,{},contract,null,new Date('2026-10-13T00:00:00Z'));
 expect(()=>makeEnvelope(t,{},contract,e,new Date(e.deadline_at))).toThrow('耗尽');
});
it('通用写入口拒绝伪造控制状态以及全部v2状态变更',()=>{
 expect(authoringMutationError(null,{result:{workflow_control:{phase:'final'}}}).code).toBe('COMMANDER_CONTROL_RESERVED');
 for(const status of ['completed','failed','queued','in_progress'])expect(authoringMutationError(task,{status}).code).toBe('COMMANDER_CONTROL_OWNED');
});
it('执行者effects自述为空不能授权核验失败后重做',()=>{
 const e=makeEnvelope({...task,payload:{...task.payload,workflow_key:'report',workflow_input:{text:'ok'}}},{},contract,null);
 expect(recoveryAllowed({envelope:e,execution_stopped:true,delivery:{cleanup:{completed:true},effects:[]},verification:{verdict:'FAIL',assertions:[],evidence:['readback']}},'verification_failed')).toBe(false);
});
it('factory对v2只消费最终判定，不重复创建核验，普通workflow不写台账',async()=>{
 const proof={id:'independent',task_type:'research',status:'completed',parent_task_id:task.id,payload:{verification_transport:'openclaw-agent-v1',run_id:'wfv-independent'},
  result:{receipt:{verification_runtime:{provider:'openai',model:'gpt-6.1-sol',logical_run_id:'wfv-independent',official_run_id:'official',rerouted:false}},
   workflow_verification:{task_id:task.id,run_id:'run',attempt:1,definition_sha256:'hash',verdict:'PASS',assertions:[{name:'cleanup',pass:true}],evidence:['independent-readback']}}};
 const store={findLedger:vi.fn(async()=>({id:'ledger'})),writeJudge:vi.fn(),getTask:vi.fn(async()=>proof)},recordRun=vi.fn(async()=>({duplicate:true})),createTask=vi.fn();
 const t={...task,result:{workflow_control:{phase:'awaiting_verify'}}};
 expect((await judgeTask(t,{store,recordRun,createTask})).state).toBe('awaiting_verify');
 t.result.workflow_control={phase:'final',verdict:'PASS',envelope:{run_id:'run',attempt:1,definition:{snapshot_sha256:'hash'}},verify_task_id:'independent'};
 expect((await judgeTask(t,{store,recordRun,createTask})).state).toBe('not_factory');expect(recordRun).not.toHaveBeenCalled();
 t.payload={...t.payload,factory_dispatch:true};await judgeTask(t,{store,recordRun,createTask});
 expect(recordRun).toHaveBeenCalledTimes(1);expect(createTask).not.toHaveBeenCalled();
});
import { verificationRequest } from '../commander-v2-control.js';
import { routeWork } from '../../work-router.js';
it('独立核验建单满足正式路由合同，落research而非coding通道',()=>{
 const spec=verificationRequest(task,{envelope:{workflow_key:'report',run_id:'run',attempt:1,definition:{snapshot_sha256:'hash'},input:{}},delivery:{outputs:[],evidence:[],cleanup:{},effects:[]}});
 expect(routeWork(spec,[])).toMatchObject({canonical_task_type:'research',work_kind:'research',pipeline:'research'});
});
import { validateDelivery } from '../commander-v2-contract.js';
const reportOutputSchema={type:'object',additionalProperties:false,required:['json_path','csv_path','task_count','deployment_count','source_snapshot'],properties:{json_path:{type:'string',minLength:1},csv_path:{type:'string',minLength:1},task_count:{type:'integer',minimum:0},deployment_count:{type:'integer',minimum:0},source_snapshot:{type:'string',minLength:1}}};
it('completed交付必须满足冻结输出schema，空对象/错类型/多余字段拒绝',()=>{
 const e=makeEnvelope({...task,payload:{...task.payload,workflow_key:'report',workflow_input:{text:'ok'}}},{},{...contract,output_schema:reportOutputSchema},null);
 const d={...e,status:'completed',outputs:{},evidence:[],effects:[],cleanup:{completed:true,evidence:[]}};
 expect(()=>validateDelivery(d,e)).toThrow('outputs不符合同');
 const outputs={json_path:'/report.json',csv_path:'/report.csv',task_count:0,deployment_count:0,source_snapshot:'sha256'};
 expect(()=>validateDelivery({...d,outputs},e)).not.toThrow();
 expect(()=>validateDelivery({...d,outputs:{...outputs,task_count:'0'}},e)).toThrow('outputs不符合同');
 expect(()=>validateDelivery({...d,outputs:{...outputs,uncontracted:true}},e)).toThrow('outputs不符合同');
 expect(()=>validateDelivery({...d,status:'failed',failure:{code:'output_schema_invalid'}},e)).not.toThrow();
});
