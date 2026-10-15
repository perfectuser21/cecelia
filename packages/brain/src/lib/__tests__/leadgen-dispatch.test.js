import {describe,it,expect} from 'vitest';
import {resolveLeadgenInput} from '../leadgen-dispatch-contract.js';
const task = (key='douyin_comment_scoring', extra={}) => ({id:'11111111-2222-4333-8444-555555555555',payload:{workflow_key:key,leadgen:{line:'jinno',company_id:'22222222-2222-4222-8222-222222222222',source_run:'q102real',source_binding_run_id:'douyin_video_processing-q102real__a1',limit:5,...extra}}});

import {vi} from 'vitest';
import {prepareLeadgenPlan} from '../leadgen-dispatch-contract.js';
import {buildLeadgenLaunch} from '../leadgen-controller.js';
import {dispatchLeadgenTask,reapLeadgenTask,validateLeadgenTerminal,LEADGEN_SSH_ARGS} from '../leadgen-dispatch.js';
describe('正常任务到真实适配入口及收割',()=>{
 const t=task();const input=resolveLeadgenInput(t);
 const plan={...input,release_id:'33333333-3333-4333-8333-333333333333',observation_id:'44444444-4444-4444-8444-444444444444',workflow_definition_version_id:'55555555-5555-4555-8555-555555555555',snapshot_sha256:'a'.repeat(64),source_commit:'b'.repeat(40)};
 const pool={query:vi.fn(async()=>({rows:[{id:t.id}]}))};
 const deps=()=>({prepareLeadgenPlan:async()=>plan,batchProof:async()=>({company_id:plan.company_id,eligible:1}),setLease:vi.fn(),startRun:vi.fn(async()=>({id:'controller-row',run_id:plan.controller_run_id})),recordEvent:vi.fn(),finalizeTask:vi.fn(),lockGate:vi.fn(),launch:vi.fn(async()=>JSON.stringify({state:'started'}))});
 it('真实resolve产物可交真实controller，前三flow不携发送能力',()=>{const built=buildLeadgenLaunch(plan);expect(built.input).toBeTruthy();expect(plan.send_authorized).toBeUndefined();});
 it('严格SSH参数不继承全局no',()=>expect(LEADGEN_SSH_ARGS).not.toContain('StrictHostKeyChecking=no'));
 it('103派发不调用手机锁，task_run与external业务ID分开',async()=>{const d=deps();expect(await dispatchLeadgenTask(pool,t,d)).toBe('dispatched');expect(d.lockGate).not.toHaveBeenCalled();expect(d.startRun.mock.calls[0][0].runId).toBe(plan.controller_run_id);expect(d.startRun.mock.calls[0][0].runId).not.toBe(plan.business_run_id);expect(d.launch).toHaveBeenCalledTimes(1);});
 it('SSH未知只记录一次，不重试不放锁不终态',async()=>{const d=deps();d.launch=vi.fn(async()=>{throw Error('SSH255')});d.releaseLock=vi.fn();expect(await dispatchLeadgenTask(pool,t,d)).toBe('dispatched');expect(d.launch).toHaveBeenCalledTimes(1);expect(d.releaseLock).not.toHaveBeenCalled();expect(d.finalizeTask).not.toHaveBeenCalled();expect(d.recordEvent.mock.calls.at(-1)[2]).toBe('leadgen_launch_unknown');});
 it('paused和空批次均不启动',async()=>{const d=deps();d.prepareLeadgenPlan=async()=>({waiting:true});expect(await dispatchLeadgenTask(pool,t,d)).toBe('waiting');expect(d.launch).not.toHaveBeenCalled();d.prepareLeadgenPlan=async()=>plan;d.batchProof=async()=>({company_id:plan.company_id,eligible:0});expect(await dispatchLeadgenTask(pool,t,d)).toBe('waiting');expect(d.launch).not.toHaveBeenCalled();});
 it('running/unknown不完成、不释放锁',async()=>{for(const state of ['running','unknown','reserved']){const d=deps();d.probe=async()=>({state});d.releaseLock=vi.fn();expect(await reapLeadgenTask(pool,{...t,run_id:plan.controller_run_id,payload:{...t.payload,leadgen_run:plan}},d)).toBeNull();expect(d.releaseLock).not.toHaveBeenCalled();expect(d.finalizeTask).not.toHaveBeenCalled();}});
 it('CLI exit0但无中央binding不通过',async()=>{await expect(validateLeadgenTerminal(pool,plan,{state:'terminal',exit_code:0,business_run_id:plan.business_run_id,receipt:{}},{getBinding:async()=>null})).rejects.toThrow('中央冻结');});
 it('真实非0退出可失败收尾，不冒业务成功',async()=>{const r=await validateLeadgenTerminal(pool,plan,{state:'terminal',exit_code:1});expect(r.status).toBe('failed');});
 const fixed={id:plan.workflow_definition_version_id,workflow_id:plan.workflow_id,payload_sha256:plan.snapshot_sha256,source_commit:'b'.repeat(40)};
 const workflow={key:plan.workflow_key,id:plan.workflow_id,status:'active',current_definition_version_id:fixed.id};
 const explicit={release_id:plan.release_id,observation_id:plan.observation_id,workflow_definition_version_id:fixed.id,snapshot_sha256:fixed.payload_sha256};
 const preflight=(override={})=>({getRelease:async()=>({id:plan.release_id,environment:'production',target:'mmv',payload:{workflows:[fixed]},...override}),getReleaseGate:async()=>({deployed:true,actual_matches:true,gaps:[],current_observation_id:plan.observation_id}),getBinding:async()=>({binding:{source_kind:'external'},workflow:{workflow_id:'b1000000-0000-4000-8000-000000000102',source_commit:fixed.source_commit}})});
 const db={query:async()=>({rows:[workflow]})};
 it('103正式身份预检不查询phone_registry',async()=>{const query=vi.fn(db.query);expect((await prepareLeadgenPlan({query},{...t,payload:{...t.payload,workflow_definition:explicit}},preflight())).machine).toBe('mmv');expect(query.mock.calls.some(c=>c[0].includes('phone_registry'))).toBe(false);});
 it.each([{environment:'staging'},{target:'xian-m4'}])('拒绝错误部署 %j',async override=>{await expect(prepareLeadgenPlan(db,{...t,payload:{...t.payload,workflow_definition:explicit}},preflight(override))).rejects.toThrow('真实部署');});
 it('同flow旧源102绑定不通过',async()=>{const d=preflight();d.getBinding=async()=>({binding:{source_kind:'external'},workflow:{workflow_id:'b1000000-0000-4000-8000-000000000102',source_commit:'c'.repeat(40)}});await expect(prepareLeadgenPlan(db,{...t,payload:{...t.payload,workflow_definition:explicit}},d)).rejects.toThrow('同源');});
});

