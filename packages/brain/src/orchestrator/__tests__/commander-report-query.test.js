import {test,expect} from 'vitest';
import {buildCommanderRunReport} from '../commander-run-report.js';
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
});
