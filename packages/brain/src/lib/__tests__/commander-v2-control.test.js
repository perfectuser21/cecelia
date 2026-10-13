import { it, expect } from 'vitest';
import { verificationRequest, readVerification, reconcileCommanderV2 } from '../commander-v2-control.js';
import { resolveExecutor } from '../../routing/resolve-executor.js';
const e={task_id:'task',workflow_key:'report',run_id:'run',attempt:1,definition:{snapshot_sha256:'hash'}};
const v={task_id:'task',run_id:'run',attempt:1,definition_sha256:'hash',verdict:'PASS',assertions:[{name:'cleanup',pass:true}],evidence:['independent']};
it('核验正式显式Codex路由排除默认Claude，携带真正远端产物位置',async()=>{
 const spec=verificationRequest({id:'task'},{envelope:e,delivery:{outputs:{path:'/remote/report.json'}},execution_location:{ssh_target:'worker@actual-host'}});
 const codex={name:'codex-worker',status:'active',metadata:{executors:[{executor:'codex',url:'http://codex'}]}};
 const claude={name:'other',status:'active',metadata:{executors:[{executor:'claude',default:true,url:'http://claude'}]}};
 const route=await resolveExecutor({task_type:'research',payload:spec.metadata},{loadMachines:async()=>[claude,codex],selectLoadBalanced:async rows=>rows[0]});
 expect(route.executor).toBe('codex');expect(route.machineId).toBe('codex-worker');
 expect(spec.metadata.workflow_verification.execution_location.ssh_target).toBe('worker@actual-host');
 expect(spec.description).toContain('只读SSH');
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