describe('跨网前记账故障不执行业务',()=>{
 const t=task();const p={...resolveLeadgenInput(t),release_id:'33333333-3333-4333-8333-333333333333',observation_id:'44444444-4444-4444-8444-444444444444',workflow_definition_version_id:'55555555-5555-4555-8555-555555555555',snapshot_sha256:'a'.repeat(64),source_commit:'b'.repeat(40)};
 it('startRun fail-open null必须失败且不SSH',async()=>{const launch=vi.fn(),finalizeTask=vi.fn();const pool={query:async()=>({rows:[{id:t.id}]})};const out=await dispatchLeadgenTask(pool,t,{prepareLeadgenPlan:async()=>p,batchProof:async()=>({company_id:p.company_id,eligible:1}),setLease:async()=>{},startRun:async()=>null,launch,finalizeTask});expect(out).toBe('failed');expect(launch).not.toHaveBeenCalled();expect(finalizeTask).toHaveBeenCalled();});
 it('104公司proof失败先于领取与外发',async()=>{const query=vi.fn(),launch=vi.fn(),finalizeTask=vi.fn();await dispatchLeadgenTask({query},t,{prepareLeadgenPlan:async()=>p,batchProof:async()=>{throw Error('COMPANY_SOURCE_MISMATCH')},launch,finalizeTask});expect(query).not.toHaveBeenCalled();expect(launch).not.toHaveBeenCalled();expect(finalizeTask.mock.calls[0][3].where.sql).toBe('claimed_by IS NULL');});
});

describe('四flow真实完整交付形状闭环（隔离fixtures，非生产执行）',()=>{
 it.each(['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach'])('%s 原ACK+冻结来源+中央完整路径才完成',async key=>{
  const base=task(key,{...(key==='douyin_comment_scoring'?{}:{profile:'legacy',serial:'serial'}),...(key==='douyin_lead_outreach'?{source_run:undefined,source_binding_run_id:undefined,send_authorized:true,limit:1}:{}),...(key==='douyin_video_discovery'?{source_run:undefined,source_binding_run_id:undefined}:{}),...(key==='douyin_video_processing'?{source_binding_run_id:'douyin_video_discovery-q102real__a1'}:{})});
  const p={...resolveLeadgenInput(base),release_id:'release-fixture',workflow_definition_version_id:'version-fixture',snapshot_sha256:'workflow-hash-fixture',source_commit:'source-fixture'};
  const path={reference_id:'ref-fixture',activity_id:'activity-fixture',activity_definition_version_id:'activity-version-fixture',required:true};
  const binding={id:'binding-fixture',source_kind:'external',release_id:p.release_id,workflow_definition_version_id:p.workflow_definition_version_id,snapshot_sha256:p.snapshot_sha256,payload:{runtime_snapshot_sha256:'runtime-hash-fixture'},expected_path:[path]};
  const receipt={binding_ack:{id:binding.id},frozen:{read_frozen_verified:true,snapshot_sha256:'runtime-hash-fixture',deployment:{source_commit:p.source_commit}},split_result:{run_id:p.business_run_id,status:'completed',evidence_status:'sent',results:[]}};
  const response={state:'terminal',exit_code:0,business_run_id:p.business_run_id,receipt};
  const pool={query:async()=>({rows:[{...path,id:'span-fixture',identity_protocol:2,run_binding_id:binding.id,run_id:p.business_run_id,outcome:'pass',started_at:'2026-10-15T01:00:00Z',ended_at:'2026-10-15T01:00:01Z'}]})};
  if(key==='douyin_comment_scoring')receipt.split_result.results=[{activity:'scoring',result:{scored:0,ids:[]}}];
  const got=await validateLeadgenTerminal(pool,p,response,{getBinding:async()=>({binding})});if(key==='douyin_comment_scoring'){expect(got.scoring_outcome).toBe('empty');expect(got.actual_scoring_acceptance).toBe(false);expect(got.scored_count).toBe(0);}expect(got.status).toBe('completed');expect(got.reconciliation.evidence_status).toBe('verified');
  await expect(validateLeadgenTerminal(pool,p,{...response,receipt:{...receipt,binding_ack:{id:'forged'}}},{getBinding:async()=>({binding})})).rejects.toThrow('ACK');
  await expect(validateLeadgenTerminal({query:async()=>({rows:[]})},p,response,{getBinding:async()=>({binding})})).rejects.toThrow('中央完整路径');
 });
});
