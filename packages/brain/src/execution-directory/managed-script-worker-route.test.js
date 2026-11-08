import {it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {resolveManagedScriptWorkerEndpoint,freezeManagedScriptWorkerRoute,resolveFrozenManagedScriptWorkerRoute} from './managed-script-profile-evidence.js';
import {httpTransport} from '../lib/common-runner-dispatch.js';
const token='owned-worker-route-test-key-'.repeat(3),hash='a'.repeat(64),boot=randomUUID(),runId=randomUUID(),taskId=randomUUID();
const node={id:randomUUID(),canonical_id:'us-mac-m4',endpoints:{worker:'http://100.71.151.105:5231'}};
const policy={machine_id:'us-mac-m4',profile_sha256:hash,source_commit:'b'.repeat(40),worker_endpoint:'http://100.71.151.105:15231',worker_boot_id:boot,worker_config_digest:hash};
const grant={id:randomUUID(),node_version_id:node.id,provenance:'mac_managed_profile/v1:'+createHash('sha256').update(JSON.stringify(policy)).digest('hex')};
it('候选端口只允许原目录同numeric Tailnet host的不同非特权HTTP origin，原node原件不变',()=>{
 const before=structuredClone(node);expect(resolveManagedScriptWorkerEndpoint(policy,node)).toBe(policy.worker_endpoint);expect(node).toEqual(before);
 for(const endpoint of ['http://100.71.151.106:15231','http://localhost:15231','http://127.0.0.1:15231','https://100.71.151.105:15231','http://100.71.151.105:80','http://100.71.151.105:5231','http://x:y@100.71.151.105:15231','http://100.71.151.105:15231/path','http://100.71.151.105:15231/?x=1'])expect(()=>resolveManagedScriptWorkerEndpoint({...policy,worker_endpoint:endpoint},node)).toThrow('execution_script_');
});
it('冻结route签名绑定run/task/profile/source/policy/boot/config，cleanup不依赖已过期或删除的当前policy',async()=>{
 const route=freezeManagedScriptWorkerRoute({policy,node,grant,executionVersionId:node.id,runId,taskId,profileId:'candidate'},token);
 const binding={run_id:runId,task_id:taskId,machine_id:node.canonical_id,execution_version_id:node.id,execution_grant_id:grant.id,profile:'candidate',profile_sha256:hash,worker_route:route};
 expect(resolveFrozenManagedScriptWorkerRoute(binding,node,token).endpoint).toBe(policy.worker_endpoint);
 for(const field of ['endpoint','worker_boot_id','policy_sha256','source_commit']){
  const changed=structuredClone(binding);changed.worker_route.payload[field]='changed';expect(()=>resolveFrozenManagedScriptWorkerRoute(changed,node,token)).toThrow('execution_script_');
 }
 const seen=[];await httpTransport({endpoint:policy.worker_endpoint,workerRoute:route,action:'inspect',runId,body:{task_id:taskId},token,fetchFn:async(url)=>{seen.push(url.origin);return {ok:true,body:(async function*(){yield Buffer.from('{}');})()};}});expect(seen).toEqual([policy.worker_endpoint]);
 await expect(httpTransport({endpoint:policy.worker_endpoint,action:'start',runId,body:{task_id:taskId},token,fetchFn:()=>{throw Error('must not send');}})).rejects.toThrow('common_runner_transport_unconfigured');
});
