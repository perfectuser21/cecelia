import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {execFileSync,spawn} from 'node:child_process';
import {markerFixture} from './fixtures.js';
const require=createRequire(import.meta.url),digest='a'.repeat(64);
const target={machine_id:'fixture-machine',worker_id:'fixture-worker',physical_boot_id:'fixture-observed-boot',config_digest:digest,build_digest:digest,action_digest:digest,ssh:{host:'fixture-host',user:'administrator',port:22}};
const observation=()=>({machine_id:target.machine_id,worker_id:target.worker_id,physical_boot_id:target.physical_boot_id,config_digest:digest,build_digest:digest,action:'adb_get_state',action_digest:digest,
 resources:{cpu_count:4,memory_total_bytes:8000000000,memory_free_bytes:1000000000,load_1m:0.2,data_free_bytes:1000000000},adb_daemon:{reachable:true},external_locks:{occupied:0},maintenance:{draining:true,stable:true,pending:0,in_flight:0,activity_revision:0,quiescent:true,marker_identity:markerFixture},observed_at:new Date().toISOString()});
function realFixture(value,record=[]){return async(file,args,input)=>{
 record.push({file,args,input});
 const script='const r=JSON.parse(process.argv[1]);process.stdout.write(JSON.stringify({schema:"phone-physical-probe/v1",request_nonce:r.request_nonce,...JSON.parse(process.argv[2])}));';
 return {code:0,stdout:execFileSync(process.execPath,['-e',script,input,JSON.stringify(value)],{encoding:'utf8'})};
};}
it('真实子进程能力回执绑定固定SSH/nonce/boot/hash且不制造available',async()=>{
 const {createCapabilities}=require('./capabilities.cjs'),record=[];
 const capabilities=createCapabilities({targets:[target],run:realFixture(observation(),record)});
 const result=await capabilities(target.machine_id);
 expect(result).toMatchObject({physical_boot_id:target.physical_boot_id,action:'adb_get_state'});expect(result).not.toHaveProperty('available');
 expect(record[0].file).toBe('/usr/bin/ssh');expect(record[0].args).toContain('StrictHostKeyChecking=yes');expect(record[0].args).toContain('ControlMaster=no');expect(record[0].args.at(-1)).toBe('/opt/homebrew/bin/python3 /opt/cecelia/phone-ssh/probe.py');
 expect(Object.keys(JSON.parse(record[0].input))).toEqual(['schema','request_nonce']);
});
it('未知机器及caller伪造目标不能执行SSH',async()=>{
 const {createCapabilities}=require('./capabilities.cjs');let calls=0;
 const fn=createCapabilities({targets:[target],run:async()=>{calls++;}});
 await expect(fn('attacker')).rejects.toThrow('phone_target_unconfigured');expect(calls).toBe(0);
 for(const bad of [{...target,ssh:{...target.ssh,host:'-bad'}},{...target,extra:'bad'},{...target,config_digest:'unknown'}])expect(()=>createCapabilities({targets:[bad]})).toThrow();
});
it('nonce/身份/完整digest/资源观测/新鲜度任何未知都拒绝',async()=>{
 const {createCapabilities}=require('./capabilities.cjs');
 for(const patch of [{physical_boot_id:'changed'},{worker_id:'changed'},{config_digest:'b'.repeat(64)},{build_digest:'b'.repeat(64)},{action_digest:'b'.repeat(64)},{resources:{}},{external_locks:{occupied:false}},{external_locks:{occupied:1}},{adb_daemon:{}},{observed_at:'invalid'},{observed_at:new Date(Date.now()-60000).toISOString()},{request_nonce:'replayed'},{available:1},{maintenance:{pending:0}},
  {maintenance:{...observation().maintenance,marker_identity:undefined}},{maintenance:{...observation().maintenance,marker_identity:{...markerFixture,boot_id:'different boot'}}}]){
  await expect(createCapabilities({targets:[target],run:realFixture({...observation(),...patch})})(target.machine_id)).rejects.toThrow('phone_capabilities_unconfirmed');
 }
});
it('固定SSH真实子进程超时被终止，诊断不暴露',async()=>{
 const {createCapabilities}=require('./capabilities.cjs'),{runSsh}=require('../phone-ssh/transport.cjs');let child;
 const run=(file,args,input,options)=>runSsh(file,args,input,{...options,spawnProcess:(_f,_a,opts)=>{child=spawn(process.execPath,['-e','setTimeout(()=>{},20000)'],opts);return child;}});
 await expect(createCapabilities({targets:[target],run,timeoutMs:50})(target.machine_id)).rejects.toThrow('phone_capabilities_unconfirmed');
 await new Promise(r=>child.once('close',r));expect(()=>process.kill(child.pid,0)).toThrow();
});
it('真实物理probe私有manifest/hash/boot/资源及无daemon启动合同',()=>{
 execFileSync('python3',['-B','-m','unittest','test_probe','-v'],{cwd:new URL('.',import.meta.url),stdio:['ignore','pipe','pipe'],timeout:20000});
});
