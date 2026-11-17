import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 只隔离外部存储边界，真实消费者、诊断解析和handoff保存仍执行。
vi.mock('../../capture-inbox.js', () => ({ pushCaptureAtom: async () => null }));
vi.mock('../project-brief-apply.js', () => ({ applyHandoffBriefDelta: async () => null }));
vi.mock('../../work-routing-store.js', () => ({ createRoutedTask: async (pool, request) => pool.createTask(request) }));
import { relayOnComplete } from '../relay-baton.js';
const origin='11111111-1111-4111-8111-111111111111', id='33333333-3333-4333-8333-333333333333';
const repo='perfectuser21/cecelia', revision='a'.repeat(40);
const chain={protocol:'commander-improvement-v1',phase:'diagnosis',chain_key:'b'.repeat(64),origin_task_id:origin,
 deadline_at:'2099-01-01T00:00:00.000Z',max_repairs:1,effects_safe:true,frozen_sources:[{repo,revision}]};
const step={kind:'dispatch_headless',title:'修补固定源码',change_kind:'bugfix',task_type:'coding_workflow',repo_hint:repo,map_scope_hint:['F1'],base_sha:revision,
 diagnosis:{category:'source_defect',fixed_source:{repo,revision,path:'packages/brain/src/helper.js'},evidence:['immutable:source'],reproduction:'固定输入复现错误',acceptance:['错误修好且正常场景通过'],effects_status:'none'}};
let mirror, oldMirror;
afterEach(()=>{if(mirror)rmSync(mirror,{recursive:true,force:true});if(oldMirror===undefined)delete process.env.HANDOFF_DOCS_DIR;else process.env.HANDOFF_DOCS_DIR=oldMirror;});
function fixture({ improvement=chain, next=step, existing=false }={}) {
 oldMirror=process.env.HANDOFF_DOCS_DIR;mirror=mkdtempSync(join(tmpdir(),'relay-retirement-'));process.env.HANDOFF_DOCS_DIR=mirror;
 const task={id,parent_task_id:origin,title:'只读诊断',status:'completed',task_type:'research',priority:'P2',payload:{},result:{}};
 if(improvement)task.payload={commander_improvement:improvement,last_run_result:{result_summary:'诊断已完成\nCOMMANDER_DIAGNOSIS '+JSON.stringify({chain_key:chain.chain_key,origin_task_id:origin,next_steps:[next]})}};
 if(existing)task.result.handoff={schema_version:1,next_steps:[next]};
 const created=[],events=[],decisions=[];
 const pool={createTask:async request=>{const child={id:'child-'+created.length,title:request.title,task_type:request.requested_task_type};created.push({...child,request});return {task:child};},query:async(sql,params)=>{
  if(sql.startsWith('SELECT id, title, status'))return {rows:[task]};
  if(sql.includes('UPDATE tasks')&&sql.includes('handoff_log')){task.result.handoff=JSON.parse(params[1]);return {rows:[],rowCount:1};}
  if(sql.includes('INSERT INTO task_events')){events.push({task_id:params[0],type:params[1],payload:JSON.parse(params[2])});return {rows:[],rowCount:1};}
  if(sql.includes('SELECT id FROM decisions'))return {rows:[]};
  if(sql.includes('INSERT INTO decisions')){decisions.push(params);return {rows:[{id:'decision-1',topic:params[0]}]};}
  throw Error('未处理的测试SQL: '+sql);
 }};
 return {task,pool,created,events,decisions};
}
it('旧在途诊断完整修补回执保留handoff，拒新coding任务并写拒绝事实',async()=>{
 const f=fixture(),outcome=await relayOnComplete(f.pool,id);
 expect(f.created).toEqual([]);
 expect(f.task.result.handoff.next_steps).toEqual([step]);
 expect(outcome).toMatchObject({synthesized:false,tasks:[],skipped:[{index:0,kind:'dispatch_headless',title:step.title,error:'commander_improvement_auto_repair_retired'}]});
 expect(f.events).toContainEqual({task_id:id,type:'commander_improvement_auto_repair_rejected',payload:{chain_key:chain.chain_key,step_index:0,title:step.title,reason:'commander_improvement_auto_repair_retired',actor:'relay-baton'}});
});
it.each(['diagnosis','repair'])('已有handoff的旧%s链不能用普通task绕过',async phase=>{
 const f=fixture({improvement:{...chain,phase},next:{kind:'task',title:'换成普通任务继续修补'},existing:true});
 const result=await relayOnComplete(f.pool,id);
 expect(f.created).toEqual([]);expect(result.skipped[0].error).toBe('commander_improvement_auto_repair_retired');
});
it.each(['note','decision'])('自动诊断保留%s人工参考出口',async kind=>{
 const f=fixture({next:{kind,title:'诊断结论交主理人判断'}}),result=await relayOnComplete(f.pool,id);
 expect(f.created).toEqual([]);expect(f.task.result.handoff.next_steps).toEqual([{kind,title:'诊断结论交主理人判断'}]);
 expect(result.decisions).toHaveLength(kind==='decision'?1:0);expect(f.events).toEqual([]);
});
it('普通人工项目显式coding接力仍经真实relay登记新任务',async()=>{
 const f=fixture({improvement:null,existing:true});f.task.task_type='dev';f.task.executor_kind='headed-session';f.task.payload={headed_manual:true};
 const result=await relayOnComplete(f.pool,id);
 expect(result.tasks).toHaveLength(1);expect(f.created).toHaveLength(1);
 expect(f.created[0]).toMatchObject({task_type:'coding_workflow',request:{repo_hint:repo,map_scope_hint:['F1'],base_sha:revision,source_id:'handoff:'+id+':0'}});
 expect(f.events).toEqual([]);
});
