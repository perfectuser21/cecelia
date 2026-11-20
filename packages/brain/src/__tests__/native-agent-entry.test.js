import {afterEach,beforeEach,expect,test,vi} from 'vitest';
const io=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../db.js',()=>({default:{query:(...args)=>io.query(...args)}}));
vi.mock('../runtime-safety.js',async original=>({...await original(),assertExternalExecutionAllowed:()=>{}}));
// 唯一旧边界禁止真实SSH；实际被测件仍是统一执行漏斗。
vi.mock('../openclaw-agent-executor.js',()=>({triggerOpenclawAgent:async()=>{throw Error('retired OpenClaw launch reached');}}));
let executor;
beforeEach(async()=>{
 vi.resetModules();io.query.mockReset().mockImplementation(async(sql)=>sql.includes('SELECT * FROM tasks')?{rows:[task()],rowCount:1}:{rows:[],rowCount:1});
 for(const name of ['MACHINE_ID','RELEASE_ROOT','CLI_PATH','CONFIG_PATH','BUNDLE_SHA256'])vi.stubEnv('BRAIN_NATIVE_AGENT_'+name,'');
 executor=await import('../executor.js');
});
afterEach(()=>vi.unstubAllEnvs());
const task=(extra={})=>({id:'10000000-0000-4000-8000-000000000001',title:'Notion任务',task_type:'qiumi_task',status:'queued',
 payload:{qiumi_source:{body:'完整业务任务正文，明确账号不可切换，禁止另造任务或子会话。'},model:'openai/gpt-6.1-sol',qiumi_department:'media'},...extra});
test('Notion新任务缺受信native host配置时明确拒绝，不回落Gateway或自动选号Bridge',async()=>{
 await expect(executor.triggerCeceliaRun(task())).resolves.toMatchObject({success:false,reason:'native_agent_unconfigured'});
});
test('旧OpenClaw在途任务只能原身份读回收尾，统一入口不得重新启动它',async()=>{
 await expect(executor.triggerCeceliaRun(task({status:'in_progress',executor_kind:'openclaw-agent',payload:{run_id:'qiumi-original-1'}})))
  .resolves.toMatchObject({success:false,reason:'legacy_execution_read_only'});
});
test('独立核验旧transport标签不授权新OpenClaw会话，必须明确native准入失败',async()=>{
 await expect(executor.triggerCeceliaRun(task({task_type:'research',payload:{verification_transport:'openclaw-agent-v1'}})))
  .resolves.toMatchObject({success:false,reason:'native_agent_verification_binding_required'});
});
