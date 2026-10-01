import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);let api;try{api=require('./app-server-stream-hub.cjs');}catch{api={};}
function fixture(){const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),kill(){this.emit('close');},rpcAccountId:'bound'});let attaches=0,marks=0;
 const runner={async attach(){attaches++;return child;},async markRpcStarted(){marks++;}};
 const identity={reservation_id:randomUUID(),stream_id:randomUUID()};return {child,runner,identity,get attaches(){return attaches;},get marks(){return marks;}};
}
it('验收流按持久身份选择窄策略，并把拒绝审计写回Worker',async()=>{
 const f=fixture();f.child.rpcCanary=true;f.child.rpcCanaryExpiresAt=Date.now()+60000;
 const audits=[];f.runner.recordCanaryEvidence=async(identity,evidence)=>{expect(identity).toEqual(f.identity);audits.push(evidence);};
 const hub=api.createStreamHub({runner:f.runner}),ticket=await hub.prepare(f.identity),input=new PassThrough(),output=new PassThrough();
 let seen='';output.on('data',chunk=>seen+=chunk);let forwarded=0;f.child.stdin.on('data',()=>forwarded++);
 hub.claim(ticket.stream_id,ticket.token,input,output);
 input.write(JSON.stringify({id:1,method:'thread/start',params:{}})+'\n');await new Promise(r=>setTimeout(r,20));
 expect(forwarded).toBe(0);expect(JSON.parse(seen).error.message).toBe('appserver_canary_method_denied');
 expect(audits.at(-1)).toMatchObject({complete:false,rejected:1});hub.close();
});
it('真实双向流单次领取，错误凭证不消耗，首次写入先持久化；结束只断流不取消预约',async()=>{
 expect(api.createStreamHub).toBeTypeOf('function');const f=fixture(),hub=api.createStreamHub({runner:f.runner});
 const prepared=await hub.prepare(f.identity);expect(f.attaches).toBe(1);
 const input=new PassThrough(),output=new PassThrough();let seen='';output.on('data',x=>seen+=x);
 expect(()=>hub.claim(prepared.stream_id,'wrong',input,output)).toThrow('appserver_stream_ticket_invalid');
 hub.claim(prepared.stream_id,prepared.token,input,output);
 expect(()=>hub.claim(prepared.stream_id,prepared.token,new PassThrough(),new PassThrough())).toThrow('appserver_stream_ticket_invalid');
 const upstream=[];f.child.stdin.on('data',b=>upstream.push(JSON.parse(b)));
 input.write(JSON.stringify({id:1,method:'model/list',params:{}})+'\n');await new Promise(r=>setTimeout(r,10));
 expect(f.marks).toBe(1);expect(upstream).toHaveLength(1);
 f.child.stdout.write(JSON.stringify({id:1,result:{data:[],nextCursor:null}})+'\n');await new Promise(r=>setTimeout(r,10));expect(JSON.parse(seen).id).toBe(1);
 input.end();hub.close();
});
it('真实双向流采用runner权限，保留消息回调字段且拒绝宿主exec',async()=>{
 const f=fixture();f.child.rpcHostTools=['read','message'];
 const hub=api.createStreamHub({runner:f.runner}),p=await hub.prepare(f.identity);
 const input=new PassThrough(),output=new PassThrough(),upstream=[],downstream=[];
 f.child.stdin.on('data',x=>upstream.push(JSON.parse(x)));output.on('data',x=>downstream.push(JSON.parse(x)));
 hub.claim(p.stream_id,p.token,input,output);
 const call={id:'message',method:'item/tool/call',params:{tool:'message',namespace:'openclaw',arguments:{text:'offline'},threadId:'t',turnId:'u',callId:'c'}};
 f.child.stdout.write(JSON.stringify(call)+'\n');
 f.child.stdout.write(JSON.stringify({...call,id:'exec',params:{...call.params,tool:'exec'}})+'\n');
 await new Promise(r=>setTimeout(r,10));
 expect(downstream).toEqual([call]);expect(upstream[0].error.message).toBe('appserver_host_tool_denied');
 const response={id:'message',result:{contentItems:[{type:'inputText',text:'ok'}],success:true}};
 input.write(JSON.stringify(response)+'\n');await new Promise(r=>setTimeout(r,10));
 expect(upstream[1]).toEqual(response);hub.close();
});
it('过期未领取票关闭唯一attach；缺持久化确认不向Codex写字节，错误不泄正文',async()=>{
 expect(api.createStreamHub).toBeTypeOf('function');let now=100;const f=fixture(),hub=api.createStreamHub({runner:f.runner,now:()=>now,ticketMs:10});
 const p=await hub.prepare(f.identity);now=111;
 expect(()=>hub.claim(p.stream_id,p.token,new PassThrough(),new PassThrough())).toThrow('appserver_stream_ticket_invalid');hub.close();
 const g=fixture();g.runner.markRpcStarted=async()=>{throw Error('secret body should never escape');};const h=api.createStreamHub({runner:g.runner});const ticket=await h.prepare(g.identity);
 const input=new PassThrough(),output=new PassThrough();output.on('error',()=>{});let count=0;g.child.stdin.on('data',()=>count++);
 h.claim(ticket.stream_id,ticket.token,input,output);input.write('{"id":1,"method":"model/list"}\n');await new Promise(r=>setTimeout(r,20));expect(count).toBe(0);expect(output.destroyed).toBe(true);h.close();
});
