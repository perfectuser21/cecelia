import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {buildLinuxOnboardingPolicy} from './onboarding-policy.js';
import {normalizeRuntimeDeployment} from './runtime-deployment.js';
const G=2**30,image='alpine@sha256:'+'a'.repeat(64);
function input(){return {machine_registry_id:randomUUID(),machine_id:'hk-vps',role:'worker',endpoint_host:'100.64.0.2',
 observation:{os:'linux',observed_at:new Date().toISOString(),resources:{cpu_cores:8,memory_total_bytes:16*G}},image,image_id:'sha256:'+'a'.repeat(64)};}
it.each([[8,16,2,4],[2,4,1,2],[1,3,.5,1],[16,6,2,3]])('保留至少半机/2GiB；%s核%sGiB只给池%s核%sGiB且一个脚本槽', (cores,mem,cpu,budget)=>{
 const x=input();Object.assign(x.observation.resources,{cpu_cores:cores,memory_total_bytes:mem*G});
 const result=buildLinuxOnboardingPolicy(x);
 expect(result.pool.pool).toEqual({cpu_cores:cpu,memory_bytes:budget*G,pids_limit:256});expect(result.capacity).toBe(1);
 const d=normalizeRuntimeDeployment({pool:result.pool,profiles:result.profiles,revision:'b'.repeat(40),host_boot_id:randomUUID(),worker_boot_id:randomUUID(),
  daemon_id:'actual-daemon',parent_task_id:randomUUID(),worker_credential_file:'/etc/worker.token',execution_credential_file:'/etc/execution.key'},'c'.repeat(64),'d'.repeat(64));
 expect(Object.keys(d.profiles)).toEqual(['shell']);expect(d.profiles.shell.profile).toMatchObject({cpus:cpu,memoryBytes:Math.min(G,budget*G),user:'65534:65534',cwd:'/tmp'});
});
it.each(['small','stale','future','cpu','os','image','us','scheduler'])('%s前置失败不给执行配置',kind=>{
 const x=input();if(kind==='small')x.observation.resources.memory_total_bytes=2*G;if(kind==='stale')x.observation.observed_at=new Date(Date.now()-120001).toISOString();
 if(kind==='future')x.observation.observed_at=new Date(Date.now()+31000).toISOString();if(kind==='cpu')x.observation.resources.cpu_cores=0;
 if(kind==='os')x.observation.os='darwin';if(kind==='image')x.image='alpine:latest';if(kind==='us')x.machine_registry_id='1a379d80-ad36-47d3-88ba-e545ab299a54';
 if(kind==='scheduler')x.role='scheduler';expect(()=>buildLinuxOnboardingPolicy(x)).toThrow();
});
