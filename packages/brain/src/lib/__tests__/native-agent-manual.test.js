import {expect,test} from 'vitest';
import {dispatchManualQiumi} from '../manual-qiumi-dispatch.js';
test('人工qiumi入口接受native路由且run只由真实执行器创建，响应不再冒称OpenClaw',async()=>{
 const row={id:'10000000-0000-4000-8000-000000000001',status:'queued',payload:{provider:'native-agent',qiumi_department:'main',qiumi_route:{source:'native-agent'}}};let starts=0;
 const pool={query:async(sql,args=[])=>{
  if(sql.includes('SET claimed_by = $2'))row.claimed_by=args[1];
  if(sql.includes("SET status = 'in_progress'")){row.status='in_progress';row.executor_kind=sql.includes("'external-worker'")?'external-worker':'openclaw-agent';}
  return {rows:[row],rowCount:1};
 }};
 const response=await dispatchManualQiumi(row,pool,{route:async()=>({outcome:'proceed'}),deviceGate:async()=>({pass:true,acquired:false}),trigger:async task=>{starts++;expect(task.payload).not.toHaveProperty('run_id');return {success:true,runId:'native-run'};}});
 expect(response).toMatchObject({status:202,body:{executor:'native-agent',run_id:'native-run'}});
 expect(starts).toBe(1);expect(row.executor_kind).toBe('external-worker');
});
