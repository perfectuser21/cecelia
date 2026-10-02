'use strict';
const {randomBytes,timingSafeEqual}=require('node:crypto');
const {Transform,pipeline}=require('node:stream');
const {createJsonlBoundary}=require('./app-server-stream.cjs');
const {createRpcPolicy}=require('./app-server-rpc.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function createStreamHub({runner,now=Date.now,ticketMs=5000,maxStreams=32}={}){
 const entries=new Map();
 function stop(entry,error){
  if(error)entry.failed=true;
  if(entry.closed||entry.stopping)return;
  entry.stopping=true;clearTimeout(entry.timer);entries.delete(entry.identity.stream_id);
  const finish=()=>{entry.closed=true;entry.policy?.close();entry.child.kill();entry.input?.destroy();entry.output?.destroy();};
  if(!entry.child.rpcCanary||!entry.policy){finish();return;}
  // 每帧仅记进度；完整输入流终结且审计落盘后才封存成功。写盘失败保留未完成证据。
  Promise.resolve(entry.auditTail).then(async()=>{
   const evidence=entry.policy.canaryEvidence();
   await runner.recordCanaryEvidence(entry.identity,{...evidence,complete:evidence.complete&&!entry.failed&&entry.clientEnded===true&&entry.serverEnded===true,sealed:true});
  }).catch(()=>{}).finally(finish);
 }
 return Object.freeze({
  async prepare(identity,{deadline=now()+ticketMs}={}){
   if(!Number.isFinite(deadline)||deadline<=now()||deadline>now()+ticketMs)throw Error('appserver_stream_ticket_expired');
   if(!UUID.test(identity.stream_id))throw Error('appserver_stream_identity_required');
   const previous=entries.get(identity.stream_id);
   if(previous){if(previous.claimed||JSON.stringify(previous.identity)!==JSON.stringify(identity)||previous.expiresAt<=now())throw Error('appserver_stream_busy');return {stream_id:identity.stream_id,token:previous.token,expires_at:previous.expiresAt};}
   if(entries.size>=maxStreams)throw Error('appserver_stream_capacity');
   const expiresAt=deadline;
   const child=await runner.attach(identity,{deadline:expiresAt});
   if(expiresAt<=now()){child.kill();throw Error('appserver_stream_ticket_expired');}
   const entry={identity,child,token:randomBytes(32).toString('hex'),expiresAt,claimed:false,closed:false};entries.set(identity.stream_id,entry);
   child.once('close',()=>{if(!child.rpcCanary)stop(entry);});child.once('error',()=>stop(entry,Error('stream_error')));
   entry.timer=setTimeout(()=>stop(entry,Error('ticket_expired')),Math.max(1,expiresAt-now()));entry.timer.unref();
   return {stream_id:identity.stream_id,token:entry.token,expires_at:expiresAt};
  },
  claim(streamId,token,input,output){
   const entry=entries.get(streamId);
   if(!entry||entry.claimed||entry.expiresAt<=now()||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||!timingSafeEqual(Buffer.from(token),Buffer.from(entry.token))){
    if(entry?.expiresAt<=now())stop(entry);throw Error('appserver_stream_ticket_invalid');
   }
   entry.claimed=true;clearTimeout(entry.timer);entry.input=input;entry.output=output;entry.token=null;
   const policy=createRpcPolicy({accountId:entry.child.rpcAccountId,hostTools:entry.child.rpcHostTools,canary:entry.child.rpcCanary===true});entry.policy=policy;let started=false;
   entry.auditTail=Promise.resolve();
   if(entry.child.rpcCanary){
    if(typeof runner.recordCanaryEvidence!=='function'||!Number.isSafeInteger(entry.child.rpcCanaryExpiresAt)||entry.child.rpcCanaryExpiresAt<=now()){stop(entry);throw Error('appserver_canary_permit_invalid');}
    entry.timer=setTimeout(()=>stop(entry,Error('canary_timeout')),Math.min(30000,entry.child.rpcCanaryExpiresAt-now()));entry.timer.unref();
   }
   const write=(target,frame,callback)=>{const raw=JSON.stringify(frame)+'\n';if(target.destroyed)return callback(Error('appserver_stream_closed'));if(target.write(raw))callback();else target.once('drain',callback);};
   function guard(direction){return new Transform({readableHighWaterMark:65536,writableHighWaterMark:65536,transform(chunk,_encoding,callback){
    const process=async()=>{try{const frame=JSON.parse(chunk.toString('utf8')),result=policy[direction](frame);
     if(entry.child.rpcCanary){const evidence={...policy.canaryEvidence(),complete:false,sealed:false};entry.auditTail=entry.auditTail.then(()=>runner.recordCanaryEvidence(entry.identity,evidence));await entry.auditTail;}
     if(result.reply){write(direction==='client'?output:entry.child.stdin,result.reply,callback);return;}
     callback(null,JSON.stringify(result.forward)+'\n');
    }catch{callback(Error('appserver_rpc_rejected'));}};
    if(direction==='client'&&!started){started=true;runner.markRpcStarted(entry.identity).then(process,()=>callback(Error('appserver_rpc_persistence_required')));}else process();
   }});}
   const ended=(direction,error)=>{
    entry[`${direction}Ended`]=true;
    if(error||!entry.child.rpcCanary||entry.clientEnded&&entry.serverEnded)stop(entry,error);
   };
   output.on('error',error=>stop(entry,error));input.on('error',error=>stop(entry,error));input.once('aborted',()=>stop(entry,Error('aborted')));output.once('close',()=>{
    if(!entry.child.rpcCanary)stop(entry);
    else if(!output.writableFinished&&!entry.stopping)stop(entry,Error('output_closed'));
   });
   pipeline(input,createJsonlBoundary(),guard('client'),entry.child.stdin,error=>ended('client',error));
   pipeline(entry.child.stdout,createJsonlBoundary(),guard('server'),output,error=>ended('server',error));
   return {stream_id:streamId};
  },
  close(){for(const entry of [...entries.values()])stop(entry,Error('hub_shutdown'));},
 });
}
module.exports={createStreamHub};
