import {createRequire} from 'node:module';
import {it,expect} from 'vitest';
const require=createRequire(import.meta.url),{createRpcPolicy}=require('./app-server-rpc.cjs');
it('pending验收流只能读固定元数据，不能登录、执行或开始模型turn',()=>{
 const policy=createRpcPolicy({canary:true});
 for(const method of ['thread/start','turn/start','command/exec','account/login/start']){
  expect(policy.client({id:method,method,params:{}}).reply?.error.message).toBe('appserver_canary_method_denied');
 }
 expect(policy.server({id:'tool',method:'item/tool/call',params:{}}).reply?.error.message).toBe('appserver_canary_method_denied');
});
it('验收不可通过config/read读取调用者指定目录，未完成请求不能形成成功证据',()=>{
 const policy=createRpcPolicy({canary:true});
 expect(policy.client({id:1,method:'config/read',params:{cwd:'/etc',includeLayers:true}}).reply?.error.message).toBe('appserver_canary_params_denied');
 expect(policy.canaryEvidence()).toMatchObject({complete:false,rejected:1});
});
it('真实请求响应关联后仅保留摘要；错误响应或重复方法不能通过验收',()=>{
 const policy=createRpcPolicy({canary:true});
 const requests=[{id:1,method:'initialize',params:{clientInfo:{name:'cecelia-canary',version:'1'}}},
  {id:2,method:'model/list'},{id:3,method:'config/read',params:{includeLayers:false}},{id:4,method:'configRequirements/read'}];
 for(const frame of requests){
  expect(policy.client(frame).forward).toEqual(frame);
  const result=frame.method==='initialize'?{userAgent:'codex_cli_rs/0.158.0'}:frame.method==='model/list'?{data:[],nextCursor:null}:frame.method==='config/read'?{config:{privateMetadata:'private metadata must not enter evidence'}}:{requirements:null};
  expect(policy.server({id:frame.id,result}).forward.result).toEqual(result);
 }
 expect(policy.client({method:'initialized'}).forward).toEqual({method:'initialized'});
 const evidence=policy.canaryEvidence();expect(evidence.complete).toBe(true);expect(evidence.methods).toHaveLength(4);
 expect(JSON.stringify(evidence)).not.toContain('private metadata');
 expect(policy.client({...requests[1],id:5}).reply?.error.message).toBe('appserver_canary_method_reused');
 expect(policy.canaryEvidence().complete).toBe(false);
 const failed=createRpcPolicy({canary:true});failed.client(requests[0]);failed.server({id:1,error:{code:-1,message:'failed'}});
 expect(failed.canaryEvidence()).toMatchObject({complete:false,failed:1});
});
it('空壳result不能冒充固定Codex版本与协议响应',()=>{
 const policy=createRpcPolicy({canary:true});
 for(const [id,method]of ['initialize','model/list','config/read','configRequirements/read'].entries()){
  const frame={id,method,...(method==='initialize'?{params:{clientInfo:{name:'canary',version:'1'}}}:{})};
  policy.client(frame);policy.server({id,result:{testMetadata:true}});
 }
 policy.client({method:'initialized'});expect(policy.canaryEvidence()).toMatchObject({complete:false,failed:4});
});
