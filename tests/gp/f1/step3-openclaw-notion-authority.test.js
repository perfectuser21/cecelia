import {it,expect} from 'vitest';
import rpc from '../../../packages/brain/scripts/fleet-worker/app-server-rpc.cjs';
import profileApi from '../../../packages/brain/scripts/fleet-worker/app-server-profile.cjs';
it('F1造完真验：OpenClaw宿主Notion声明与旧线程回调只能使用已授权账号工具',()=>{
 const selected='notion-owner__API-post-search';
 const profile=profileApi.validateAppServerProfile({image:'sha256:'+'a'.repeat(64),cpus:1,memoryBytes:2**30,
  pidsLimit:128,user:'1000:1000',tmpBytes:2**26,network:'none',homeKey:'b'.repeat(64),workspaceKey:'c'.repeat(64),hostTools:[selected]});
 const p=rpc.createRpcPolicy({hostTools:profile.hostTools});
 const names=[selected,'notion-yujin__API-post-search','gateway_exec'];
 const dynamicTools=names.map(name=>({type:'function',name,description:name,inputSchema:{type:'object'}}));
 const declaration=p.client({id:1,method:'thread/start',params:{dynamicTools}});
 expect(declaration.forward.params.dynamicTools).toEqual([dynamicTools[0]]);
 for(const tool of names){
  const response=p.server({id:tool,method:'item/tool/call',params:{tool,namespace:'openclaw',arguments:{},threadId:'old',turnId:'turn',callId:'call'}});
  if(tool===selected)expect(response.forward.params.tool).toBe(tool);
  else expect(response.reply.error.message).toBe('appserver_host_tool_denied');
 }
 const request={id:2,method:'mcpServerStatus/list',params:{threadId:'old',detail:'toolsAndAuthOnly'}};
 expect(p.client(request).forward).toEqual(request);
});
