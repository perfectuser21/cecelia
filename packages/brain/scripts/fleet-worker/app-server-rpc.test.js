import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let api;try{api=require('./app-server-rpc.cjs');}catch{api={};}
const client=(policy,id,method,params={})=>policy.client({id,method,params});
it('宿主MCP模式保留原生MCP关闭核验所需只读状态接口，拒绝未知参数',()=>{
 const p=api.createRpcPolicy();
 const params={threadId:'offline-thread',detail:'toolsAndAuthOnly'};
 expect(client(p,1,'mcpServerStatus/list',params).forward).toEqual({id:1,method:'mcpServerStatus/list',params});
 expect(p.server({id:1,result:{data:[],nextCursor:null}}).forward).toBeTruthy();
 for(const bad of [{...params,execute:true},{...params,detail:'execute'},{...params,threadId:1}]){
  expect(client(p,2,'mcpServerStatus/list',bad).reply.error.message).toBe('appserver_rpc_params_invalid');
 }
});
it.each([null,'openclaw','openclaw_direct'])('现网72个Notion工具在%s显式授权后完整通过声明与回调，未授权账号和执行别名仍拒绝',namespace=>{
 const names=require('./app-server-notion-tools.fixture.json');
 expect(names).toHaveLength(72);
 const p=api.createRpcPolicy({hostTools:names});
 const tools=names.map(name=>({type:'function',name,description:name,inputSchema:{}}));
 const dynamicTools=namespace?[{type:'namespace',name:namespace,description:'tools',tools}]:tools;
 const forwarded=client(p,1,'thread/start',{dynamicTools}).forward;
 expect(forwarded.params.dynamicTools).toEqual(dynamicTools);
 for(const name of names)expect(p.server({id:name,method:'item/tool/call',params:{tool:name,...(namespace?{namespace}:{}),arguments:{},threadId:'t',turnId:'u',callId:'c'}}).forward).toBeTruthy();
 const selected=api.createRpcPolicy({hostTools:['notion-owner__API-post-search']});
 expect(client(selected,1,'thread/start',{dynamicTools:tools}).forward.params.dynamicTools.map(t=>t.name)).toEqual(['notion-owner__API-post-search']);
 for(const tool of ['notion-yujin__API-post-search','notion-owner__API-exec','notion-unknown__API-post-search','exec','gateway_exec','sessions_spawn']){
  expect(selected.server({id:tool,method:'item/tool/call',params:{tool,namespace:'openclaw',arguments:{},threadId:'old',turnId:'u',callId:'c'}}).reply.error.message).toBe('appserver_host_tool_denied');
 }
 expect(client(api.createRpcPolicy(),1,'thread/start',{dynamicTools:tools}).forward.params.dynamicTools).toEqual([]);
});
it('现网searchable namespace保留已授权业务工具，声明不能增加profile权限',()=>{
 const p=api.createRpcPolicy({hostTools:['read','message','memory_get']});
 const tools=[{type:'namespace',name:'openclaw',description:'OpenClaw tools',tools:
  ['read','message','memory_get','exec','sessions_spawn','web_fetch'].map(name=>({type:'function',name,description:name,inputSchema:{}}))}];
 expect(client(p,1,'thread/start',{dynamicTools:tools}).forward.params.dynamicTools[0].tools.map(t=>t.name)).toEqual(['read','message','memory_get']);
 for(const name of ['read','message','memory_get']){
  expect(p.server({id:name,method:'item/tool/call',params:{tool:name,namespace:'openclaw',arguments:{},threadId:'t',turnId:'u',callId:'c'}}).forward).toBeTruthy();
 }
 for(const name of ['exec','sessions_spawn','web_fetch']){
  expect(p.server({id:name,method:'item/tool/call',params:{tool:name,namespace:'openclaw',arguments:{},threadId:'t',turnId:'u',callId:'c'}}).reply?.error.message).toBe('appserver_host_tool_denied');
 }
});
it('缺profile授权的默认工具集仍不开放业务写入，合法openclaw命名空间不误删read',()=>{
 const p=api.createRpcPolicy();
 const tools=[{type:'namespace',name:'openclaw',description:'tools',tools:['read','message'].map(name=>({type:'function',name,description:name,inputSchema:{}}))}];
 expect(client(p,1,'thread/start',{dynamicTools:tools}).forward.params.dynamicTools[0].tools.map(t=>t.name)).toEqual(['read']);
});
it('真实插件无参请求保留null合同，显式null不能冒充对象参数',()=>{
 for(const method of ['configRequirements/read','account/logout']){
  for(const params of [undefined,null]){
   const p=api.createRpcPolicy(),frame={id:1,method,...(params===undefined?{}:{params})};
   expect(p.client(frame).forward).toEqual(frame);
   expect(p.server({id:1,result:null}).forward).toBeTruthy();
  }
  expect(client(api.createRpcPolicy(),1,method,{}).reply?.error.message).toBe('appserver_rpc_params_invalid');
 }
 expect(api.createRpcPolicy().client({id:1,method:'model/list'}).forward).toBeTruthy();
 expect(client(api.createRpcPolicy(),1,'model/list',null).reply?.error.message).toBe('appserver_rpc_params_invalid');
});
it('固定0.158 experimental真实插件字段可通过，未知方法/字段和错误类型拒绝',()=>{
 expect(api.createRpcPolicy).toBeTypeOf('function');const p=api.createRpcPolicy();
 expect(client(p,1,'initialize',{clientInfo:{name:'openclaw',version:'2026.9.7'},capabilities:{experimentalApi:true}}).forward.method).toBe('initialize');
 p.server({id:1,result:{userAgent:'codex/0.158.0'}});p.client({method:'initialized'});
 expect(client(p,2,'thread/start',{dynamicTools:[],experimentalRawEvents:true,runtimeWorkspaceRoots:['/workspace'],config:{'features.code_mode':true}}).forward.method).toBe('thread/start');
 expect(client(p,3,'thread/resume',{threadId:'t',initialTurnsPage:{limit:1,sortDirection:'desc',itemsView:'notLoaded'}}).forward.method).toBe('thread/resume');
 expect(client(p,4,'unknown/execute').reply.error.message).toBe('appserver_rpc_method_denied');
 expect(client(p,5,'turn/start',{threadId:'t',input:'wrong'}).reply.error.message).toBe('appserver_rpc_params_invalid');
 expect(client(p,6,'thread/start',{newPower:true}).reply.error.message).toBe('appserver_rpc_params_invalid');
});
it('动态工具声明删除全部宿主执行别名，旧thread服务端回调同样拒绝且不向插件转发',()=>{
 expect(api.createRpcPolicy).toBeTypeOf('function');const p=api.createRpcPolicy();
 const tools=['exec','process','gateway_exec','gateway_process','node_exec','sandbox_exec','sandbox_process','read'].map(name=>({type:'function',name,description:name,inputSchema:{type:'object'}}));
 const r=client(p,1,'thread/start',{dynamicTools:tools});expect(r.forward.params.dynamicTools.map(t=>t.name)).toEqual(['read']);
 const blocked=p.server({id:'old',method:'item/tool/call',params:{tool:'exec',namespace:'functions',arguments:{command:'do not execute'},threadId:'old-thread',turnId:'turn',callId:'call'}});
 expect(blocked.forward).toBeUndefined();expect(blocked.reply.error.message).toBe('appserver_host_tool_denied');
});
it('pending turn不能堵interrupt/steer/terminate/认证回应；方向ID独立，重复ID与未知回应拒绝',()=>{
 expect(api.createRpcPolicy).toBeTypeOf('function');const p=api.createRpcPolicy({accountId:'account'});
 expect(client(p,1,'turn/start',{threadId:'t',input:[]}).forward).toBeTruthy();
 expect(client(p,2,'turn/interrupt',{threadId:'t',turnId:'u'}).forward).toBeTruthy();
 expect(client(p,3,'turn/steer',{threadId:'t',expectedTurnId:'u',input:[]}).forward).toBeTruthy();
 expect(client(p,4,'command/exec/terminate',{processId:'p'}).forward).toBeTruthy();
 expect(p.server({id:1,method:'account/chatgptAuthTokens/refresh',params:{reason:'unauthorized'}}).forward).toBeTruthy();
 expect(p.client({id:1,result:{accessToken:'memory-only',chatgptAccountId:'account'}}).forward).toBeTruthy();
 expect(client(p,1,'model/list').reply.error.message).toBe('appserver_rpc_id_reused');
 expect(()=>p.client({id:99,result:{accessToken:'never echo'}})).toThrow('appserver_rpc_response_unknown');
});
it('写后失去响应不生成重放；已用ID即便响应完成仍拒复用；pending与总会话ID数量有界',()=>{
 expect(api.createRpcPolicy).toBeTypeOf('function');const p=api.createRpcPolicy({maxPending:2,maxIds:3});
 client(p,1,'model/list');p.server({id:1,result:{data:[],nextCursor:null}});
 expect(client(p,1,'model/list').reply.error.message).toBe('appserver_rpc_id_reused');
 client(p,2,'model/list');client(p,3,'model/list');
 expect(client(p,4,'model/list').reply.error.message).toBe('appserver_rpc_session_limit');
 expect(p.close()).toEqual({uncertain:true});expect(()=>client(p,5,'model/list')).toThrow('appserver_rpc_closed');
});
it('真实0.158 namespace工具声明递归删除宿主执行；账号登录/刷新只能绑定受信账号',()=>{
 const p=api.createRpcPolicy({accountId:'bound-account'});
 const tools=[{type:'namespace',name:'functions',description:'tools',tools:[{type:'function',name:'exec',description:'exec',inputSchema:{}},{type:'function',name:'read',description:'read',inputSchema:{}}]}];
 expect(client(p,1,'thread/start',{dynamicTools:tools}).forward.params.dynamicTools[0].tools.map(x=>x.name)).toEqual(['read']);
 expect(client(p,2,'account/login/start',{type:'chatgptAuthTokens',accessToken:'memory-only',chatgptAccountId:'other'}).reply.error.message).toBe('appserver_account_binding_denied');
 expect(client(p,3,'account/login/start',{type:'chatgptAuthTokens',accessToken:'memory-only',chatgptAccountId:'bound-account'}).forward).toBeTruthy();
 p.server({id:'auth',method:'account/chatgptAuthTokens/refresh',params:{reason:'unauthorized'}});
 expect(()=>p.client({id:'auth',result:{accessToken:'secret',chatgptAccountId:'other'}})).toThrow('appserver_account_binding_denied');
});
it('固定官方schema关键字与Ajv一致；严格顶层额外字段另行拒绝',()=>{
 const Ajv=require('ajv'),contract=require('./app-server-contract.json');const ajv=new Ajv({strict:false,validateFormats:false,logger:false});
 const cases=[['thread/start',{dynamicTools:[{type:'function',name:'read',description:'read',inputSchema:{}}]}],['thread/start',{dynamicTools:[{type:'function',name:42,description:'read',inputSchema:{}}]}],['turn/start',{threadId:'t',input:[{type:'text',text:'hello',text_elements:[]}]}],['turn/start',{threadId:1,input:[]}],['command/exec',{command:['echo','x'],timeoutMs:-1}],['thread/resume',{threadId:'t',initialTurnsPage:{limit:1,sortDirection:'desc',itemsView:'notLoaded'}}]];
 for(const [method,params]of cases){const schema={...contract.client.methods[method],definitions:contract.client.definitions};expect(api.valid(params,schema,contract.client.definitions)).toBe(ajv.compile(schema)(params));}
 expect(contract.client.definitions.DynamicToolSpec.oneOf[0].properties.description.type).toBe('string');
});
it('服务端namespace本身为宿主执行别名也拒绝；未决请求数量有界',()=>{
 const p=api.createRpcPolicy({maxPending:1});client(p,1,'model/list');expect(client(p,2,'model/list').reply.error.message).toBe('appserver_rpc_session_limit');
 const callback=p.server({id:'host',method:'item/tool/call',params:{tool:'run',namespace:'exec',arguments:{},threadId:'t',turnId:'u',callId:'c'}});expect(callback.reply.error.message).toBe('appserver_host_tool_denied');
});

