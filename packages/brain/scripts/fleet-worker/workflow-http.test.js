import {test} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const assert=require('node:assert/strict');const {createHmac,randomUUID}=require('node:crypto');
const {createFleetWorkerServer}=require('./fleet-worker.cjs');
test('authenticated workflow endpoints return nonce-bound signed receipts; caller cannot inject commands',async()=>{
 const token='t'.repeat(32),id=randomUUID(),task=randomUUID();let count=0;
 const runner={start:async b=>{count++;return {run_id:b.run_id,task_id:b.task_id,machine_id:'test',status:'running'};}};
 const server=createFleetWorkerServer({attemptToken:token,workflowRunner:runner});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}/workflows/${id}/start`;
 try{
  const body={run_id:id,task_id:task,request_nonce:randomUUID()};
  assert.equal((await fetch(url,{method:'POST',body:JSON.stringify(body)})).status,401);
  const res=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.stringify(body)});assert.equal(res.status,200);
  const value=await res.json();assert.equal(value.receipt.request_nonce,body.request_nonce);assert.equal(value.signature,createHmac('sha256',token).update(JSON.stringify(value.receipt)).digest('hex'));assert.equal(count,1);
  assert.equal((await fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`},body:JSON.stringify({...body,run_id:randomUUID()})})).status,400);
 }finally{await new Promise(r=>server.close(r));}
});
