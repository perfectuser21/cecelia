import {randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
import {triggerNativeAgent} from '../native-agent-executor.js';
const sha='a'.repeat(64), host={machine_id:'us-mac-m4',cli_path:'/owned/releases/a/scripts/native-agent/cli.mjs',config_path:'/owned/releases/a/operator-config.json',bundle_sha256:sha};
const env={BRAIN_NATIVE_AGENT_DEFAULT_ACCOUNT_REF:'',BRAIN_NATIVE_AGENT_DEFAULT_MODEL:'',BRAIN_NATIVE_AGENT_DEFAULT_THINKING:'',BRAIN_NATIVE_AGENT_DEFAULT_TIMEOUT_SEC:'',BRAIN_NATIVE_AGENT_MACHINE_ID:'us-mac-m4',BRAIN_NATIVE_AGENT_RELEASE_ROOT:'/owned/releases'};
function setup(body='【执行设置——启动前落实】\nAI账号：team2\n【执行参数】\n执行Agent：media\n模型：openai/gpt-6.1-sol\n思考强度：high\n超时：30分钟\n【执行参数结束】\n'+ '正文'.repeat(1600)+'\n固定业务账号保持不变，结尾验收必须保留。'){
 const task={id:randomUUID(),title:'业务任务',task_type:'qiumi_task',tenant_id:'tenant-a',status:'in_progress',executor_kind:'external-worker',claimed_by:'native-test',
  payload:{native_agent_content:{protocol:'notion-complete-body/v1',complete:true,empty_body:false,page_ids:['fixture-page']},qiumi_department:'media',qiumi_kind:'agent',model:'openai/gpt-6.1-sol',thinking:'high',timeout_sec:1800,qiumi_source:{title:'业务任务',body,skill_ids:['fixture-skill'],notion_page_id:'page'}},result:{}};
 const requests=[];let stored,serverContext;
 const pool={query:vi.fn(async(sql,params=[])=>{
  if(sql.includes('SELECT context FROM task_runs'))return {rows:[{context:serverContext}],rowCount:1};
  if(sql.includes('SELECT')&&sql.includes('FROM tasks'))return {rows:[task],rowCount:1};
  if(sql.includes('UPDATE tasks')&&sql.includes("jsonb_build_object('native_agent'")){task.result.native_agent=JSON.parse(params[1]);return {rows:[task],rowCount:1};}
  if(sql.includes("SET status='cancelled'")){task.status='cancelled';return {rows:[task],rowCount:1};}
  if(sql.includes('INSERT INTO pending_actions'))return {rows:[{id:'30000000-0000-4000-8000-000000000003'}],rowCount:1};
  if(sql.includes("SET status='blocked'")){task.status='blocked';return {rows:[task],rowCount:1};}
  return {rows:[],rowCount:1};
 })};
 const deps={pool,env:{...env},resolveHost:async()=>host,startRun:async input=>{serverContext={...input.context,source:input.source};return {created:true,id:'20000000-0000-4000-8000-000000000002'};},setLease:async()=>{},recordEvent:async()=>{},finishRun:async()=>({updated:true}),releaseLocks:async()=>{},
  finalizeTask:async(_pool,_id,status)=>{task.status=status;return {rowCount:1,task};},
  transport:async(actualHost,request)=>{requests.push({host:actualHost,request});if(request.action==='start')stored=request;
   return {...stored,...request,protocol:'native-agent/v1',actual_cli_model:'gpt-6.2-sol',status:'running',launch_state:'running',execution_stopped:false,summary:'执行中',evidence:[],
    frozen:{config_digest:sha,profile_digest:sha,command_digest:sha,skills_digest:sha,source_digest:sha,auth_identity_sha256:sha,stdin_digest:sha,codex_config_sha256:sha,codex_config_present:true,permissions_digest:sha}};}};
 return {task,pool,deps,requests};
}
test('完整Notion正文/固定账号/模型/技能/毫秒预算送达原生入口，不使用description短副本',async()=>{
 const f=setup();const result=await triggerNativeAgent(f.task,f.deps);
 expect(result,JSON.stringify(result)).toMatchObject({success:true,executor:'native-agent'});
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
test('普通Notion正文无需用户填写内部参数，使用部署受信默认且不调用分类模型',async()=>{
 const f=setup('请整理一次资料并回填本页，保留全部原始来源与结论。');
 f.task.payload={native_agent_content:{protocol:'notion-complete-body/v1',complete:true,empty_body:false,page_ids:['fixture-page']},qiumi_source:{body:'请整理一次资料并回填本页，保留全部原始来源与结论。'}};f.task.kind='agent';
 Object.assign(f.deps.env,{BRAIN_NATIVE_AGENT_DEFAULT_ACCOUNT_REF:'trusted-team',BRAIN_NATIVE_AGENT_DEFAULT_MODEL:'gpt-6.2-sol',BRAIN_NATIVE_AGENT_DEFAULT_THINKING:'high',BRAIN_NATIVE_AGENT_DEFAULT_TIMEOUT_SEC:'1800',BRAIN_NATIVE_AGENT_DEFAULT_DEPARTMENT:'main'});
 const result=await triggerNativeAgent(f.task,f.deps);
 expect(result,JSON.stringify(result)).toMatchObject({success:true});
 expect(f.requests[0].request).toMatchObject({account_ref:'trusted-team',model:'gpt-6.2-sol',thinking:'high',timeout_ms:1800000,department:'main',role:'agent'});
});
test('用户显式账号和模型优先于部署默认，不能为了启动静默换号换模型',async()=>{
 const f=setup();Object.assign(f.deps.env,{BRAIN_NATIVE_AGENT_DEFAULT_ACCOUNT_REF:'other-team',BRAIN_NATIVE_AGENT_DEFAULT_MODEL:'gpt-6.2-sol'});
 const result=await triggerNativeAgent(f.task,f.deps);
 expect(result,JSON.stringify(result)).toMatchObject({success:true});
 expect(f.requests[0].request).toMatchObject({account_ref:'team2',model:'openai/gpt-6.1-sol'});
});
for(const outcome of ['cancelled','timed_out','failed'])test(`${outcome}已知进程组退出不证明设备外部清理，原设备锁必须保留待核`,async()=>{
 const f=setup(),query=f.pool.query.getMockImplementation();let locked=true;
 f.pool.query.mockImplementation((sql,...args)=>sql.startsWith('SELECT device_name')?Promise.resolve({rows:[{device_name:'owned-phone',acquisition_version:'123'}]}):query(sql,...args));
 f.deps.releaseLocks=async()=>{locked=false;};
 expect((await triggerNativeAgent(f.task,f.deps)).success).toBe(true);
 f.task.result.native_agent.cancel_requested=outcome==='cancelled';
 const transport=f.deps.transport;
 f.deps.transport=async(...args)=>({...await transport(...args),status:outcome,launch_state:'stopped',execution_stopped:true,termination_scope:'known_process_group',result:{child_exited:true,exit_code:null,signal:'SIGTERM',stdout:'',stderr:''}});
 await triggerNativeAgent(f.task,f.deps);
 expect(locked).toBe(true);
 expect(f.task.status).toBe('blocked');
});
test('显式设备必须在首个native start前取得实际设备锁，繁忙不能启动',async()=>{
 const f=setup();f.task.payload.device_serial='owned-phone';f.task.payload.qiumi_route={source:'native-agent',device_hint:{serial:'owned-phone'}};
 const acquired=[];f.deps.acquireDeviceLock=async(...args)=>{acquired.push(args);return {result:'locked'};};
 const result=await triggerNativeAgent(f.task,f.deps);
 expect(acquired).toHaveLength(1);expect(acquired[0].slice(0,2)).toEqual([f.task.id,'owned-phone']);
 expect(result).toMatchObject({success:false,reason:'native_agent_device_locked'});expect(f.requests).toEqual([]);
});
test('首个host响应未知也先持有Brain租约，不把真实已起会话交给通用过期回收',async()=>{
 const f=setup();f.deps.setLease=vi.fn(async()=>{});f.deps.transport=async()=>{throw Error('lost response');};
 expect(await triggerNativeAgent(f.task,f.deps)).toMatchObject({success:false,dispatchUncertain:true});
 expect(f.deps.setLease).toHaveBeenCalledWith(f.pool,f.task.id,2700);
});
test('TaskRun终态未确认不能只凭host完成就终态Task或释放资源',async()=>{
 const f=setup(),transport=f.deps.transport;f.deps.finishRun=async()=>({updated:false});
 f.deps.transport=async(...args)=>({...await transport(...args),status:'completed',launch_state:'stopped',execution_stopped:true,result:{child_exited:true,exit_code:0,stdout:'',stderr:''}});
 expect(await triggerNativeAgent(f.task,f.deps)).toMatchObject({success:false,dispatchUncertain:true});
 expect(f.task.status).toBe('in_progress');
});
test('既有绑定删掉资源字段不能降级成纯文本运行，资源真值由原TaskRun冻结',async()=>{
 const f=setup(),query=f.pool.query.getMockImplementation();let context;
 f.pool.query.mockImplementation((sql,...args)=>sql.startsWith('SELECT device_name')?Promise.resolve({rows:[{device_name:'original-phone',acquisition_version:'123'}]}):sql.includes('SELECT context FROM task_runs')?Promise.resolve({rows:[{context}],rowCount:1}):query(sql,...args));
 f.deps.startRun=async input=>{context={...input.context,source:input.source};return {id:'20000000-0000-4000-8000-000000000002'};};
 await triggerNativeAgent(f.task,f.deps);expect(context.native_agent.resource_bound).toBe(true);
 f.task.result.native_agent.device_locks=[];f.task.result.native_agent.resources={};
 const result=await triggerNativeAgent(f.task,f.deps);
 expect(result).toMatchObject({success:false,dispatchUncertain:true,reason:'native_agent_binding_unconfirmed'});
 expect(f.requests).toHaveLength(1);
});
test('服务端仍有同Task原生Run时，外部JSON抹绑定也不能重新启动或伪not_started',async()=>{
 const f=setup();await triggerNativeAgent(f.task,f.deps);const query=f.pool.query.getMockImplementation();
 f.task.result.native_agent=null;
 f.pool.query.mockImplementation((sql,...args)=>sql.includes(' AS native_owned')?Promise.resolve({rows:[{native_owned:true}],rowCount:1}):query(sql,...args));
 expect(await triggerNativeAgent(f.task,f.deps)).toMatchObject({success:false,dispatchUncertain:true,reason:'native_agent_binding_unconfirmed'});
 expect(f.requests).toHaveLength(1);expect(f.task.status).toBe('in_progress');
});
