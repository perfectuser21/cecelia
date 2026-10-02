import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import fixtureModule from '../../scripts/fleet-worker/linux-script-test-fixture.cjs';
import {normalizeRuntimeDeployment,createRuntimeDeploymentReader} from './runtime-deployment.js';
function input(){const {record:r}=fixtureModule.fixture();return {pool:r.pool,revision:'a'.repeat(40),host_boot_id:randomUUID(),worker_boot_id:r.identity.worker_boot_id,daemon_id:r.daemon_id,
 profiles:{safe:{profile:r.profile,image_id:r.image_id}},worker_credential_file:'/etc/worker.token',execution_credential_file:'/etc/execution.key',parent_task_id:randomUUID()};}
const worker='b'.repeat(64),key='c'.repeat(64);
it('独立受信部署绑定完整profile/image、身份、验收父任务及两份凭据引用，公开policy无secret',()=>{
 const i=input(),d=normalizeRuntimeDeployment(i,worker,key);
 expect(d.expected.machine_registry_id).toBe(i.pool.machine_registry_id);expect(d.endpoint).toBe('http://100.90.1.4:5231');
 expect(d.authority.profiles.safe).toMatch(/^[a-f0-9]{64}$/);expect(d.authority.worker_credential.file).toBe(i.worker_credential_file);
 expect(JSON.stringify({expected:d.expected,authority:d.authority,profile:d.profile})).not.toContain(key);
 expect(normalizeRuntimeDeployment(i,worker,'d'.repeat(64)).policyDigest).not.toBe(d.policyDigest);
});
it('拒绝未知字段、US/scheduler、越额profile、可变镜像及复用Worker令牌',()=>{
 for(const mutate of [i=>i.endpoint='http://evil',i=>i.pool.role='scheduler',i=>i.pool.machine_registry_id='1a379d80-ad36-47d3-88ba-e545ab299a54',
  i=>i.profiles.safe.profile.cpus=99,i=>i.profiles.safe.profile.image='alpine:latest',i=>i.profiles.safe.profile.cwd='/tmp\0bad',i=>i.profiles={},i=>i.parent_task_id='bad']){
  const i=input();mutate(i);expect(()=>normalizeRuntimeDeployment(i,worker,key)).toThrow('linux_pool_runtime_deployment_invalid');
 }
 expect(()=>normalizeRuntimeDeployment(input(),worker,worker)).toThrow('linux_pool_runtime_deployment_invalid');
});
it('仅从登记私有文件读取独立凭据，重复UUID或读取失败默认拒绝',async()=>{
 const i=input(),calls=[],read=createRuntimeDeploymentReader({env:{CECELIA_LINUX_SCRIPT_DEPLOYMENTS_FILE:'/etc/runtime.json'},readProtected:(file,options)=>{
  calls.push({file,options});return file===i.worker_credential_file?worker:file===i.execution_credential_file?key:JSON.stringify({schema_version:1,deployments:[i]});}});
 expect((await read(i.pool.machine_registry_id)).key).toBe(key);expect(calls).toHaveLength(3);expect(calls[2].options).toMatchObject({mode:0o600,maxBytes:64});
 await expect(read(randomUUID())).rejects.toThrow('linux_pool_runtime_deployment_unavailable');
 await expect(createRuntimeDeploymentReader({env:{}})(i.pool.machine_registry_id)).rejects.toThrow('linux_pool_runtime_deployment_unavailable');
});