it('方法白名单拒绝三个方向的继承属性，不能把原型当作空schema',()=>{
 for(const method of ['__proto__','constructor','toString']){
  const p=api.createRpcPolicy();
  expect(p.client({id:1,method,params:{}}).reply?.error.message).toBe('appserver_rpc_method_denied');
  expect(p.server({id:2,method,params:{}}).reply?.error.message).toBe('appserver_rpc_method_denied');
  expect(()=>p.server({method,params:{}})).toThrow('appserver_rpc_notification_denied');
 }
});
it('网关派生执行和未知动态工具在声明及旧线程回调两端默认拒绝',()=>{
 const p=api.createRpcPolicy();
 const names=['sessions_spawn','nodes','openclaw','unregistered_executor','constructor','read'];
 const tools=names.map(name=>({type:'function',name,description:name,inputSchema:{}}));
 expect(client(p,1,'thread/start',{dynamicTools:tools}).forward.params.dynamicTools.map(t=>t.name)).toEqual(['read']);
 for(const name of names.slice(0,-1)){
  expect(p.server({id:name,method:'item/tool/call',params:{tool:name,namespace:'functions',arguments:{},threadId:'t',turnId:'u',callId:'c'}}).reply?.error.message).toBe('appserver_host_tool_denied');
 }
 expect(p.server({id:'foreign-namespace',method:'item/tool/call',params:{tool:'read',namespace:'executor',arguments:{},threadId:'t',turnId:'u',callId:'c'}}).reply?.error.message).toBe('appserver_host_tool_denied');
});

it('真实0.158通知emittedAtMs保留有界时间戳，随后请求仍可用；不能扩大请求或未知字段授权',()=>{
 const p=api.createRpcPolicy(),notification={method:'configWarning',params:{summary:'isolated canary warning',details:null},emittedAtMs:1790881000000};
 expect(p.server(notification).forward).toEqual(notification);
 expect(p.client({method:'initialized'}).forward).toBeTruthy();
 expect(client(p,1,'model/list').forward).toBeTruthy();expect(p.server({id:1,result:{data:[]}}).forward).toBeTruthy();
 for(const value of ['1790881000000',-1,Infinity])expect(()=>p.server({...notification,emittedAtMs:value})).toThrow('appserver_rpc_frame_invalid');
 expect(()=>p.server({...notification,unregisteredPower:true})).toThrow('appserver_rpc_frame_invalid');
 expect(()=>p.client({id:2,method:'model/list',params:{},emittedAtMs:1})).toThrow('appserver_rpc_frame_invalid');
});
