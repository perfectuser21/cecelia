import {readFixedGitFile} from './fixed-git-source.js';
import {probeInvocationRuntime} from '../invocations/resolve.js';
/** 仅本轮缓存固定Git字节与即时资源探测，不能跨轮延长权限有效期。 */
export function readinessAdmission(options={}){
 const deadline=options.deadline??Date.now()+15000;
 const signal=AbortSignal.any([AbortSignal.timeout(Math.max(1,deadline-Date.now())),...(options.signal?[options.signal]:[])]);
 const check=()=>{if(signal.aborted||Date.now()>=deadline)throw Object.assign(Error('readiness_deadline_exceeded'),{code:'readiness_deadline_exceeded'});};
 const files=new Map();let bytes=0,runtime;
 const readFile=source=>{
  check();const key=JSON.stringify([source.repo,source.path,source.revision]);
  if(!files.has(key)){
   if(files.size>=64)throw Error('readiness_source_limit');
   files.set(key,Promise.resolve().then(async()=>{
    check();const value=await (options.readFile??readFixedGitFile)(source,{...options,deadline,signal});check();
    bytes+=Buffer.byteLength(value);if(bytes>512*1024)throw Error('readiness_source_limit');return value;
   }));
  }
  return files.get(key);
 };
 return {...options,deadline,signal,readFile,probeRuntime:()=>{check();return runtime??=(options.probeRuntime??probeInvocationRuntime)({signal,deadline});}};
}
