import {describe,it,expect} from 'vitest';
import {resolveLeadgenInput} from '../leadgen-dispatch-contract.js';
const task = (key='douyin_comment_scoring', extra={}) => ({id:'11111111-2222-4333-8444-555555555555',payload:{workflow_key:key,leadgen:{line:'jinno',company_id:'22222222-2222-4222-8222-222222222222',source_run:'q102real',source_binding_run_id:'douyin_video_processing-q102real__a1',limit:5,...extra}}});

import {verifyBatchRows,buildLeadgenBatchProbe} from '../leadgen-batch-proof.js';
describe('独立评分精确已提交102批原生身份',()=>{
 const plan={...resolveLeadgenInput(task()),line:'jinuo'};
 const snapshot={company_id:plan.company_id,config_status:'enabled',runtime_config:{routing:{line_key:'jinuo'}}};
 const row={line_key:'jinuo',harvest_batch:'q102real',douyin_id:'real-native',nickname:'n',profile_url:'https://www.douyin.com/user/native-id',comment_body:'c',source_video_url:'v',recipient_evidence:{status:'verified'}};
 it('复用原证据validator并限定102 run',()=>{let called;const r=verifyBatchRows(plan,[row],snapshot,(_e,s)=>{called=s},()=> 'hash',{key:'jinuo'});expect(r.eligible).toBe(1);expect(called.run).toBe('q102real');});
 it.each([{harvest_batch:'other'},{profile_url:null},{douyin_id:null},{line_key:'other'}])('拒绝不符身份 %j',extra=>expect(()=>verifyBatchRows(plan,[{...row,...extra}],snapshot,()=>{},()=>'',{key:'jinuo'})).toThrow());
 it('拒绝其他公司与原生证据失败',()=>{expect(()=>verifyBatchRows(plan,[row],{...snapshot,company_id:'other'},()=>{},()=>'',{key:'jinuo'})).toThrow();expect(()=>verifyBatchRows(plan,[row],snapshot,()=>{throw Error('RECIPIENT_NATIVE_PROOF_INVALID')},()=>'',{key:'jinuo'})).toThrow();});
 it('无已提交评论只等待，SQL严格只读且没有NULL全池回退',()=>{expect(verifyBatchRows(plan,[],snapshot,()=>{},()=>'',{key:'jinuo'}).eligible).toBe(0);const p=buildLeadgenBatchProbe(plan);expect(p.input).toContain('BEGIN READ ONLY');expect(p.input).toContain('harvest_batch=$2');expect(p.input).not.toMatch(/INSERT INTO|UPDATE zenithjoy|IS NULL OR harvest_batch/);});
});

describe('104公司隔离必须在任何外发之前成立',()=>{
 const p=resolveLeadgenInput(task('douyin_lead_outreach',{source_run:undefined,source_binding_run_id:undefined,profile:'legacy',serial:'serial',send_authorized:true,limit:1}));
 const base={company_id:p.company_id,config_status:'enabled',runtime_config:{routing:{line_key:'jinuo'},platform_accounts:[{enabled:true,verification_status:'verified',profile:'legacy',device_serial:'serial'}]}};
 it('公司A与lineB拒绝',()=>expect(()=>verifyBatchRows(p,[],base,()=>{},()=>'',{key:'yuesheng'})).toThrow('COMPANY_SOURCE'));
 it('公司未授权手机拒绝',()=>expect(()=>verifyBatchRows({...p,serial:'other'},[],base,()=>{},()=>'',{key:'jinuo'})).toThrow('COMPANY_ACCOUNT'));
 it('精确公司账号授权才允许后续领取任务',()=>expect(verifyBatchRows(p,[],base,()=>{},()=>'',{key:'jinuo'}).eligible).toBe(1));
});
