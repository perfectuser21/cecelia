'use strict';
const fs=require('node:fs');
const protocol=require('./protocol.cjs');
const transport=require('./transport.cjs');
const MANIFEST='/etc/cecelia/phone-ssh/routes.json';
function loadRoutes(){
 const s=fs.lstatSync(MANIFEST);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o022))throw Error('phone_routes_untrusted');
 const routes=JSON.parse(fs.readFileSync(MANIFEST,'utf8'));
 if(!Array.isArray(routes)||routes.length>100||routes.some(r=>typeof r.machine_id!=='string'||!protocol.targetValid({host:r.host,user:r.user,port:r.port})||Object.keys(r).some(k=>!['machine_id','host','port','user'].includes(k))))throw Error('phone_routes_invalid');return routes;
}
function createHub({routes,run=transport.runSsh}={}){
 routes??=loadRoutes();
 return Object.freeze({async handle(request){
  if(!protocol.requestValid(request,true)||!routes.some(r=>r.machine_id===request.identity.machine_id&&['host','user','port'].every(k=>r[k]===request.route[k]))||request.identity.host!==request.route.host)throw Error('phone_route_denied');
  const downstream=protocol.makeRequest(request.operation,request.identity);
  const result=await run('/usr/bin/ssh',transport.sshArgs(request.route,transport.RUNNER_COMMAND),JSON.stringify(downstream));
  const e=protocol.response(result,downstream);
  return {schema:protocol.SCHEMA,request_nonce:request.request_nonce,route:request.route,receipt:e.receipt};
 }});
}
async function main(){
 let input='',size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>16384)throw Error('phone_request_oversized');input+=chunk;}
 const result=await createHub().handle(JSON.parse(input));process.stdout.write(JSON.stringify(result)+'\n');
}
module.exports={createHub};
if(require.main===module)main().catch(()=>{process.stderr.write('phone_hub_unconfirmed\n');process.exitCode=1;});
