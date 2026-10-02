'use strict';
const http=require('node:http');
const {createHmac,timingSafeEqual}=require('node:crypto');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function createPhoneHubServer({token,identity,capabilities,maintenance,timeoutMs=5000}={}){
 const ready=typeof token==='string'&&Buffer.byteLength(token)>=32&&identity&&
  ['hub_id','boot_id','build_digest'].every(k=>typeof identity[k]==='string'&&identity[k].length>0)&&
  /^[a-f0-9]{64}$/.test(identity.build_digest)&&typeof capabilities==='function'&&typeof maintenance==='function';
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('phone_deadline_invalid');
 const nonces=new Map();
 return http.createServer(async(req,res)=>{
  let sent=false;const send=(status,body)=>{if(sent)return;sent=true;res.writeHead(status,{'content-type':'application/json','connection':'close'});res.end(JSON.stringify(body));};
  if(req.url==='/health'){send(ready?200:503,{scope:'phone-hub',configured:!!ready,execution:false});return;}
  if(!ready){send(503,{error:'phone_hub_unconfigured'});return;}
  const auth=req.headers.authorization??'',expected=`Bearer ${token}`;
  if(Buffer.byteLength(auth)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(auth),Buffer.from(expected))){send(401,{error:'phone_hub_unauthorized'});return;}
  if(req.method!=='POST'){send(405,{error:'phone_method_invalid'});return;}
  if(/^\/phones\/[^/]+\/(start|inspect|cancel)$/.test(req.url)){send(503,{error:'phone_runtime_not_connected'});return;}
  const capability=req.url==='/phones/capabilities';
  if(!capability&&req.url!=='/maintenance/status'){send(404,{error:'phone_route_unknown'});return;}
  let timer;try{
   const body=await new Promise((resolve,reject)=>{
    let size=0;const chunks=[];
    timer=setTimeout(()=>reject(Error('timeout')),timeoutMs);
    req.on('data',chunk=>{size+=chunk.length;if(size>16384)reject(Error('body'));else chunks.push(chunk);});
    req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks)));}catch{reject(Error('body'));}});
    req.on('error',()=>reject(Error('body')));
   });
   clearTimeout(timer);
   const fields=capability?['request_nonce','machine_id']:['request_nonce'];
   if(!body||Array.isArray(body)||Object.keys(body).length!==fields.length||Object.keys(body).some(k=>!fields.includes(k))||!UUID.test(body.request_nonce??'')||
    (capability&&(typeof body.machine_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(body.machine_id))))throw Error('body');
   const now=Date.now();for(const [nonce,expiry]of nonces)if(expiry<=now)nonces.delete(nonce);
   if(nonces.has(body.request_nonce)){send(409,{error:'phone_nonce_replayed'});return;}
   if(nonces.size>=10000){send(503,{error:'phone_hub_busy'});return;}
   nonces.set(body.request_nonce,now+60000);
   try{
    const result=await Promise.race([Promise.resolve().then(()=>capability?capabilities(body.machine_id):maintenance()),
     new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),timeoutMs);})]);
    if(!result||typeof result!=='object'||Array.isArray(result))throw Error('unconfirmed');
    const receipt={...result,schema:capability?'phone-capabilities/v1':'phone-maintenance/v1',scope:'phone-hub',...identity,
     ...(capability?{physical_config_digest:result.config_digest,physical_build_digest:result.build_digest,physical_observed_at:result.observed_at}:{}),
     execution:false,request_nonce:body.request_nonce,observed_at:new Date().toISOString()};
    send(200,{receipt,signature:createHmac('sha256',token).update(JSON.stringify(receipt)).digest('hex')});
   }catch{send(503,{error:capability?'phone_capabilities_unconfirmed':'phone_maintenance_unconfirmed'});}
  }catch(error){send(error.message==='timeout'?408:400,{error: error.message==='timeout'?'phone_request_timeout':'phone_request_invalid'});}
  finally{clearTimeout(timer);}
 });
}
module.exports={createPhoneHubServer};
