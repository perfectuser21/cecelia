import { describe, it, expect } from 'vitest';
import { observeWorkflows,observedRun } from '../workflow-observation.js';

it('失败详情带stage/code/message/evidence进入近期真实Run；历史未知不靠exit猜ADB',()=>{
 const r={id:'id',run_id:'r',task_id:'task',workflow_id:'wf',status:'failed',context:{source:'script'},result:{exit_code:255,
  business_receipt:{status:'failed',failure:{stage:'adb_connect',code:'ADB_UNREACHABLE',message:'offline',evidence:['host:/tmp/probe.json']}}}};
 expect(observedRun(r)).toMatchObject({failure:{stage:'adb_connect',code:'ADB_UNREACHABLE',message:'offline',evidence:['host:/tmp/probe.json']}});
 expect(observedRun({...r,result:{exit_code:255}}).failure).toBeNull();
 for(const identity of [{task_id:'other'},{run_id:'previous'},{workflow_id:'other'}])expect(observedRun({...r,result:{business_receipt:{...r.result.business_receipt,...identity}}}).failure).toBeNull();
 expect(observedRun({...r,status:'success',result:{business_receipt:{status:'completed',failure:r.result.business_receipt.failure}}}).failure).toBeNull();
});

const now = '2026-10-13T09:00:00Z';
const task = (id, status='completed') => ({ id, workflow_id:'wf', status, title:id, notion_id:`page-${id}`, payload:{} });
const run = (id, task_id, status='success') => ({ id, run_id:id, task_id, workflow_id:'wf', status, started_at:'2026-10-12T09:00:00Z', ended_at:'2026-10-12T09:01:00Z', ledger:'task_runs', notion_id:`page-${id}`, context:{attempt:Number(id.slice(-1))||1} });
function data() { return { observed_at:now, workflows:[{id:'wf',version:'0.1.1'}], activities:[],refs:[],workflow_runtime:[], task_records:[],run_records:[], entrypoints:[] }; }
describe('真实Workflow观测',()=>{
  it('脚本和Agent入口只有进程success而缺业务回执时，不编造成业务成功',()=>{
    const d=data();d.run_records=['script','openclaw-agent'].map((source,i)=>({...run('transport'+i,'a'),context:{source}}));
    const rt=observeWorkflows(d).get('wf');
    expect(rt.stats).toMatchObject({runs7:2,success7:0,unverified7:2,success_rate:null,completed_tasks7:0});
    expect(rt.recentRuns.every(r=>r.status==='回执缺失'&&r.transport_status==='success')).toBe(true);
  });
  it('高频运行的SQL聚合与最近明细共同计算完整统计，不制造明细或任务',()=>{
    const d=data();d.run_records=[{...run('a1','a'),duration_ms:100}];
    d.run_summaries=[{workflow_id:'wf',runs7:1000,success7:800,failed7:100,running7:50,cancelled7:50,duration_count:950,duration_total_ms:190000}];
    const rt=observeWorkflows(d).get('wf');
    expect(rt.stats).toMatchObject({runs7:1001,success7:801,failed7:100,running7:50,cancelled7:50,success_rate:801/901,avg_duration_ms:190100/951,attempted_tasks7:1});
    expect(rt.recentRuns).toHaveLength(1);
  });
  it('同一run_id跨账本去重；成功/失败/运行中/取消/deferred不混成成功，排队没有Run',()=>{
    const d=data();d.task_records=[task('a'),task('b','failed'),task('c'),task('d','in_progress'),task('e','cancelled'),task('q','queued')];
    d.task_records[2].script={run_id:'c1',stdout:JSON.stringify({status:'deferred'})};
    d.run_records=[run('a1','a'),run('b1','b','failed'),run('b2','b','success'),run('c1','c'),{...run('d1','d','running'),ended_at:null},run('e1','e','cancelled'),{...run('a1','a'),ledger:'runs',outcome:'pass'}];
    const rt=observeWorkflows(d).get('wf');
    expect(rt.stats).toMatchObject({runs7:6,success7:2,failed7:1,deferred7:1,cancelled7:1,running7:1,queued:1,retries7:1,success_rate:2/3,completed_task_rate:1/5});
    expect(rt.recentRuns.find(r=>r.run_id==='a1').ledger).toBe('task_runs');
  });
  it('固定窗口排除未来/7天边界外；无分母留空，旧版本不会用当前定义覆盖',()=>{
    const d=data();d.run_records=[{...run('old','a'),started_at:'2026-10-06T08:59:59Z'},{...run('future','b'),started_at:'2026-10-14T09:00:00Z'}];
    const rt=observeWorkflows(d).get('wf');expect(rt.stats.runs7).toBe(0);expect(rt.stats.success_rate).toBeNull();
    expect(rt.recentRuns.find(r=>r.run_id==='old').workflow_version).toBe('未知');
  });
  it('任务最新stdout不污染早期重试；只有匹配尝试读业务状态，冻结快照版本优先',()=>{
    const d=data();d.task_records=[{...task('a'),script:{run_id:'a2',stdout:JSON.stringify({status:'deferred',source_revision:'new'})}}];
    d.run_records=[{...run('a1','a'),context:{workflow_snapshot:{workflow_version:'0.1.0',source_revision:'old'}}},run('a2','a')];
    const rt=observeWorkflows(d).get('wf');expect(rt.recentRuns.find(r=>r.run_id==='a1')).toMatchObject({status:'success',workflow_version:'0.1.0',source_revision:'old'});
    expect(rt.recentRuns.find(r=>r.run_id==='a2').status).toBe('deferred');
  });
  it('执行层与AI启动入口分列，批次queued仅派发完成',()=>{
    const d=data();d.activities=[{id:'act',executor_kind:'code',contract:{implementation:{ref:'repo:runner.py',version:'sha'}}}];d.refs=[{workflow_id:'wf',activity_id:'act',active:true,sequence_no:1}];
    d.entrypoints=[{workflow_id:'wf',runtime_requires_llm:true,enabled:true,cron:'0 22 * * *'}];d.task_records=[{...task('a'),script:{run_id:'a1',stdout:'{"status":"queued"}'}}];d.run_records=[run('a1','a')];
    const rt=observeWorkflows(d).get('wf');expect(rt.execution).toContain('纯代码');expect(rt.entrypoint).toContain('Agent');expect(rt.recentRuns[0].status).toBe('派发完成');
  });
  it('错Run/Task/Workflow回执不能冒充；skipped不能计成功；阶段Run不能猜成重试',()=>{
    for(const foreign of [{run_id:'foreign'},{task_id:'foreign'},{workflow_id:'foreign'}]) {
      const d=data();d.task_records=[{...task('a'),script:{run_id:'a1',stdout:JSON.stringify({status:'deferred',...foreign})}}];d.run_records=[run('a1','a')];
      expect(observeWorkflows(d).get('wf').stats.deferred7).toBe(0);
    }
    const d=data();d.task_records=[{...task('a'),script:{run_id:'a1',stdout:'{"status":"skipped"}'}}];
    d.run_records=[run('a1','a'),{...run('stage','a'),context:{}}];
    const stats=observeWorkflows(d).get('wf').stats;expect(stats.skipped7).toBe(1);expect(stats.success7).toBe(1);expect(stats.retries7).toBe(0);
  });
  it('固定定义Run使用不可变binding证据，保留起跑声明而不套当前版本',()=>{
    const d=data();d.run_records=[{...run('a1','a'),context:{bound_definition:{id:'frozen-definition',version:'0.0.9',source_commit:'frozen-source'}}},
      {...run('b1','b'),context:{definition_preflight:{workflow_definition_version_id:'preflight-id'}}}];
    const rt=observeWorkflows(d).get('wf');expect(rt.recentRuns.find(r=>r.run_id==='a1')).toMatchObject({workflow_version:'0.0.9',definition_version_id:'frozen-definition',source_revision:'frozen-source'});
    expect(rt.recentRuns.find(r=>r.run_id==='b1').definition_version_id).toBe('preflight-id');
  });
  it('冻结业务回执也必须属于当前Workflow',()=>{
    const d=data();d.run_records=[{...run('a1','a'),result:{business_receipt:{workflow_id:'foreign',status:'deferred',source_revision:'foreign'}}}];
    const rt=observeWorkflows(d).get('wf');expect(rt.stats.deferred7).toBe(0);expect(rt.recentRuns[0].source_revision).toBe('未知');
  });
});
