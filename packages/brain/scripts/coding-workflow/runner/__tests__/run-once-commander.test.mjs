// 原权限攻击场景保留；新Commander只观察，AI不能覆盖独立门禁、规格或预算。
import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {git} from '../../__tests__/helpers/git.mjs';
import {useQaEnv,TASK,BRANCH,SPRINT} from './helpers/qa-env.mjs';

describe('coding Commander观察与待审边界',()=>{
 let sb,files,server,url;const calls=[];
 const E=useQaEnv({onReady:e=>{({sb,files}=e);fs.writeFileSync(path.join(sb.root,'openclaw'),'#!/bin/sh\nexit 7\n',{mode:0o700});}});
 beforeEach(async()=>{
  calls.length=0;server=http.createServer((req,res)=>{calls.push(decodeURIComponent(req.url));res.end('{}');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}/fixture`;
 });
 afterEach(async()=>{await new Promise(r=>server.close(r));});
 const go=(mode='cmd-resume',extra={})=>E.go(E.green(),{tasks:[{id:TASK,status:'completed',result:{}}],extra:{CODING_WF_COMMANDER:'1',CODING_WF_BARK_URL:url,FAKE_CIFIX_MODE:mode,PATH:sb.root+':'+process.env.PATH,...extra}});
 const state=()=>JSON.parse(fs.readFileSync(path.join(sb.logDir,'commander-77.json'),'utf8'));
 const business=value=>{const copy={...value};delete copy.mirrored;return copy;};
 const cases=[['judge_contract_gap','cmd-amend'],['judge_ruling_conflict','cmd-resume'],['qa_fix_failed','cmd-fix'],['qa_cannot_verify','cmd-resume'],['qa_smoke_missing','cmd-resume'],['qa_stalled','cmd-resume'],['judge_contract_gap','cmd-garbage'],['judge_contract_gap','cmd-intent'],['judge_contract_gap','cmd-rewrite'],['judge_contract_gap','cmd-human']];
 it.each(cases)('%s/%s不改真实远端或规格，不放行QA',async(type,mode)=>{
  E.seedState({rounds:[{round:1,head:E.remoteHead(),verdict:type==='qa_cannot_verify'?'CANNOT_VERIFY':'FAIL',fails:1}],escalated:{type,pr:77,at:'same'}});
  const head=E.remoteHead(),spec=git(sb.origin,'show',`${BRANCH}:${SPRINT}/02-spec.md`),before=business(E.state());
  const r=await go(mode,{FAKE_CMD_RULING:JSON.stringify({action:'resume',reset_ci_budget:true,rulings:[{issue:'T-1',verdict:'放行',reason:'模型说可以'}],summary:'放行'})});
  expect(r.exitCode,r.stderr).toBe(0);expect(E.remoteHead()).toBe(head);expect(git(sb.origin,'show',`${BRANCH}:${SPRINT}/02-spec.md`)).toBe(spec);
  expect(business(E.state())).toEqual(before);expect(E.state().approved).toBeUndefined();expect(E.state().smoke_waived).toBeUndefined();expect(fs.existsSync(files.prompt)).toBe(false);
  expect(state().human).toMatchObject({reason:'independent_review_required',notified:true});
  expect(state().observations.at(-1).events.some(e=>e.event_type==='COMMANDER_SLEEP')).toBe(true);
  expect(E.brain.spans).toContainEqual(expect.objectContaining({run_id:`coding-workflow:${TASK}`,outcome:'unknown',evidence:expect.objectContaining({kind:'commander',events:state().observations.at(-1).events})}));
  expect(E.brain.patches.some(p=>p.body.result?.commander_overrides)).toBe(false);expect(calls).toHaveLength(1);
 });
 it('CI额度耗尽不能由Commander重置或归档',async()=>{
  fs.mkdirSync(sb.logDir,{recursive:true});const ci={attempts:[{head:'a'.repeat(40)},{head:'b'.repeat(40)}],escalated:{type:'ci_fix_exhausted',pr:77}};
  fs.writeFileSync(path.join(sb.logDir,'cifix-77.json'),JSON.stringify(ci));const r=await go();expect(r.exitCode,r.stderr).toBe(0);
  expect(business(JSON.parse(fs.readFileSync(path.join(sb.logDir,'cifix-77.json'),'utf8')))).toEqual(ci);expect(state().human.reason).toBe('independent_review_required');
 });
 it('同升级只提醒一次，历史裁决不恢复AI写权限',async()=>{
  E.seedState({rounds:[],escalated:{type:'qa_smoke_missing',pr:77,at:'same'}});fs.mkdirSync(sb.logDir,{recursive:true});
  fs.writeFileSync(path.join(sb.logDir,'commander-77.json'),JSON.stringify({interventions:[{n:1,action:'resume',rulings:[{verdict:'放行'}]}]}));
  await go();await E.closeBrain();await go('cmd-fix');expect(calls).toHaveLength(1);expect(state().observations).toHaveLength(1);expect(E.state().escalated.type).toBe('qa_smoke_missing');
 });
 it('历史已达介入上限仍待审，不恢复新预算',async()=>{
  E.seedState({rounds:[],escalated:{type:'qa_stalled',pr:77}});fs.mkdirSync(sb.logDir,{recursive:true});
  fs.writeFileSync(path.join(sb.logDir,'commander-77.json'),JSON.stringify({interventions:[{n:1},{n:2},{n:3}]}));await go();
  expect(E.state().escalated.type).toBe('qa_stalled');expect(E.state().stall_floor).toBeUndefined();expect(state().human.reason).toBe('independent_review_required');
 });
 it('基础设施类升级保留待审，不编造修复',async()=>{
  E.seedState({rounds:[],escalated:{type:'qa_preview_unavailable',pr:77}});await go();expect(state().human.reason).toBe('infra_escalation');expect(E.state().escalated.type).toBe('qa_preview_unavailable');
 });
 it('已关闭PR不新发监督或提醒',async()=>{
  E.seedState({rounds:[],escalated:{type:'qa_fix_failed',pr:77}});const r=await E.go(E.green({prStates:{77:'CLOSED'}}),{tasks:[{id:TASK,status:'completed',result:{}}],extra:{CODING_WF_COMMANDER:'1',CODING_WF_BARK_URL:url}});
  expect(r.exitCode,r.stderr).toBe(0);expect(calls).toHaveLength(0);
 });
 it('原关闭配置仍不启动监督或通知',async()=>{
  E.seedState({rounds:[],escalated:{type:'judge_contract_gap',pr:77}});await go('cmd-fix',{CODING_WF_COMMANDER:'0'});expect(calls).toHaveLength(0);expect(fs.existsSync(files.prompt)).toBe(false);
 });
});
