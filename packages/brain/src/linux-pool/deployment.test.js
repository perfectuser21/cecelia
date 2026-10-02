import { randomUUID } from 'node:crypto';
import { it,expect } from 'vitest';
import { createDeploymentReader,normalizeDeployment } from './deployment.js';
function record(){return {profile:{schema_version:1,machine_registry_id:randomUUID(),machine_id:'hk-vps',role:'worker',endpoint_host:'100.90.1.4',docker_host:'unix:///var/run/docker.sock',pool:{cpu_cores:2,memory_bytes:2**30,pids_limit:128},canary_image:'fixture/image@sha256:'+'a'.repeat(64)},revision:'b'.repeat(40),host_boot_id:randomUUID(),worker_boot_id:randomUUID(),daemon_id:'daemon',image_id:'sha256:'+'c'.repeat(64),script_profiles:['report'],credential_file:'/etc/cecelia/credentials/hk-pool.token'};}
it('可信配置唯一匹配UUID，token只从登记文件读取，返回期望不含secret或任意endpoint',async()=>{
 const input=record(),paths=[],token='d'.repeat(64);
 const read=createDeploymentReader({env:{CECELIA_LINUX_POOL_DEPLOYMENTS_FILE:'/etc/cecelia/deployments.json'},readProtected:(filename,options)=>{paths.push({filename,options});return filename===input.credential_file?token:JSON.stringify({schema_version:1,deployments:[input]});}});
 const d=await read(input.profile.machine_registry_id);expect(d.token).toBe(token);expect(JSON.stringify(d.expected)).not.toContain(token);
 expect(d.expected.endpoint).toBe('http://100.90.1.4:5231');expect(paths[1]).toMatchObject({filename:input.credential_file,options:{mode:0o600,maxBytes:64}});
 expect(normalizeDeployment(input,'e'.repeat(64)).policyDigest).not.toBe(d.policyDigest);
 await expect(read(randomUUID())).rejects.toThrow('linux_pool_deployment_unavailable');
});
it('缺失、宽权限或重复登记均拒绝，错误不得带密钥内容',async()=>{
 const input=record();for(const readProtected of [()=>{throw Error('secret-data-permission-error');},()=>JSON.stringify({schema_version:1,deployments:[input,input]})]){
  await expect(createDeploymentReader({env:{CECELIA_LINUX_POOL_DEPLOYMENTS_FILE:'/etc/cecelia/deployments.json'},readProtected})(input.profile.machine_registry_id)).rejects.toThrow(/^linux_pool_deployment_unavailable$/);
 }
 for(const mutate of [x=>x.endpoint='http://evil/',x=>x.script_profiles=[],x=>x.script_profiles=['report','report'],x=>x.profile.pool.memory_bytes=0,x=>x.profile.role='scheduler',x=>x.profile.endpoint_host='127.0.0.1']){const x=record();mutate(x);expect(()=>normalizeDeployment(x,'d'.repeat(64))).toThrow('linux_pool_deployment_invalid');}
});
