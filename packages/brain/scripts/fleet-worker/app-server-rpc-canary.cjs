'use strict';
// 专属离线容器 + 真实HTTP/shim；可额外接入已安装的固定OpenClaw插件client。
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {randomUUID,createHash}=require('node:crypto'),{execFile,spawn}=require('node:child_process'),{promisify}=require('node:util');
const {createAppServerDocker}=require('./app-server-docker.cjs'),{createAppServerRunner}=require('./app-server-runner.cjs');
const {createFleetWorkerServer}=require('./fleet-worker.cjs'),{profileDigest,generationOwner}=require('./app-server-profile.cjs');
const run=promisify(execFile),tag=randomUUID(),hash=x=>createHash('sha256').update(x).digest('hex');
const image=process.env.APP_SERVER_CANARY_IMAGE||'sha256:97529d0c8b2197ea8a4b9c7bd8082c21c616d05e59e1946f556579f6f6523777';
const profile={image,cpus:1,memoryBytes:536870912,pidsLimit:64,user:'1000:1000',tmpBytes:33554432,network:'none',homeKey:hash(tag+'home'),workspaceKey:hash(tag+'workspace')};
const stateRoot=fs.mkdtempSync(path.join(os.tmpdir(),'appserver-rpc-canary-')),docker=createAppServerDocker(),volumes=[];
const identity={reservation_id:randomUUID(),intent_id:randomUUID(),launch_generation:1,machine_id:'canary-machine',worker_id:'canary-worker',worker_boot_id:randomUUID(),home_key:profile.homeKey,config_digest:profileDigest(profile),profile:'canary'};identity.owner_key=generationOwner(identity);
const runner=createAppServerRunner({stateRoot,...{machineId:identity.machine_id,workerId:identity.worker_id,bootId:identity.worker_boot_id},profiles:{canary:profile},docker,assertLocalResources:async()=>{}});
const command=args=>run('docker',args,{encoding:'utf8',timeout:30000,maxBuffer:1048576});
let worker,brain,child,state,pluginClient;
function exchange(transport,id,method,params){
 return new Promise((resolve,reject)=>{
  let pending='';const timer=setTimeout(()=>finish(Error('appserver_canary_timeout')),15000);
  const fail=()=>finish(Error('appserver_canary_exit'));
  const data=chunk=>{pending+=chunk;let end;while((end=pending.indexOf('\n'))>=0){
   const line=pending.slice(0,end);pending=pending.slice(end+1);let frame;try{frame=JSON.parse(line);}catch{return fail();}
   if(frame.id===id){if(!frame.result||frame.error)return fail();finish(null,frame.result);return;}
  }};
  function finish(error,value){clearTimeout(timer);transport.stdout.off('data',data);transport.off('exit',fail);transport.stdin.off('error',fail);if(error)reject(error);else resolve(value);}
  transport.once('exit',fail);transport.stdin.once('error',fail);transport.stdout.on('data',data);
  transport.stdin.write(JSON.stringify({id,method,params})+'\n');
 });
}
async function main(){
 for(const [kind,key]of [['home',profile.homeKey],['workspace',profile.workspaceKey]]){const name=`cecelia-appserver-${kind}-${key}`;await command(['volume','create','--label',`cecelia.appserver.kind=${kind}`,'--label',`cecelia.appserver.key=${key}`,'--label',`cecelia.appserver.canary=${tag}`,name]);volumes.push(name);}
 await command(['run','--rm',`--name=cecelia-appserver-${tag}-g999999`,`--label=cecelia.appserver.canary=${tag}`,'--network=none','--cpus=.5','--memory=128m','--memory-swap=128m','--pids-limit=32','--user=0:0','--read-only','--entrypoint=/bin/sh',`--mount=type=volume,src=${volumes[0]},dst=/home/runner`,`--mount=type=volume,src=${volumes[1]},dst=/workspace`,image,'-c','mkdir -p /home/runner/.codex && chown 1000:1000 /home/runner /home/runner/.codex /workspace']);
 state=await runner.start(identity);assert.equal(state.status,'running');
 const token='canary-control-'+randomUUID(),internal='canary-internal-'+randomUUID();
 worker=createFleetWorkerServer({attemptToken:token,appServerRunner:runner});await new Promise(r=>worker.listen(0,'127.0.0.1',r));
 const endpoint=`http://127.0.0.1:${worker.address().port}`,stream={id:randomUUID(),prepare_deadline:new Date(Date.now()+5000)};
 const row={...identity,id:identity.reservation_id,config:{profile:'canary'},stream};let revoked=false;
 const {createAppServerClient}=await import('../../src/app-server/client.js');
 const client=createAppServerClient({env:{KERNEL_FLEET_BRIDGE_TOKEN:token},store:{async reserveStream(){if(revoked)throw Error('execution_grant_denied');return stream;},async withOperation(_id,action,fn){if(revoked&&action==='prepare-stream')throw Error('execution_grant_denied');return fn(row,endpoint);}}});
 // PG同机锁/持久许可由真实scratch回归验证；此fixture只负责离线网络与协议 canary。
 brain=http.createServer(async(req,res)=>{try{assert.equal(req.headers['x-cecelia-token'],internal);let bytes=0;for await(const chunk of req){bytes+=chunk.length;assert.ok(bytes<4096);}
  if(req.url==='/api/brain/internal/app-server/generations'){res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'running',reservation_id:row.id}));return;}
  assert.equal(req.url,`/api/brain/internal/app-server/generations/${row.id}/stream`);const {token:ticket,...metadata}=await client.prepareStream(row.id);res.setHeader('x-appserver-stream-token',ticket);res.setHeader('content-type','application/json');res.end(JSON.stringify(metadata));
 }catch{res.statusCode=409;res.end('{"error":"appserver_canary_control_denied"}');}});await new Promise(r=>brain.listen(0,'127.0.0.1',r));
 const filename=path.join(stateRoot,'shim.json');fs.writeFileSync(filename,JSON.stringify({brainUrl:`http://127.0.0.1:${brain.address().port}`,internalToken:internal,homeId:'chat-canary',requestKey:randomUUID()}),{mode:0o600});
 // stream期限从真实spawn前更新，绝不在未知结果后延长生产许可。
 stream.prepare_deadline=new Date(Date.now()+5000);
 child=spawn(process.execPath,[path.join(__dirname,'app-server-shim.cjs'),'app-server','--listen','stdio://'],{env:{PATH:process.env.PATH,CECELIA_APP_SERVER_SHIM_CONFIG:filename},stdio:['pipe','pipe','pipe']});child.stdin.on('error',()=>{});child.stderr.on('data',chunk=>{if(/^appserver_[a-z_]+\n$/.test(chunk.toString()))process.stderr.write(chunk);});
 const pluginPath=process.env.OPENCLAW_CANARY_CLIENT_MODULE;
 if(pluginPath){const module=await import(pluginPath);pluginClient=module.t.fromTransportForTests(child);await pluginClient.initialize();assert.equal(pluginClient.getServerVersion(),'0.158.0');
  assert.ok(Array.isArray((await pluginClient.request('model/list',{})).data));
 }else {
  await exchange(child,1,'initialize',{clientInfo:{name:'cecelia_canary',version:'1'},capabilities:{experimentalApi:true}});
  child.stdin.write('{"method":"initialized"}\n');
  assert.ok(Array.isArray((await exchange(child,2,'model/list',{})).data));
 }

 revoked=true;await assert.rejects(client.prepareStream(row.id),/execution_grant_denied/);assert.equal((await runner.inspect(identity)).status,'running');
 const inspected=JSON.parse((await command(['inspect',state.container_id])).stdout)[0];assert.equal(inspected.HostConfig.Memory,profile.memoryBytes);assert.equal(inspected.HostConfig.NanoCpus,1e9);assert.equal(inspected.HostConfig.PidsLimit,64);assert.equal(inspected.Mounts.filter(m=>m.Type==='bind').length,0);
 const cleanup=await runner.cancel({...identity,container_id:state.container_id,challenge:randomUUID()});assert.equal(cleanup.absent,true);assert.equal(await docker.inspect(state.container_id),null);
 console.log(JSON.stringify({result:'PASS',canary_id:tag,image,reservation_id:identity.reservation_id,intent_id:identity.intent_id,container_id:state.container_id,stream_id:stream.id,plugin_client:pluginPath?'2026.9.7':'none',protocol:'0.158.0-experimental',initialize:true,post_initialize_roundtrip:true,shim_http_direct:true,grant_revoke_preserves_running:true,explicit_cancel_absent:true,host_mounts:0,model_calls:0}));
}
main().catch(error=>{console.error(/^appserver_[a-z_]+$/.test(error.message)?error.message:'appserver_rpc_canary_failed');process.exitCode=1;}).finally(async()=>{
 child?.kill();pluginClient?.close();runner.close();for(const server of [brain,worker])if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
 const existing=await docker.inspect(state?.container_id??`cecelia-appserver-${identity.reservation_id}-g1`);if(existing?.labels['cecelia.appserver.reservation_id']===identity.reservation_id)await docker.remove(existing.id);
 const initializer=await docker.inspect(`cecelia-appserver-${tag}-g999999`);if(initializer?.labels['cecelia.appserver.canary']===tag)await docker.remove(initializer.id);
 for(const name of volumes){const resource=JSON.parse((await command(['volume','inspect',name])).stdout)[0];if(resource.Labels['cecelia.appserver.canary']===tag)await command(['volume','rm',name]);}
 fs.rmSync(stateRoot,{recursive:true,force:true});
});
