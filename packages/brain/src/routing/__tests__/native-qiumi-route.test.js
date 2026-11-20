import {expect,test,vi} from 'vitest';
import {routeQiumiTask} from '../qiumi-router.js';
const pool={query:vi.fn(async()=>({rows:[],rowCount:1}))};
test('native普通Notion任务只用受信默认和显式约束，不请求旧Jev或生成OpenClaw运行号',async()=>{
 const fetchFn=vi.fn(()=>{throw Error('旧分类不可调用');});
 const decision=await routeQiumiTask({id:'10000000-0000-4000-8000-000000000001',tenant_id:'fixture',payload:{qiumi_source:{body:'整理资料并回填本页。'}}},{pool,env:{nativeAgent:true,departments:['main'],deviceKeywords:[]},fetchFn,callLLMFn:fetchFn});
 expect(decision).toMatchObject({outcome:'agent',department:'main',kind:'agent',payloadPatch:{provider:'native-agent',qiumi_route:{source:'native-agent'}}});
 expect(decision.payloadPatch).not.toHaveProperty('run_id');
 expect(fetchFn).not.toHaveBeenCalled();
});
test('native显式设备无唯一台账身份必须停放，不能成为无锁普通任务',async()=>{
 const result=await routeQiumiTask({id:'10000000-0000-4000-8000-000000000001',payload:{qiumi_source:{body:'【执行参数】\n设备：fixture-phone\n【执行参数结束】\n操作手机'}}},{pool,env:{nativeAgent:true,departments:['main'],deviceKeywords:[]}});
 expect(result).toMatchObject({outcome:'unresolved',reason:'device_unresolved'});
});
