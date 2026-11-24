import {expect,test,vi} from 'vitest';
import {routeQiumiTask} from '../qiumi-router.js';
const pool={query:vi.fn(async()=>({rows:[],rowCount:1}))};
test('普通Notion入口无需切换旗标，只用受信默认与显式约束，不请求旧模型',async()=>{
 const fetchFn=vi.fn(()=>{throw Error('旧分类不可调用');});
 const decision=await routeQiumiTask({id:'10000000-0000-4000-8000-000000000001',tenant_id:'fixture',payload:{native_agent_content:{protocol:'notion-complete-body/v1',complete:true,empty_body:false,page_ids:['fixture-page']},qiumi_source:{body:'整理资料并回填本页。'}}},{pool,env:{departments:['main'],deviceKeywords:[]},fetchFn,callLLMFn:fetchFn});
 expect(decision).toMatchObject({outcome:'agent',department:'main',kind:'agent',payloadPatch:{provider:'native-agent',qiumi_route:{source:'native-agent'}}});
 expect(decision.payloadPatch).not.toHaveProperty('run_id');
 expect(fetchFn).not.toHaveBeenCalled();
});
test('native显式设备无唯一台账身份必须停放，不能成为无锁普通任务',async()=>{
 const result=await routeQiumiTask({id:'10000000-0000-4000-8000-000000000001',payload:{native_agent_content:{protocol:'notion-complete-body/v1',complete:true,empty_body:false,page_ids:['fixture-page']},qiumi_source:{body:'【执行参数】\n设备：fixture-phone\n【执行参数结束】\n操作手机'}}},{pool,env:{nativeAgent:true,departments:['main'],deviceKeywords:[]}});
 expect(result).toMatchObject({outcome:'unresolved',reason:'device_unresolved'});
});
const relationTask=body=>({id:'10000000-0000-4000-8000-000000000001',payload:{native_agent_content:{protocol:'notion-complete-body/v1',complete:true,empty_body:false,page_ids:['fixture-page']},qiumi_source:{body,agent_workflow_ids:['20000000-0000-4000-8000-000000000002']}}});
test('已登记的非部门Agent relation必须原样送受信角色匹配，不能静默换成main',async()=>{
 const registry={query:async sql=>({rows:sql.includes('FROM ops_agents')?[{name:'explicit-special-agent',notion_id:'20000000-0000-4000-8000-000000000002'}]:[],rowCount:0})};
 expect(await routeQiumiTask(relationTask('请按指定执行者处理'),{pool:registry,env:{nativeAgent:true}})).toMatchObject({outcome:'agent',department:'explicit-special-agent',payloadPatch:{qiumi_department:'explicit-special-agent'}});
});
test('有未识别Agent/旧Workflow relation时明确停放，不能伪普通main任务',async()=>{
 expect(await routeQiumiTask(relationTask('指定关系必须保留'),{pool,env:{nativeAgent:true}})).toMatchObject({outcome:'blocked',reason:'native_agent_agent_binding_required'});
});
test('正文显式Agent优先于未知relation，但不改变固定账号/模型选择',async()=>{
 expect(await routeQiumiTask(relationTask('【执行参数】\n执行Agent：main\n【执行参数结束】\n由main处理'),{pool,env:{nativeAgent:true}})).toMatchObject({outcome:'agent',department:'main'});
});
for(const id of ['adblock','native_adb_worker','abcadb123','a'.repeat(29)+'adb'+'b'.repeat(32),'abcADB123','00000adb-0000-4000-8000-000000000000','00000abc-adb0-4000-8000-000000000000','00000abc-0000-4adb-8000-000000000000','00000abc-0000-4000-8adb-000000000000','00000abc-0000-4000-8000-000000000adb'])test(`任务标识里的adb不是设备意图：${id}`,async()=>{
 const task={id,tenant_id:'fixture',payload:{native_agent_content:{protocol:'notion-complete-body/v1',complete:true,empty_body:false,page_ids:['fixture-page']},qiumi_source:{body:'NATIVE_HANG '+id}}};
 expect(await routeQiumiTask(task,{pool,env:{nativeAgent:true}})).toMatchObject({outcome:'agent',department:'main',payloadPatch:{provider:'native-agent'}});
});
for(const body of ['adb shell 检查设备','ADB shell 检查设备','用adb检查设备','/usr/bin/adb shell','adb.exe shell','`adb shell`','adb -s requested-device shell'])test(`真实ADB请求未指定唯一设备仍停放：${body}`,async()=>{
 const task={id:'10000000-0000-4000-8000-000000000001',payload:{native_agent_content:{protocol:'notion-complete-body/v1',complete:true,empty_body:false,page_ids:['fixture-page']},qiumi_source:{body}}};
 expect(await routeQiumiTask(task,{pool,env:{nativeAgent:true}})).toMatchObject({outcome:'unresolved',reason:'device_unresolved'});
});
