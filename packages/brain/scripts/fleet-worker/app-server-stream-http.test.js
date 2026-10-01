import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import http from 'node:http';
import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import {randomUUID,createHash} from 'node:crypto';
const require=createRequire(import.meta.url),{createFleetWorkerServer}=require('./fleet-worker.cjs');
it('真实Worker控制prepare与数据流认证分离；票仅header且不可重放，RPC token只在直连数据面',async()=>{
 const secret='control-only-'.repeat(4),identity={reservation_id:randomUUID(),stream_id:randomUUID(),machine_id:'xian-mac-m1'};
 const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),kill(){this.emit('close');}});
 const server=createFleetWorkerServer({attemptToken:secret,appServerRunner:{async attach(){return child;},async markRpcStarted(){}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;let dataRequest;
 try{
  const prep=await fetch(base+`/app-servers/${identity.reservation_id}/prepare-stream`,{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify({...identity,request_nonce:randomUUID()})});
  expect(prep.status).toBe(200);const ticket=prep.headers.get('x-appserver-stream-token'),body=await prep.json();expect(ticket).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(body)).not.toContain(ticket);expect(body.receipt.token_digest).toBe(createHash('sha256').update(ticket).digest('hex'));
  expect((await fetch(base+`/app-server-streams/${identity.stream_id}`,{method:'POST',headers:{authorization:`Bearer ${secret}`}})).status).toBe(401);
  const received=new Promise((resolve,reject)=>{dataRequest=http.request(base+`/app-server-streams/${identity.stream_id}`,{method:'POST',headers:{authorization:`Bearer ${ticket}`,'content-type':'application/x-ndjson'}},res=>{expect(res.statusCode).toBe(200);res.once('data',x=>resolve(JSON.parse(x)));});dataRequest.on('error',reject);dataRequest.flushHeaders();});
  child.stdin.on('data',b=>{const frame=JSON.parse(b);child.stdout.write(JSON.stringify({id:frame.id,result:{data:[],nextCursor:null}})+'\n');});
  dataRequest.write('{"id":1,"method":"model/list"}\n');expect((await received).id).toBe(1);
  expect((await fetch(base+`/app-server-streams/${identity.stream_id}`,{method:'POST',headers:{authorization:`Bearer ${ticket}`}})).status).toBe(401);
 }finally{dataRequest?.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
