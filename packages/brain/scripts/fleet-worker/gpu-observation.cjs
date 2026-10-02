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
function projectGpuObservation(raw,now=Date.now()){
 const unknown={status:'unknown',source:'unavailable',observed_at:null,devices:[]};
 if(!raw||raw.schema_version!=='fleet-gpu-observation/v1'||raw.scope!=='host'||!['macos-ioreg','unavailable'].includes(raw.source))return unknown;
 const at=Date.parse(raw.observed_at);
 if(!Number.isFinite(at)||now-at>=90000||at-now>30000)return unknown;
 const base={status:raw.status,source:raw.source,observed_at:raw.observed_at,devices:[]};
 if(raw.status==='unknown')return {...base,status:'unknown'};
 if(raw.status!=='present'||raw.source!=='macos-ioreg'||!Array.isArray(raw.devices)||!raw.devices.length||raw.devices.length>16)return unknown;
 const devices=[];
 for(const d of raw.devices){
  if(!d||typeof d.name!=='string'||!d.name||d.name.length>80||/[\x00-\x1f\x7f]/.test(d.name)
   ||!(d.utilization_percent===null||Number.isFinite(d.utilization_percent)&&d.utilization_percent>=0&&d.utilization_percent<=100)
   ||!['unified','unknown'].includes(d.memory_kind)||!(d.memory_used_bytes===null||Number.isSafeInteger(d.memory_used_bytes)&&d.memory_used_bytes>=0))return unknown;
  devices.push({name:d.name,utilization_percent:d.utilization_percent,memory_kind:d.memory_kind,memory_used_bytes:d.memory_used_bytes});
 }
 return {...base,devices};
}

module.exports={sampleGpu,parseMacGpu,unknownGpu,projectGpuObservation};
