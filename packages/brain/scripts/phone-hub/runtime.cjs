'use strict';
const {execFile}=require('node:child_process');
const {createPhoneHubServer}=require('./service.cjs');
const {loadConfiguration}=require('./configuration.cjs');
const {createCapabilities}=require('./capabilities.cjs');
const {createMaintenance}=require('./maintenance.cjs');
function runControl(request){return new Promise((resolve,reject)=>{
 const child=execFile('/opt/homebrew/bin/python3',['/opt/cecelia/phone-hub/control.py'],{timeout:2500,maxBuffer:16384,killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'C'}},(error,stdout)=>{
  if(error){reject(Error('phone_control_unconfirmed'));return;}
  try{resolve(JSON.parse(stdout));}catch{reject(Error('phone_control_unconfirmed'));}
 });child.stdin.on('error',()=>reject(Error('phone_control_unconfirmed')));child.stdin.end(JSON.stringify(request));
});}
async function createRuntime({runControl:control=runControl,runProbe,...configuration}={}){
 try{
  const config=loadConfiguration(configuration),native=await control({operation:'identity'});
  if(typeof native?.boot_id!=='string'||!native.boot_id||!native.owner||!Number.isInteger(native.owner.pid))throw Error('phone_boot_unconfirmed');
  // startup读真实既有控制账，缺失/坏账/未初始化时不能配置成功。
  await control({operation:'snapshot'});
  const identity={hub_id:config.manifest.hub_id,boot_id:native.boot_id,hub_process_identity:native.owner,
   build_digest:config.build_digest,config_digest:config.config_digest,http_endpoint:config.manifest.http_endpoint};
  const probe=createCapabilities({targets:config.manifest.targets,...(runProbe?{run:runProbe}:{})});
  const capabilities=async machine=>{
   const {token}=await control({operation:'begin'});
   try{return await probe(machine);}finally{await control({operation:'end',token});}
  };
  const maintenance=createMaintenance({local:()=>control({operation:'maintenance'}),targets:config.manifest.targets,probe:capabilities});
  return {configured:true,identity,capabilities,maintenance,server:createPhoneHubServer({token:config.token,identity,capabilities,maintenance})};
 }catch{return {configured:false,server:createPhoneHubServer()};}
}
module.exports={createRuntime,runControl};
if(require.main===module)createRuntime().then(runtime=>runtime.server.listen(3459,'0.0.0.0'));
