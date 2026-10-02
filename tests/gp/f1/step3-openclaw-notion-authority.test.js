import {it,expect} from 'vitest';
import rpc from '../../../packages/brain/scripts/fleet-worker/app-server-rpc.cjs';
it('F1造完真验：OpenClaw宿主Notion声明与旧线程回调只能使用已授权账号工具',()=>{
 const selected='notion-owner__API-post-search';
 const p=rpc.createRpcPolicy({hostTools:[selected]});
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
