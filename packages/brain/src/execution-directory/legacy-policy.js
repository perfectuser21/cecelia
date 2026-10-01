import workspacePolicy from '../../scripts/fleet-worker/workspace-manager.cjs';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { hashConfig,endpointValid } from './directory.js';
// 只导入当前已部署策略；UUID绑定设备真身，角色和名称都不能生成执行许可。
export const LEGACY_BINDINGS=Object.freeze([
 ['us-mac-m4','ed3555dc-4777-446c-bdf0-d928d6a08ef1','mac-mini-m4-us','claude'],
 ['xian-mac-m1','9e94241f-7eeb-4987-a657-107fd9ae263a','mac-mini-m1-xian',null],
 ['xian-mac-m4','af1834a6-a55d-4021-8490-143d5686c49e','mac-mini-m4-xian','codex'],
]);
export const LEGACY_REPOS=Object.freeze(Object.keys(workspacePolicy.FLEET_REPOSITORIES));
export function legacyRecords({env=process.env}={}) {
 const profiles=JSON.parse(readFileSync(new URL('../../config/fleet-node-profiles.json',import.meta.url),'utf8')).profiles;
 return LEGACY_BINDINGS.map(([canonical_id,machine_registry_id,name,legacy])=>{
  const configured=env[`FLEET_WORKER_${canonical_id.toUpperCase().replaceAll('-','_')}_URL`];
  const endpoints=endpointValid(configured)?{worker:configured}:{};
  const profile=profiles.find(p=>p.machine_id===canonical_id);const id=randomUUID();
  const grant=(surface,provider,account_id='',profile_id='')=>({id:randomUUID(),node_version_id:id,surface,provider,account_id,repo_scope:[...LEGACY_REPOS],profile_id,provenance:'legacy_policy',evidence_task_id:null,state:'active',expires_at:null});
  const grants=['team1','team2','team3','team4','team5'].map(account=>grant('harness','codex',account));
  if(canonical_id==='us-mac-m4')grants.push(grant('harness','claude','account1'),grant('harness','claude','account2'),grant('harness','grok','grok'));
  if(legacy)grants.push(grant('legacy_executor',legacy));
  // 受管脚本 profile 来自部署侧显式登记，绝不由18个Harness账号扩展。
  const scriptProfiles=JSON.parse(env.EXECUTION_LEGACY_SCRIPT_PROFILES??'{}');
  if(String(env.SCRIPT_MANAGED_MACHINES??'').split(',').map(x=>x.trim()).includes(canonical_id))
   for(const profileId of scriptProfiles[canonical_id]??[])if(typeof profileId==='string'&&profileId)grants.push(grant('managed_script','script','',profileId));
  return {id,canonical_id,machine_registry_id,name,metadata:{},machine_status:'active',revision:1,identity_mode:'legacy-v1',worker_id:canonical_id,worker_boot_id:null,platform:'darwin',endpoints,profile,
   config_hash:hashConfig({endpoints,profile}),state:'active',grants};
 });
}
