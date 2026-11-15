import {test,expect} from 'vitest';
import {buildCommanderRunReport} from '../commander-run-report.js';
import {queryCommanderReport} from '../../../scripts/commander-workflow/report.mjs';
import {createRunLedger} from '../commander-usage-ledger.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const identity={task_id:'task',run_id:'run'};
const run={...identity,contract:{workflow:'example',activities:[{key:'work',runtime:{executor_kind:'agent',phase:'source'}}]}};
const base={schema_version:1,identity,policy:{},as_of_ms:200,calls:[],attempts:[],observations:[],pending_call_ids:[],coverage:'complete',summary:{total_tokens:0}};
test('查询使用存档账单且不把缺少起止时间记为0',()=>{
 const report=buildCommanderRunReport({run,workflow:{workflowID:'commander-foundation:run',status:'SUCCESS',createdAt:100,completedAt:200,output:{status:'completed',business_pass:true,run_report:{ledger:base}}},steps:[],actions:[]});
 expect(report.identity).toEqual(identity);expect(report.activities[0].timing.started_at_ms).toBeNull();expect(report.activities[0].timing.duration_ms).toBeNull();expect(report.duration_ms).toBe(100);
});
test('未知活动失败有去向，DBOS SUCCESS不能洗白业务needs_review',()=>{
 const report=buildCommanderRunReport({run,workflow:{workflowID:'commander-foundation:run',status:'SUCCESS',createdAt:100,output:{status:'needs_review',business_pass:false,reason:'commander_activity_unverified',cleanup_status:'blocked'}},steps:[],actions:[{activity_key:'work',state:'reserved',identity:{...identity,activity_key:'work'}}]});
 expect(report.status).toBe('needs_review');expect(report.next_action).toBe('核对原动作与证据，禁止盲目重发');expect(report.usage.status).toBe('unavailable');expect(report.usage.total_tokens).toBeNull();expect(report.activities[0].action_state).toBe('reserved');
});
test('错run的账单或动作拒绝混账',()=>{
 expect(()=>buildCommanderRunReport({run,workflow:{workflowID:'wrong',output:{}},steps:[],actions:[]})).toThrow('report_identity_mismatch');
 expect(()=>buildCommanderRunReport({run,workflow:{workflowID:'commander-foundation:run',output:{}},steps:[],actions:[{activity_key:'work',identity:{task_id:'other',run_id:'run'}}]})).toThrow('report_identity_mismatch');
 expect(()=>buildCommanderRunReport({run,workflow:{workflowID:'commander-foundation:run',input:[{...run,contract:{...run.contract,workflow:'other'}}]},steps:[],actions:[]})).toThrow('report_identity_mismatch');
});
test('同一调用迟到终态补全账单，重复查询不增加用量',()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'report-late-')));
 try{const journal=createRunLedger({directory:path.join(root,'ledger'),identity});
  const call=journal.beginCall({role:'activity',provider:'codex',model:'fixture',activity_key:'work'}),saved=journal.snapshot();
  journal.finishCall(call.call_id,{status:'completed',usage:{input_tokens:9,output_tokens:3,cached_input_tokens:2}});
  const args={run,workflow:{workflowID:'commander-foundation:run',output:{run_report:{ledger:saved}}},observedLedger:journal.snapshot()};
  const a=buildCommanderRunReport(args),b=buildCommanderRunReport(args);
  expect(a.usage.total_tokens).toBe(12);expect(a.usage.activity_calls).toHaveLength(1);expect(b).toEqual(a);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('只读查询缺失journal不创建目录，数据库接口只读且释放连接',async()=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'report-readonly-'))),previous=process.env.COMMANDER_DATABASE_URL;
 process.env.COMMANDER_DATABASE_URL='postgresql://fixture/unused';const calls=[];
 try{const manifestPath=path.join(root,'manifest.json');fs.writeFileSync(manifestPath,JSON.stringify({run,profile:{cwd:root}}));
  const report=await queryCommanderReport({manifestPath,clientFactory:async options=>{expect(new URL(options.systemDatabaseUrl).searchParams.get('options')).toContain('default_transaction_read_only=on');return {getWorkflow:async()=>({workflowID:'commander-foundation:run',status:'ERROR'}),listWorkflowSteps:async()=>[],destroy:async()=>calls.push('destroy')};},databaseFactory:options=>{
   expect(options.options).toContain('default_transaction_read_only=on');return {connect:async()=>{},query:async(sql,params)=>{expect(sql).toMatch(/^SELECT /);expect(params).toEqual(['run']);return {rows:[]};},end:async()=>calls.push('end')};
  }});expect(report.usage.total_tokens).toBeNull();expect(report.status).toBe('failed');expect(fs.existsSync(path.join(root,'control'))).toBe(false);expect(calls.sort()).toEqual(['destroy','end']);
 }finally{if(previous===undefined)delete process.env.COMMANDER_DATABASE_URL;else process.env.COMMANDER_DATABASE_URL=previous;fs.rmSync(root,{recursive:true,force:true});}
});
