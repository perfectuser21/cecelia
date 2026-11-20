import {randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
import {triggerNativeAgent} from '../native-agent-executor.js';
const sha='a'.repeat(64), host={machine_id:'us-mac-m4',cli_path:'/owned/releases/a/scripts/native-agent/cli.mjs',config_path:'/owned/releases/a/operator-config.json',bundle_sha256:sha};
const env={BRAIN_NATIVE_AGENT_MACHINE_ID:'us-mac-m4',BRAIN_NATIVE_AGENT_RELEASE_ROOT:'/owned/releases'};
function setup(body='【执行设置——启动前落实】\nAI账号：team2\n【执行参数】\n执行Agent：media\n模型：openai/gpt-6.1-sol\n思考强度：high\n超时：30分钟\n【执行参数结束】\n'+ '正文'.repeat(1600)+'\n固定业务账号保持不变，结尾验收必须保留。'){
 const task={id:randomUUID(),title:'业务任务',task_type:'qiumi_task',tenant_id:'tenant-a',status:'in_progress',executor_kind:'external-worker',claimed_by:'native-test',
  payload:{qiumi_department:'media',qiumi_kind:'agent',model:'openai/gpt-6.1-sol',thinking:'high',timeout_sec:1800,qiumi_source:{title:'业务任务',body,skill_ids:['fixture-skill'],notion_page_id:'page'}},result:{}};
 const requests=[];let stored;
 const pool={query:vi.fn(async(sql,params=[])=>{
  if(sql.includes('SELECT')&&sql.includes('FROM tasks'))return {rows:[task],rowCount:1};
  if(sql.includes('UPDATE tasks')&&sql.includes("'native_agent'")){task.result.native_agent=JSON.parse(params[1]);return {rows:[task],rowCount:1};}
  if(sql.includes("SET status='cancelled'")){task.status='cancelled';return {rows:[task],rowCount:1};}
  if(sql.includes("SET status='blocked'")){task.status='blocked';return {rows:[task],rowCount:1};}
  return {rows:[],rowCount:1};
 })};
 const deps={pool,env,resolveHost:async()=>host,startRun:async()=>({created:true}),setLease:async()=>{},recordEvent:async()=>{},finishRun:async()=>({updated:true}),releaseLocks:async()=>{},
  finalizeTask:async(_pool,_id,status)=>{task.status=status;return {rowCount:1,task};},
  transport:async(actualHost,request)=>{requests.push({host:actualHost,request});if(request.action==='start')stored=request;
   return {...stored,...request,protocol:'native-agent/v1',status:'running',launch_state:'running',execution_stopped:false,summary:'执行中',evidence:[],
    frozen:{config_digest:sha,profile_digest:sha,command_digest:sha,skills_digest:sha,source_digest:sha,auth_identity_sha256:sha}};}};
 return {task,pool,deps,requests};
}
test('完整Notion正文/固定账号/模型/技能/毫秒预算送达原生入口，不使用description短副本',async()=>{
 const f=setup();const result=await triggerNativeAgent(f.task,f.deps);
 expect(result).toMatchObject({success:true,executor:'native-agent'});
 expect(f.requests[0].request).toMatchObject({protocol:'native-agent/v1',action:'start',tenant:'tenant-a',department:'media',role:'agent',account_ref:'team2',model:'openai/gpt-6.1-sol',thinking:'high',skill_ids:['fixture-skill'],timeout_ms:1800000});
 expect(f.requests[0].request.prompt).toContain('固定业务账号保持不变，结尾验收必须保留。');
 expect(f.requests[0].request.prompt.length).toBeGreaterThan(3000);
});
test('同任务已持久绑定时二次调用只inspect原run，不能重新start或改账号',async()=>{
 const f=setup();await triggerNativeAgent(f.task,f.deps);await triggerNativeAgent(f.task,f.deps);
 expect(f.requests.map(x=>x.request.action)).toEqual(['start','inspect']);
 expect(f.requests[1].request.run_id).toBe(f.requests[0].request.run_id);
 expect(f.requests[1].request).not.toHaveProperty('prompt');
 expect(f.requests[1].host).toEqual(host);
});
test('没有明确AI账号就阻塞，不能按最空闲账号或profile默认值启动',async()=>{
 const f=setup('【执行参数】\n执行Agent：media\n模型：openai/gpt-6.1-sol\n【执行参数结束】\n禁止自行指定账号。');
 const result=await triggerNativeAgent(f.task,f.deps);
 expect(result).toMatchObject({success:false,reason:'native_agent_account_required'});
 expect(f.requests).toEqual([]);
});
test('host返回另一run身份只能标未知，不把它当成已接受的原运行',async()=>{
 const f=setup(),transport=f.deps.transport;
 f.deps.transport=async(...args)=>({...await transport(...args),run_id:randomUUID()});
 const result=await triggerNativeAgent(f.task,f.deps);
 expect(result).toMatchObject({success:false,dispatchUncertain:true});
 expect(f.task.status).toBe('in_progress');
});

test('完成字样没有原child退出证明时不得完成或释放资源',async()=>{
 const f=setup(),transport=f.deps.transport;
 f.deps.transport=async(...args)=>({...await transport(...args),status:'completed',launch_state:'running',execution_stopped:false});
 const result=await triggerNativeAgent(f.task,f.deps);
 expect(result).toMatchObject({success:false,dispatchUncertain:true});
 expect(f.task.status).toBe('in_progress');
});
test('原binding取消只发原run cancel，确认已知进程组退出后才写cancelled',async()=>{
 const f=setup();expect((await triggerNativeAgent(f.task,f.deps)).success).toBe(true);
 f.task.result.native_agent.cancel_requested=true;
 const transport=f.deps.transport;
 f.deps.transport=async(...args)=>({...await transport(...args),status:'cancelled',launch_state:'stopped',execution_stopped:true,termination_scope:'known_process_group',result:{child_exited:true,exit_code:null,signal:'SIGTERM',stdout:'',stderr:''}});
 await triggerNativeAgent(f.task,f.deps);
 expect(f.requests.map(x=>x.request.action)).toEqual(['start','cancel']);
 expect(f.requests[1].request.run_id).toBe(f.requests[0].request.run_id);
 expect(f.task.status).toBe('cancelled');
});
