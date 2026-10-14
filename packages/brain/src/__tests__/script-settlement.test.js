import {describe,expect,it} from 'vitest';
import {settleScriptRun,redactEnvValues} from '../script-settlement.js';

async function frozenReceipt(receipt,{exit=1,channel='stdout',payload={}}={}){
 const writes=[];const pool={query:async(sql,args)=>{writes.push([sql,args]);return {rowCount:1,rows:[{id:'task',task_id:'task',status:'failed',result:{}}]};}};
 await settleScriptRun(pool,{id:'task',payload:{workflow_id:'workflow',phone_serial:'phone',source_revision:'fixed',...payload}},
  {exit,[channel]:JSON.stringify(receipt)}, {hostId:'us-mac-m4',runId:'current'});
 return JSON.parse(writes.find(([sql])=>/UPDATE task_runs/.test(sql))[1][2]).business_receipt;
}
const failedReceipt=()=>({status:'failed',task_id:'task',run_id:'current',serial:'phone',workflow_id:'workflow',source_revision:'fixed',
 failure:{stage:'adb_connect',code:'ADB_UNREACHABLE',message:'device unreachable',exit_code:255,host:'xian-m4',stderr:'adb refused',stdout:'probe failed',evidence:['host:/tmp/probe.json'],extra:'never-store'}});
it.each(['stdout','stderr'])('同身份失败回执从%s冻结具体原因和证据白名单',async channel=>{
 const stored=await frozenReceipt(failedReceipt(),{channel});
 expect(stored).toMatchObject({status:'failed',phone_serial:'phone',failure:{stage:'adb_connect',code:'ADB_UNREACHABLE',message:'device unreachable',exit_code:255,host:'xian-m4',evidence:['host:/tmp/probe.json']}});
 expect(stored.failure).not.toHaveProperty('extra');
});
it.each([{task_id:'other'},{run_id:'previous'},{workflow_id:'other'},{serial:'other'},{source_revision:'newer'}])('失败回执身份冲突不采信 %j',async wrong=>{
 expect(await frozenReceipt({...failedReceipt(),...wrong})).toBeUndefined();
});
it('冻结失败详情先脱敏再限长，不复制秘密或嵌套blob',async()=>{
 const r=failedReceipt();r.failure.message='token=topsecret password="hidden value" Authorization: Bearer bearer-value '+ 'x'.repeat(4000);
 r.failure.stderr='env-secret '+ 'y'.repeat(6000);r.failure.evidence=Array.from({length:30},()=> 'https://user:pass@example.org/file?api_key=url-secret&ok=yes'+ 'z'.repeat(700));
 const stored=await frozenReceipt(r,{payload:{env:{TOKEN:'env-secret'}}});const text=JSON.stringify(stored);
 for(const secret of ['topsecret','hidden value','bearer-value','env-secret','url-secret','user:pass'])expect(text).not.toContain(secret);
 expect(stored.failure.message.length).toBeLessThanOrEqual(1000);expect(stored.failure.stderr.length).toBeLessThanOrEqual(2000);
 expect(stored.failure.evidence.length).toBeLessThanOrEqual(10);expect(stored.failure.evidence.every(s=>s.length<=500)).toBe(true);
});
it.each([{status:'completed',exit:0},{status:'failed',exit:0},{status:'completed',exit:1}])('成功/失败运输与业务回执矛盾不把failure混进成功 %j',async({status,exit})=>{
 const stored=await frozenReceipt({...failedReceipt(),status},{exit});
 expect(stored?.failure).toBeUndefined();
});
describe('脚本结算保持run身份',()=>{
  it('旧run的终态CAS不命中时不会落完成事件或修改run',async()=>{
    const writes=[];const pool={query:async(sql,args)=>{writes.push([sql,args]);return {rowCount:0,rows:[]};}};
    expect(await settleScriptRun(pool,{id:'task',payload:{}},{exit:0,stdout:'done'},
      {hostId:'us-mac-m4',runId:'old',reservationId:'old-reservation'})).toBe('skipped');
    expect(writes).toHaveLength(1);expect(writes[0][1]).toContain('old');expect(writes[0][1]).toContain('old-reservation');
  });
  it('输出沿用环境敏感值脱敏',()=>{
    expect(redactEnvValues('hello secret-value',{TASK_TOKEN:'secret-value'})).toBe('hello ***');
  });
});
it('旧失败run的回队CAS不命中时不写虚假重试事件',async()=>{
  const writes=[];const pool={query:async(sql,args)=>{writes.push([sql,args]);return {rowCount:0,rows:[]};}};
  expect(await settleScriptRun(pool,{id:'task',payload:{}},{exit:1,stderr:'failed'},
    {hostId:'us-mac-m4',runId:'old',reservationId:'old-reservation'})).toBe('skipped');
  expect(writes.filter(([sql])=>/INSERT INTO task_events/.test(sql))).toHaveLength(0);
});
it('完成与失败尝试冻结匹配run的业务回执，只保存版本与身份白名单',async()=>{
  for(const exit of [0,1]){
    const writes=[];const pool={query:async(sql,args)=>{
      writes.push([sql,args]);return {rowCount:1,rows:[{id:'task',task_id:'task',status:'success',result:{}}]};
    }};
    const receipt={run_id:'current',status:'blocked',source_revision:'old-source',control_source_revision:'old-control',
      workflow_id:'workflow',phone_serial:'phone',batch_task_id:'batch',secret:'never-store'};
    await settleScriptRun(pool,{id:'task',payload:{}},{exit,stdout:`log\n${JSON.stringify(receipt)}\n${JSON.stringify({...receipt,run_id:'other',source_revision:'wrong'})}`},
      {hostId:'us-mac-m4',runId:'current'});
    const update=writes.find(([sql])=>/UPDATE task_runs/.test(sql));
    const stored=JSON.parse(update[1][2]);
    expect(stored.business_receipt).toEqual({status:'blocked',source_revision:'old-source',control_source_revision:'old-control',
      workflow_id:'workflow',phone_serial:'phone',batch_task_id:'batch'});
  }
});
it('其它run的stdout不作为当前run版本回执',async()=>{
  const writes=[];const pool={query:async(sql,args)=>{writes.push([sql,args]);return {rowCount:1,rows:[{id:'task',task_id:'task',status:'success',result:{}}]};}};
  await settleScriptRun(pool,{id:'task',payload:{}},{exit:0,stdout:JSON.stringify({run_id:'other',source_revision:'wrong'})},
    {hostId:'us-mac-m4',runId:'current'});
  const update=writes.find(([sql])=>/UPDATE task_runs/.test(sql));
  expect(JSON.parse(update[1][2]).business_receipt).toBeUndefined();
});

