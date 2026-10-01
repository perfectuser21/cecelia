import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let api;try{api=require('./app-server-rpc.cjs');}catch{api={};}
const client=(policy,id,method,params={})=>policy.client({id,method,params});
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
 const tools=['exec','process','gateway_exec','gateway_process','node_exec','sandbox_exec','sandbox_process','read'].map(name=>({name,description:name,inputSchema:{type:'object'}}));
 const r=client(p,1,'thread/start',{dynamicTools:tools});expect(r.forward.params.dynamicTools.map(t=>t.name)).toEqual(['read']);
 const blocked=p.server({id:'old',method:'item/tool/call',params:{tool:'exec',namespace:'functions',arguments:{command:'do not execute'},threadId:'old-thread',turnId:'turn',callId:'call'}});
 expect(blocked.forward).toBeUndefined();expect(blocked.reply.error.message).toBe('appserver_host_tool_denied');
});
it('pending turn不能堵interrupt/steer/terminate/认证回应；方向ID独立，重复ID与未知回应拒绝',()=>{
 expect(api.createRpcPolicy).toBeTypeOf('function');const p=api.createRpcPolicy();
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
