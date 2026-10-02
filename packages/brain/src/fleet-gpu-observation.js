export function projectGpuObservation(raw,now=Date.now()){
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