it('手机业务回执没有run_id但task_id与当前结算任务相同时保存',async()=>{
  const writes=[];const pool={query:async(sql,args)=>{writes.push([sql,args]);return {rowCount:1,rows:[{id:'task',task_id:'task',status:'success',result:{}}]};}};
  await settleScriptRun(pool,{id:'task',payload:{}},{exit:0,stdout:JSON.stringify({task_id:'task',status:'completed',source_revision:'phone-source',workflow_id:'workflow'})},
    {hostId:'us-mac-m4',runId:'current'});
  const update=writes.find(([sql])=>/UPDATE task_runs/.test(sql));
  expect(JSON.parse(update[1][2]).business_receipt).toEqual({status:'completed',source_revision:'phone-source',workflow_id:'workflow'});
});
it.each([{task_id:'other'}, {task_id:'task',run_id:'other'},{}])('缺身份或冲突的手机回执不套给当前run %j',async identity=>{
  const writes=[];const pool={query:async(sql,args)=>{writes.push([sql,args]);return {rowCount:1,rows:[{id:'task',task_id:'task',status:'success',result:{}}]};}};
  await settleScriptRun(pool,{id:'task',payload:{}},{exit:0,stdout:JSON.stringify({...identity,status:'completed',source_revision:'wrong'})},
    {hostId:'us-mac-m4',runId:'current'});
  const update=writes.find(([sql])=>/UPDATE task_runs/.test(sql));
  expect(JSON.parse(update[1][2]).business_receipt).toBeUndefined();
});
