/** 服务端首次授权后固定的运行身份；不从可编辑Task.result恢复授权或重开启动槽。 */
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,hash=/^[a-f0-9]{64}$/;
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const ordered=x=>Array.isArray(x)?x.map(ordered):object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])])):x;
const canonical=x=>JSON.stringify(ordered(x));
const fail=()=>{throw Error('common_runner_identity_unproven');};
export function commonRunnerIdentity(binding){
 const keys=['task_id','run_id','machine_id','profile','profile_sha256','mode','execution_version_id','execution_grant_id','input_digest'];
 if(!object(binding)||!['task_id','run_id','execution_version_id','execution_grant_id'].every(k=>uuid.test(binding[k]??''))
  ||!['profile_sha256','input_digest'].every(k=>hash.test(binding[k]??''))||typeof binding.machine_id!=='string'||!binding.machine_id.trim()
  ||!/^[a-z][a-z0-9-]{0,63}$/.test(binding.profile??'')||!['formal','exploration'].includes(binding.mode)
  ||(binding.worker_route!=null&&!object(binding.worker_route)))fail();
 return {protocol:'common-runner-identity/v1',...Object.fromEntries(keys.map(k=>[k,binding[k]])),worker_route:structuredClone(binding.worker_route??null)};
}
export function commonRunnerIdentityMatches(frozen,binding){try{return object(frozen)&&canonical(frozen)===canonical(commonRunnerIdentity(binding));}catch{return false;}}
export function commonRunnerExecutionContext(binding,nonce){
 if(!uuid.test(nonce??''))fail();
 return {common_runner_identity:commonRunnerIdentity(binding),common_runner_worker_route:binding.worker_route??null,
  common_runner_launch:{protocol:'common-runner-launch/v1',state:'reserved',nonce}};
}
export function commonRunnerLaunch(context){
 const value=context?.common_runner_launch;
 if(!object(value)||Object.keys(value).sort().join(',')!=='nonce,protocol,state'||value.protocol!=='common-runner-launch/v1'||!['reserved','not_started'].includes(value.state)||!uuid.test(value.nonce??''))fail();
 return value;
}
