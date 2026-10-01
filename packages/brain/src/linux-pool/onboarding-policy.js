import {US_SCHEDULER_ID,error} from './deployment.js';
import poolModule from '../../scripts/fleet-worker/linux-pool-profile.cjs';
const GiB=2**30,MiB=2**20;
/** 仅受信接入后台调用。观测仅生成保守静态预算，真正启动仍必须通过fresh身份与root动态闸。 */
export function buildLinuxOnboardingPolicy({machine_registry_id,machine_id,role,endpoint_host,observation,image,image_id},now=Date.now()){
 const fail=()=>{throw error('linux_pool_onboarding_budget_unavailable');};
 const r=observation?.resources,age=now-Date.parse(observation?.observed_at);
 if(role!=='worker'||machine_registry_id===US_SCHEDULER_ID||observation?.os!=='linux'||!Number.isFinite(age)||age< -30000||age>120000
  ||!Number.isInteger(r?.cpu_cores)||r.cpu_cores<1||r.cpu_cores>1024||!Number.isSafeInteger(r?.memory_total_bytes)||r.memory_total_bytes<=0
  ||!/^sha256:[a-f0-9]{64}$/.test(image_id??''))fail();
 const cpu=Math.min(2,r.cpu_cores/2),reserve=Math.max(2*GiB,Math.ceil(r.memory_total_bytes/2));
 const memory=Math.floor(Math.min(4*GiB,r.memory_total_bytes-reserve)/MiB)*MiB;
 if(cpu<.5||memory<256*MiB)fail();
 const pool={schema_version:1,machine_registry_id,machine_id,role,endpoint_host,docker_host:'unix:///var/run/docker.sock',
  pool:{cpu_cores:cpu,memory_bytes:memory,pids_limit:256},canary_image:image};
 if(!poolModule.validateLinuxPoolProfile(pool).execution_budget_available)fail();
 return {capacity:1,pool,profiles:{shell:{image_id,profile:{image,cpus:cpu,memoryBytes:Math.min(GiB,memory),pidsLimit:64,
  logMaxSizeBytes:MiB,logMaxFiles:1,user:'65534:65534',cwd:'/tmp'}}}};
}
