import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import shim from '../../../packages/brain/scripts/fleet-worker/app-server-shim.cjs';
it('F1 OpenClaw多agent：真shim配置选择隔离HOME，未知路径在控制面请求前拒绝',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'gp-home-map-')),file=path.join(root,'shim.json'),seen=[];
 const server=createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
  seen.push(JSON.parse(body));res.end(JSON.stringify({status:'waiting_resources'}));
 });});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const config={brainUrl:`http://127.0.0.1:${server.address().port}`,internalToken:'gp-local-control-'.repeat(3),
  homeMap:[{codexHome:'/trusted/main/codex-home',homeId:'chat-main'},{codexHome:'/trusted/work/codex-home',homeId:'chat-work'}]};
 writeFileSync(file,JSON.stringify(config),{mode:0o600});
 try{
  for(const entry of config.homeMap)await expect(shim.runShim(shim.loadShimConfig(file,{CODEX_HOME:entry.codexHome}))).rejects.toThrow('appserver_waiting_resources');
  expect(seen.map(body=>body.home_id)).toEqual(['chat-main','chat-work']);
  await expect(Promise.resolve().then(()=>shim.runShim(shim.loadShimConfig(file,{CODEX_HOME:'/trusted/main/codex-home-evil'})))).rejects.toThrow('appserver_shim_home_unmapped');
  expect(seen).toHaveLength(2);expect(seen[0].request_key).not.toBe(seen[1].request_key);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(root,{recursive:true,force:true});}
});
