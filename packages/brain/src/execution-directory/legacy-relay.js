import { directory } from './directory.js';
import { authorize } from './store.js';
// 本阶段没有导入本地/SSH relay 身份。只有目录中受信版本的精确绑定可选出机器和账号；
// controller machine、任务 payload、可打开的开关和 Harness grant 都不能代替该绑定。
export async function withLegacyRelayExecution({pool,location,provider,credentialIdentity,repo},operation){
 const snapshot=directory.current();
 const match=snapshot?.nodes.flatMap(node=>(node.endpoints?.legacy_relay??[]).map(binding=>({node,binding})))
  .find(({binding})=>binding.location===location&&binding.provider===provider&&binding.credential_identity===credentialIdentity);
 if(!match||!credentialIdentity||!match.binding.account_id||!match.binding.profile_id)throw Error('execution_legacy_identity_required');
 if(typeof repo!=='string'||!repo)throw Error('execution_repo_required');
 return authorize(pool,{snapshotVersion:snapshot.version,machineId:match.node.canonical_id,surface:'legacy_executor',provider,
  account:match.binding.account_id,repo,profileId:match.binding.profile_id},()=>operation());
}
