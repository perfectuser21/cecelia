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
it('过期未领取票关闭唯一attach；缺持久化确认不向Codex写字节，错误不泄正文',async()=>{
 expect(api.createStreamHub).toBeTypeOf('function');let now=100;const f=fixture(),hub=api.createStreamHub({runner:f.runner,now:()=>now,ticketMs:10});
 const p=await hub.prepare(f.identity);now=111;
 expect(()=>hub.claim(p.stream_id,p.token,new PassThrough(),new PassThrough())).toThrow('appserver_stream_ticket_invalid');hub.close();
 const g=fixture();g.runner.markRpcStarted=async()=>{throw Error('secret body should never escape');};const h=api.createStreamHub({runner:g.runner});const ticket=await h.prepare(g.identity);
 const input=new PassThrough(),output=new PassThrough();output.on('error',()=>{});let count=0;g.child.stdin.on('data',()=>count++);
 h.claim(ticket.stream_id,ticket.token,input,output);input.write('{"id":1,"method":"model/list"}\n');await new Promise(r=>setTimeout(r,20));expect(count).toBe(0);expect(output.destroyed).toBe(true);h.close();
});
