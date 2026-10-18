import {it,expect} from 'vitest';
const ROOT='11111111-1111-4111-8111-111111111111';
const SELF='33333333-3333-4333-8333-333333333333';

it('readonly诊断文本回执由终态接棒解析，拒绝串链身份而不要求AI写库',async()=>{
 const {readCommanderDiagnosis}=await import('../commander-improvement.js');
 const chain={protocol:'commander-improvement-v1',phase:'diagnosis',chain_key:'a'.repeat(64),origin_task_id:ROOT};
 const message={chain_key:chain.chain_key,origin_task_id:ROOT,next_steps:[{kind:'note',title:'外部网络，无需编码'}]};
 const task={payload:{commander_improvement:chain,last_run_result:{result_summary:'报告\nCOMMANDER_DIAGNOSIS '+JSON.stringify(message)}}};
 expect(readCommanderDiagnosis(task)).toEqual(message);
 task.payload.last_run_result.result_summary='COMMANDER_DIAGNOSIS '+JSON.stringify({...message,origin_task_id:SELF});
 expect(readCommanderDiagnosis(task)).toBeNull();
});
