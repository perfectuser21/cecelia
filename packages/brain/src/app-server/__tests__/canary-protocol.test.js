import {createServer} from 'node:http';
import {it,expect} from 'vitest';
it.each(['complete','partial','unknown','timeout'])('固定验收协议只在完整双向结束时成功：%s',async mode=>{
 let api={};try{api=await import('../canary-protocol.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
 expect(api.runCanaryProtocol).toBeTypeOf('function');
 const seen=[];const server=createServer((req,res)=>{
  expect(req.headers.authorization).toBe('Bearer '+'a'.repeat(64));res.writeHead(200,{'content-type':'application/x-ndjson'});res.flushHeaders();let input='';
  req.on('data',chunk=>{input+=chunk;let end;while((end=input.indexOf('\n'))>=0){const frame=JSON.parse(input.slice(0,end));input=input.slice(end+1);seen.push(frame.method);if(!frame.id)continue;
   if(mode==='timeout')continue;
   if(mode==='unknown'){res.end('{"id":99,"result":{}}\n');return;}
   const results={initialize:{userAgent:'codex/0.158.0'},'model/list':{data:[]},'config/read':{config:{}},'configRequirements/read':{requirements:null}};
   res.write(JSON.stringify({id:frame.id,result:results[frame.method]})+'\n');
  }});
  req.on('end',()=>{if(mode==='partial')res.write('{"id":');res.end();});
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const result=api.runCanaryProtocol({token:'a'.repeat(64),stream_url:`http://127.0.0.1:${server.address().port}/app-server-streams/00000000-0000-4000-8000-000000000000`,expires_at:Date.now()+5000},{timeoutMs:100});
  if(mode==='complete'){await expect(result).resolves.toEqual({complete:true});expect(seen).toEqual(['initialize','initialized','model/list','config/read','configRequirements/read']);}
  else await expect(result).rejects.toThrow(/^appserver_canary_/);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
