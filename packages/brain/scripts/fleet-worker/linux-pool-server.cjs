'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {createHash,createHmac,timingSafeEqual,randomUUID}=require('node:crypto');
const {validateLinuxPoolProfile}=require('./linux-pool-profile.cjs');
const {sampleLinuxResources,projectLinuxObservation}=require('./linux-resource-probe.cjs');
const fail=()=>{throw Error('linux_pool_server_configuration_invalid');};
const hash=value=>createHash('sha256').update(value).digest();
function json(response,status,value){response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(value));}
async function readNonce(request,timeoutMs) {
  const chunks=[];let bytes=0;
  const deadline=setTimeout(()=>request.destroy(),timeoutMs);
  try{for await(const chunk of request){bytes+=chunk.length;if(bytes>2048)throw Object.assign(Error(),{status:413});chunks.push(chunk);}}
  finally{clearTimeout(deadline);}
  let input;try{input=JSON.parse(Buffer.concat(chunks).toString());}catch{throw Object.assign(Error(),{status:400});}
  if(!input||Array.isArray(input)||Object.keys(input).length!==1||typeof input.nonce!=='string'||!/^[a-f0-9]{64}$/.test(input.nonce))throw Object.assign(Error(),{status:400});
  return input.nonce;
}
function createLinuxPoolServer({profile:input,token,revision,probe,bodyTimeoutMs=5000,headersTimeoutMs=5000}) {
  const profile=validateLinuxPoolProfile(input),bootId=randomUUID();
  if(profile.scheduler_only||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||typeof revision!=='string'||!/^[a-f0-9]{40}$/.test(revision)
    ||![bodyTimeoutMs,headersTimeoutMs].every(v=>Number.isInteger(v)&&v>=50&&v<=5000)||headersTimeoutMs>bodyTimeoutMs)fail();
  const tokenHash=hash('Bearer '+token);
  const sample=probe??(()=>sampleLinuxResources({diskPaths:[profile.data_root,'/var/lib/docker']}));
  let inFlight=null,cached=null,expires=0;
  const health=async()=>{
    if(cached&&Date.now()<expires)return cached;
    if(!inFlight)inFlight=Promise.resolve().then(sample).then(projectLinuxObservation).catch(()=>projectLinuxObservation(null))
      .then(observation=>{cached=observation;expires=Date.now()+10000;return observation;}).finally(()=>{inFlight=null;});
    return inFlight;
  };
  const server=http.createServer({maxHeaderSize:4096,requestTimeout:bodyTimeoutMs,headersTimeout:headersTimeoutMs,
    connectionsCheckingInterval:Math.min(250,headersTimeoutMs)},async(request,response)=>{
    try {
      if(request.url==='/health'&&request.method==='GET') {
        const observation=await health();
        json(response,200,{schema_version:'fleet-node-health/v1',machine_id:profile.machine_id,machine_registry_id:profile.machine_registry_id,
          observed_at:observation.observed_at,worker:{version:revision,boot_id:bootId,protocol_version:'linux-pool-pending/v1'},
          execution:false,pool_verified:false,reason:'execution_pool_unverified',drain:{active:true},
          resources:{cpu_cores:0,memory_bytes:0,disk_free_bytes:0,disk_used_percent:100,cpu_pressure_percent:100,memory_pressure_percent:100},
          linux_observation:observation});return;
      }
      if(request.url==='/v1/pool/identity') {
        const auth=request.headers.authorization;
        if(typeof auth!=='string'||!timingSafeEqual(hash(auth),tokenHash)){request.resume();json(response,401,{error:'unauthorized'});return;}
        if(request.method!=='POST'){request.resume();json(response,405,{error:'method_not_allowed'});return;}
        const nonce=await readNonce(request,bodyTimeoutMs);
        const receipt={schema_version:'linux-pool-identity/v1',nonce,machine_registry_id:profile.machine_registry_id,
          machine_id:profile.machine_id,worker_boot_id:bootId,revision,config_digest:profile.config_digest,execution:false,observed_at:new Date().toISOString()};
        json(response,200,{receipt,signature:createHmac('sha256',token).update(JSON.stringify(receipt)).digest('hex')});return;
      }
      request.resume();json(response,403,{error:'linux_execution_not_authorized'});
    } catch(error){if(!response.destroyed)json(response,error.status===413?413:400,{error:'linux_pool_request_invalid'});}
  });
  server.keepAliveTimeout=1000;server.maxRequestsPerSocket=32;
  server.setTimeout(6000,socket=>socket.destroy());
  return server;
}
function readInstalledFile(filename,{mode,owner,maxBytes}) {
  let fd;
  try {
    let parent=path.dirname(filename);
    while(parent!=='/') {const s=fs.lstatSync(parent);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))fail();parent=path.dirname(parent);}
    fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    const before=fs.fstatSync(fd,{bigint:true});
    if(!before.isFile()||before.uid!==BigInt(owner)||(before.mode&0o777n)!==BigInt(mode)||before.size>BigInt(maxBytes))fail();
    const buffer=Buffer.alloc(maxBytes+1),count=fs.readSync(fd,buffer,0,buffer.length,0);
    const after=fs.fstatSync(fd,{bigint:true}),current=fs.lstatSync(filename,{bigint:true});
    if(count>maxBytes||BigInt(count)!==after.size||before.size!==after.size||before.ctimeNs!==after.ctimeNs
      ||current.dev!==before.dev||current.ino!==before.ino||current.ctimeNs!==before.ctimeNs)fail();
    return buffer.subarray(0,count).toString('utf8').trim();
  }catch{fail();}finally{if(fd!==undefined)fs.closeSync(fd);}
}
if(require.main===module) {
  try {
    if(process.platform!=='linux'||process.getuid()===0)fail();
    const filename='/etc/cecelia/fleet-pool.json';
    // 独立部署服务只读root控制的目录，服务账号持有0600文件读取权。
    const input=JSON.parse(readInstalledFile(filename,{mode:0o600,owner:process.getuid(),maxBytes:65536}));
    const profile=validateLinuxPoolProfile(input);
    const token=readInstalledFile('/etc/cecelia/fleet-worker.token',{mode:0o600,owner:process.getuid(),maxBytes:64});
    const revision=readInstalledFile('/usr/local/libexec/cecelia/fleet-worker/revision',{mode:0o644,owner:0,maxBytes:41});
    createLinuxPoolServer({profile:input,token,revision}).listen(5231,profile.endpoint_host);
  }catch{process.stderr.write('linux_pool_server_configuration_invalid\n');process.exitCode=1;}
}
module.exports={createLinuxPoolServer,readInstalledFile};
