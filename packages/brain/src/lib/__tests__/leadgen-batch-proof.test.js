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

describe('云101/102保留disabled历史账号但唯一当前身份可执行',()=>{
 const current={profile:'cloud-phone-test',device_serial:'47.100.213.173:10001',douyin_id:'77980009922',platform:'douyin',company_id:'company',tenant_id:'tenant',enabled:true,verification_status:'verified',device_id:'acp-instance',source:{device_host:'mmv',device_instance_id:'acp-instance'}};
 const historical={...current,douyin_id:'perfect21xx',enabled:false,verification_status:'unverified'};
 const snapshot=accounts=>({company_id:'company',tenant_id:'tenant',config_status:'enabled',runtime_config:{routing:{line_key:'yuesheng',profiles:['cloud-phone-test']},platform_accounts:accounts}});
 const cloud=workflow_key=>({workflow_key,company_id:'company',machine:'mmv',profile:current.profile,serial:current.device_serial,device_instance_id:'acp-instance',env:{}});
 const verify=(accounts,workflow='douyin_video_discovery')=>verifyBatchRows(cloud(workflow),[],snapshot(accounts),()=>{},()=>'',{key:'yuesheng'});
 for(const workflow of ['douyin_video_discovery','douyin_video_processing']){
  it(`${workflow}忽略显式disabled历史而不修改快照`,()=>{
   for(const accounts of [[historical,current],[current,historical]]){
    const before=JSON.stringify(accounts);
    expect(verify(accounts,workflow)).toEqual({company_id:'company',line_key:'yuesheng',eligible:1});
    expect(JSON.stringify(accounts)).toBe(before);
   }
  });
 }
 it('只有disabled记录仍拒绝',()=>expect(()=>verify([historical])).toThrow('COMPANY_ACCOUNT_MISMATCH'));
 it.each([undefined,null,'false','true',0,1])('未知enabled=%j不能被隐藏成历史行',enabled=>{
  const unknown={...historical,enabled};
  for(const accounts of [[unknown,current],[current,unknown]])expect(()=>verify(accounts)).toThrow('COMPANY_ACCOUNT_MISMATCH');
 });
 it('多个当前账号仍拒绝',()=>expect(()=>verify([historical,current,{...current,douyin_id:'other'}])).toThrow('COMPANY_ACCOUNT_MISMATCH'));
 it.each([{enabled:false},{enabled:undefined},{verification_status:'unverified'},{company_id:'foreign'},{tenant_id:'foreign'},{platform:'wechat'},{device_serial:'foreign'},{device_id:'foreign'},{douyin_id:''},{source:{device_host:'xian-m4',device_instance_id:'acp-instance'}},{source:{device_host:'mmv',device_instance_id:'foreign'}}])('排除历史后身份守卫仍拒绝 %j',extra=>{
  expect(()=>verify([historical,{...current,...extra}])).toThrow('COMPANY_ACCOUNT_MISMATCH');
 });
});
