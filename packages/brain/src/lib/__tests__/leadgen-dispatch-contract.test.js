import {describe,it,expect} from 'vitest';
import {resolveLeadgenInput} from '../leadgen-dispatch-contract.js';
const task = (key='douyin_comment_scoring', extra={}) => ({id:'11111111-2222-4333-8444-555555555555',payload:{workflow_key:key,leadgen:{line:'jinno',company_id:'22222222-2222-4222-8222-222222222222',source_run:'q102real',source_binding_run_id:'douyin_video_processing-q102real__a1',limit:5,...extra}}});

import {resolveWorkflowConfig} from '../factory-workflow-config.js';
describe('四独立获客正规入口配置', () => {
  for (const key of ['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach']) {
    it(`${key} 进入已冻结 leadgen-run 而非旧 Commander agent`, () => {
      const config = resolveWorkflowConfig(key);
      expect(config?.dispatch_via).toBe('leadgen-run-v1');
      expect(config?.leadgen?.workflow_id).toMatch(/^b1000000-0000-4000-8000-00000000010[1-4]$/);
    });
  }
});

describe('四入口最窄输入合同',()=>{
  it('103固定MMV无手机身份，控制run与external业务run不同',()=>{
    const p=resolveLeadgenInput(task());
    expect(p.machine).toBe('mmv'); expect(p.profile).toBe('mmv-scoring');expect(p.serial).toBe('none');
    expect(p.business_run_id).not.toBe(p.controller_run_id);
    expect(p.env.LEADGEN_SOURCE_RUN).toBe('q102real');
  });
  it.each([{source_run:null},{source_run:'commentbench20261014b'},{source_binding_run_id:'douyin_video_discovery-q102real__a1'},{serial:'somephone'},{env:{BYPASS_PAUSE:'1'}},{limit:100001},{line:'x;exit'}])('拒绝错误范围或额外能力 %j',extra=>expect(()=>resolveLeadgenInput(task(undefined,extra))).toThrow());
  it('手机流程必须显式选择身份',()=>expect(()=>resolveLeadgenInput(task('douyin_video_processing'))).toThrow());
});

describe('104原发送开关只由本次明确授权驱动',()=>{
 const make=extra=>task('douyin_lead_outreach',{source_run:undefined,source_binding_run_id:undefined,profile:'jinoshengyuan-work',serial:'realserial',limit:1,...extra});
 it('原263只支持单次发送，limit2须在启动前拒绝',()=>expect(()=>resolveLeadgenInput(make({send_authorized:true,limit:2}))).toThrow());
 it('缺明确发送授权拒绝',()=>expect(()=>resolveLeadgenInput(make({}))).toThrow());
 it('授权不允许携带任意env或pause绕过',()=>{expect(resolveLeadgenInput(make({send_authorized:true})).send_authorized).toBe(true);expect(()=>resolveLeadgenInput(make({send_authorized:true,env:{OUTREACH_PAUSED:'0'}}))).toThrow();});
});

describe('102显式采集预算使用正式冻结原生输入',()=>{
 const make=n=>task('douyin_video_processing',{profile:'legacy',serial:'serial',source_binding_run_id:'douyin_video_discovery-q102real__a1',comment_limit:5,collection_budget_s:n});
 it('1500秒只映射原生白名单env，给全局2400保留480清场/资格空间',()=>expect(resolveLeadgenInput(make(1500)).env.QUEUED_VIDEO_COLLECTION_SECONDS).toBe('1500'));
 it.each([0,-1,1921,1.5,'1500'])('预算无效拒绝 %s',n=>expect(()=>resolveLeadgenInput(make(n))).toThrow());
 it('103不接受手机采集预算',()=>expect(()=>resolveLeadgenInput(task(undefined,{collection_budget_s:1500}))).toThrow());
});
