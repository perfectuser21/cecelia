'use strict';
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile),MAX_BYTES=262144;
function unknownGpu(observedAt,source='unavailable'){
 return {schema_version:'fleet-gpu-observation/v1',status:'unknown',source,observed_at:observedAt,scope:'host',devices:[]};
}
function numberField(text,key,max){
 const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const matches=[...text.matchAll(new RegExp('"'+escaped+'"=([0-9]+(?:\\.[0-9]+)?)(?=[,}])','g'))];
 if(matches.length!==1)return null;const value=Number(matches[0][1]);return Number.isFinite(value)&&value>=0&&value<=max?value:null;
}
function parseMacGpu(raw,observedAt){
 const unknown=unknownGpu(observedAt,'macos-ioreg');
 if(typeof raw!=='string'||Buffer.byteLength(raw)>MAX_BYTES)return unknown;
 const blocks=raw.split(/(?=^\+-o )/m).filter(block=>block.startsWith('+-o '));
 if(!blocks.length||blocks.length>16)return unknown;
 const devices=blocks.map(block=>{
  const model=block.match(/"model" = "([^"\n]{1,80})"/)?.[1];
  const name=model??block.match(/^\+-o ([A-Za-z0-9_-]{1,80}) /)?.[1];
  if(!name)return null;
  const stats=block.match(/"PerformanceStatistics" = (\{[^\n]*\})/)?.[1]??'';
  const unified=/^Apple M[1-9][0-9]*(?: (?:Pro|Max|Ultra))?$/.test(model??'');
  return {name,utilization_percent:numberField(stats,'Device Utilization %',100),memory_kind:unified?'unified':'unknown',
   memory_used_bytes:unified?numberField(stats,'In use system memory',Number.MAX_SAFE_INTEGER):null};
 });
 if(devices.some(device=>!device))return unknown;
 return {...unknown,status:'present',devices};
}
async function sampleGpu({platform=process.platform,execFileFn=run,now=Date.now}={}){
 const observedAt=new Date(now()).toISOString();
 if(platform!=='darwin')return unknownGpu(observedAt);
 try{const {stdout}=await execFileFn('/usr/sbin/ioreg',['-r','-c','IOAccelerator','-l','-w','0'],
  {encoding:'utf8',shell:false,timeout:1500,maxBuffer:MAX_BYTES,killSignal:'SIGKILL'});
  return parseMacGpu(stdout,observedAt);
 }catch{return unknownGpu(observedAt,'macos-ioreg');}
}
module.exports={sampleGpu,parseMacGpu,unknownGpu};
