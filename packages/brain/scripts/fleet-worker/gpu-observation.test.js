import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let api={};try{api=require('./gpu-observation.cjs');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
const sample=percent=>`+-o AGXAcceleratorG16G <class AGXAcceleratorG16G>\n  | "model" = "Apple M4"\n  | "PerformanceStatistics" = {"Device Utilization %"=${percent},"In use system memory"=327155712}`;
it('GPU独立有界采样，可信零值与未知分离，统一内存仅作观测',async()=>{
 expect(api.sampleGpu).toBeTypeOf('function');
 const calls=[];const gpu=await api.sampleGpu({platform:'darwin',now:()=>1000,execFileFn:async(file,args,options)=>{calls.push({file,args,options});return {stdout:sample(0)};}});
 expect(gpu).toMatchObject({status:'present',source:'macos-ioreg',observed_at:'1970-01-01T00:00:01.000Z',devices:[{name:'Apple M4',utilization_percent:0,memory_kind:'unified',memory_used_bytes:327155712}]});
 expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({file:'/usr/sbin/ioreg',args:['-r','-c','IOAccelerator','-l','-w','0'],options:{shell:false,timeout:1500,maxBuffer:262144}});
 expect(gpu.devices[0]).not.toHaveProperty('memory_capacity_bytes');
});
it.each(['error','empty','oversized','invalid-percent','missing-stats'])('GPU未知不伪造0或无设备：%s',async mode=>{
 expect(api.sampleGpu).toBeTypeOf('function');
 const gpu=await api.sampleGpu({platform:'darwin',execFileFn:async()=>{if(mode==='error')throw Error('private machine details');return {stdout:mode==='empty'?'':mode==='oversized'?'x'.repeat(262145):mode==='missing-stats'?sample(0).split('PerformanceStatistics')[0]:sample(101)};}});
 if(['invalid-percent','missing-stats'].includes(mode)){expect(gpu.status).toBe('present');expect(gpu.devices[0].utilization_percent).toBeNull();}
 else expect(gpu.status).toBe('unknown');
 expect(JSON.stringify(gpu)).not.toContain('private machine details');
});
it('Linux缺完整宿主inventory保持unknown，不执行Mac工具',async()=>{
 expect(api.sampleGpu).toBeTypeOf('function');let called=false;
 const gpu=await api.sampleGpu({platform:'linux',execFileFn:async()=>{called=true;}});expect(gpu.status).toBe('unknown');expect(called).toBe(false);
});

it('实际健康入口附带GPU采样，失败不触发CPU内存字段改写',async()=>{
 const {probeFleetWorkerHealth}=require('./node-probe.cjs');
 const options={machineId:'xian-mac-m1',platform:'darwin',execFileFn:async(file)=>{if(file==='/usr/sbin/ioreg')return {stdout:sample(7)};throw Error('unavailable');},statFn:async()=>{throw Error('missing');},fetchFn:async()=>({ok:false}),makeTempDirFn:async()=>{throw Error('unavailable');}};
 const health=await probeFleetWorkerHealth(options);expect(health.gpu).toMatchObject({status:'present',devices:[{utilization_percent:7}]});
 expect(health.resources.cpu_cores).toBe(0);expect(health.resources.memory_bytes).toBe(0);
});

it('真实 Worker HTTP保留GPU白名单，Brain可读取且私有额外字段不外泄',async()=>{
 const {createFleetWorkerServer}=require('./fleet-worker.cjs');
 const gpu=await api.sampleGpu({platform:'darwin',execFileFn:async()=>({stdout:sample(0)})});
 gpu.secret='private';gpu.devices[0].token='private';
 const server=createFleetWorkerServer({probeHealth:async()=>({gpu,resources:{cpu_cores:4,memory_bytes:8*1024**3}})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const response=await fetch(`http://127.0.0.1:${server.address().port}/health`);
  const health=await response.json();
  expect(health.gpu).toMatchObject({schema_version:'fleet-gpu-observation/v1',scope:'host',status:'present',devices:[{utilization_percent:0}]});
  expect(JSON.stringify(health.gpu)).not.toContain('private');
  const {projectGpuObservation}=await import('../../src/fleet-gpu-observation.js');
  expect(projectGpuObservation(health.gpu).status).toBe('present');
  expect(health.resources.cpu_cores).toBe(4);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

it('GPU超时与原CPU采样并行，真实HTTP仍在Brain五秒期限内返回',async()=>{
 const {createFleetWorkerServer}=require('./fleet-worker.cjs');const {probeFleetWorkerHealth}=require('./node-probe.cjs');
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const server=createFleetWorkerServer({probeHealth:()=>probeFleetWorkerHealth({machineId:'us-mac-m4',platform:'darwin',
  execFileFn:async(file,args)=>{
   if(file==='/usr/sbin/ioreg'){await sleep(1500);throw Error('GPU timed out');}
   if(file==='sw_vers'){await sleep(3800);return {stdout:'15.5'};}
   if(file==='sysctl'&&args[1]==='hw.ncpu')return {stdout:'10'};
   if(file==='sysctl'&&args[1]==='hw.memsize')return {stdout:String(16*1024**3)};
   return {stdout:''};
  },statFn:async()=>{throw Error('missing');},fetchFn:async()=>({ok:false}),makeTempDirFn:async()=>{throw Error('fixture');}
 })});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const response=await fetch(`http://127.0.0.1:${server.address().port}/health`,{signal:AbortSignal.timeout(5000)});
  expect(response.status).toBe(200);const health=await response.json();expect(health.resources.cpu_cores).toBe(10);expect(health.gpu.status).toBe('unknown');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
},10000);
