'use strict';
const {randomBytes,timingSafeEqual}=require('node:crypto');
const {Transform,pipeline}=require('node:stream');
const {createJsonlBoundary}=require('./app-server-stream.cjs');
const {createRpcPolicy}=require('./app-server-rpc.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function createStreamHub({runner,now=Date.now,ticketMs=5000,maxStreams=32}={}){
 const entries=new Map();
 function stop(entry){if(entry.closed)return;entry.closed=true;clearTimeout(entry.timer);entries.delete(entry.identity.stream_id);entry.policy?.close();entry.child.kill();entry.input?.destroy();entry.output?.destroy();}
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
   child.once('close',()=>stop(entry));child.once('error',()=>stop(entry));
   entry.timer=setTimeout(()=>stop(entry),Math.max(1,expiresAt-now()));entry.timer.unref();
   return {stream_id:identity.stream_id,token:entry.token,expires_at:expiresAt};
  },
  claim(streamId,token,input,output){
   const entry=entries.get(streamId);
   if(!entry||entry.claimed||entry.expiresAt<=now()||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||!timingSafeEqual(Buffer.from(token),Buffer.from(entry.token))){
    if(entry?.expiresAt<=now())stop(entry);throw Error('appserver_stream_ticket_invalid');
   }
   entry.claimed=true;clearTimeout(entry.timer);entry.input=input;entry.output=output;entry.token=null;
   const policy=createRpcPolicy({accountId:entry.child.rpcAccountId});entry.policy=policy;let started=false;
   const write=(target,frame,callback)=>{const raw=JSON.stringify(frame)+'\n';if(target.destroyed)return callback(Error('appserver_stream_closed'));if(target.write(raw))callback();else target.once('drain',callback);};
   function guard(direction){return new Transform({readableHighWaterMark:65536,writableHighWaterMark:65536,transform(chunk,_encoding,callback){
    const process=()=>{try{const frame=JSON.parse(chunk.toString('utf8')),result=policy[direction](frame);
     if(result.reply){write(direction==='client'?output:entry.child.stdin,result.reply,callback);return;}
     callback(null,JSON.stringify(result.forward)+'\n');
    }catch{callback(Error('appserver_rpc_rejected'));}};
    if(direction==='client'&&!started){started=true;runner.markRpcStarted(entry.identity).then(process,()=>callback(Error('appserver_rpc_persistence_required')));}else process();
   }});}
   output.on('error',()=>stop(entry));input.on('error',()=>stop(entry));input.once('aborted',()=>stop(entry));output.once('close',()=>stop(entry));
   pipeline(input,createJsonlBoundary(),guard('client'),entry.child.stdin,()=>stop(entry));
   pipeline(entry.child.stdout,createJsonlBoundary(),guard('server'),output,()=>stop(entry));
   return {stream_id:streamId};
  },
  close(){for(const entry of [...entries.values()])stop(entry);},
 });
}
module.exports={createStreamHub};
