import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import serverModule from '../../scripts/fleet-worker/linux-pool-server.cjs';
import {buildLinuxOnboardingPolicy} from './onboarding-policy.js';
import {createOnboardingCredentials} from './onboarding-credentials.js';
import {createOnboardingSSH} from './onboarding-ssh.js';
import {verifyLinuxInstallation} from './onboarding-installation.js';
import {createLinuxDeploymentWriter} from './deployment-writer.js';
import {createLinuxPoolAuthorization} from './service.js';
import {createLinuxRuntimeAuthorization} from './runtime-service.js';
import {error} from './deployment.js';
import {createOnboardingRecovery} from './onboarding-recovery.js';
export const ONBOARDING_IMAGE='alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc';
const FILES=['linux-pool-installer.cjs','linux-pool-profile.cjs','linux-pool-proof.cjs','linux-pool-server.cjs','linux-pool-canary.cjs','linux-resource-probe.cjs','linux-cgroup.cjs',
 'linux-script-canary.cjs','linux-script-service.cjs','linux-script-launch-gate.cjs','linux-script-runtime.cjs','linux-script-docker.cjs','linux-script-permit.cjs','linux-script-bridge.cjs','script-runner.cjs'];
const sourceFiles=()=>Object.fromEntries(FILES.map(name=>[name,fs.readFileSync(fileURLToPath(new URL('../../scripts/fleet-worker/'+name,import.meta.url)),'utf8')]));
/** 每次只推进一个持久阶段。所有外部副作用之前的intent/nonce由调用方已经写入tasks。 */
export function createLinuxOnboardingStep({pool,ssh=createOnboardingSSH(),credentials=createOnboardingCredentials(),writer=createLinuxDeploymentWriter(),
 poolAuthorization=createLinuxPoolAuthorization({pool}),runtimeAuthorization=createLinuxRuntimeAuthorization({pool}),sources=sourceFiles,
 readSecret=p=>serverModule.readInstalledFile(p,{mode:0o600,owner:0,maxBytes:64}),recover=createOnboardingRecovery({pool,poolAuthorization,runtimeAuthorization})}={}){
 return async(task,machine,state,save)=>{
  const id=machine.id,request=machine.metadata.onboarding.request;
  const remote=(action,extra={})=>ssh(id,request,{action,machine_registry_id:id,nonce:state.nonce,...extra});
  const next=(phase,patch={})=>save({...state,...patch,phase,error:null,next_retry_at:null});
  const policy=()=>JSON.parse(state.policy_json),fact=()=>JSON.parse(state.installation_json).receipt,runtime=()=>JSON.parse(state.runtime_json);
  switch(state.phase){
   case 'renew_revoke':
    await runtimeAuthorization.revoke(id,{runtime_id:state.previous_runtime_id,expected_version_id:state.expected_version_id});return next('renew_wait');
   case 'renew_wait':{
    const occupied=(await pool.query("SELECT id FROM capacity_reservations WHERE machine_id=$1 AND status<>'released' LIMIT 1",[machine.name])).rows.length;
    if(occupied)return state;return next('refresh_installation');
   }
   case 'probe':{
    if(!/^[a-f0-9]{40}$/.test(state.revision??''))throw error('linux_pool_control_unavailable');
    const observed=await remote('probe',{image:ONBOARDING_IMAGE});
    if(observed.machine_registry_id!==id||observed.nonce!==state.nonce||observed.image!==ONBOARDING_IMAGE)throw error('linux_pool_prerequisites_unavailable');
    const endpoint=isIP(request.address)?request.address:(await lookup(request.address)).address;
    const p=buildLinuxOnboardingPolicy({machine_registry_id:id,machine_id:machine.name,role:machine.metadata.role,endpoint_host:endpoint,
     observation:observed,image:ONBOARDING_IMAGE,image_id:observed.image_id});
    return next('credentials',{policy_json:JSON.stringify(p)});
   }
   case 'credentials':{
    const result=await credentials(id,state.credentials,async value=>{state={...state,credentials:value};return save(state);});
    return next('bootstrap',{credential_files:result});
   }
   case 'refresh_installation':
   case 'bootstrap':{
    const files=state.credential_files,p=policy(),key=readSecret(files.execution_credential_file);
    const envelope=await remote(state.phase==='bootstrap'?'bootstrap':'installation',{intent_id:state.intent_id,pool:p.pool,revision:state.revision,
     ...(state.phase==='bootstrap'?{sources:sources(),worker_token:readSecret(files.worker_credential_file),execution_key:key}:{})});
    verifyLinuxInstallation(envelope,{machine_registry_id:id,nonce:state.nonce,intent_id:state.intent_id,pool:p.pool,revision:state.revision,key});
    return next('deployment',{installation_json:JSON.stringify(envelope)});
   }
   case 'deployment':{
    const p=policy(),f=fact(),files=state.credential_files;
    const common={revision:f.revision,host_boot_id:f.host_boot_id,worker_boot_id:f.worker_boot_id,daemon_id:f.daemon_id};
    const a=writer.pool({profile:p.pool,...common,image_id:f.image_id,script_profiles:Object.keys(p.profiles),credential_file:files.worker_credential_file},state.pool_policy_digest??null);
    const b=writer.runtime({pool:p.pool,...common,profiles:p.profiles,worker_credential_file:files.worker_credential_file,execution_credential_file:files.execution_credential_file,parent_task_id:task.id},state.runtime_policy_digest??null);
    return next('pool_challenge',{pool_policy_digest:a.policy_digest,runtime_policy_digest:b.policy_digest});
   }
   case 'pool_challenge':return next('pool_canary',{challenge:await poolAuthorization.challenge(id,{expected_version_id:state.expected_version_id})});
   case 'pool_canary':return next('pool_attest',{pool_envelope_json:JSON.stringify(await remote('pool_canary',{nonce:state.challenge.nonce}))});
   case 'pool_attest':{
    const envelope=JSON.parse(state.pool_envelope_json);
    if(await recover('pool',id,state,envelope))return next('pool_challenge',{pool_envelope_json:null,attestation_id:null});
    const found=(await pool.query(`SELECT id FROM linux_pool_attestations WHERE challenge_id=$1 AND machine_registry_id=$2 AND signed_payload=$3 AND signature=$4 AND state IN ('accepted','ready')`,
     [state.challenge.id,id,JSON.stringify(envelope.receipt),envelope.signature])).rows[0];
    const result=found??await poolAuthorization.attest(id,{challenge_id:state.challenge.id,envelope});return next('pool_ready',{attestation_id:result.id});
   }
   case 'pool_ready':{
    if(await recover('pool',id,state,JSON.parse(state.pool_envelope_json)))return next('pool_challenge',{pool_envelope_json:null,attestation_id:null});
    const found=(await pool.query(`SELECT a.execution_version_id FROM linux_pool_attestations a JOIN execution_nodes n ON n.machine_registry_id=a.machine_registry_id
     WHERE a.id=$1 AND a.machine_registry_id=$2 AND a.state='ready' AND n.current_version_id=a.execution_version_id`,[state.attestation_id,id])).rows[0];
    const result=found??await poolAuthorization.activate(id,{attestation_id:state.attestation_id,expected_version_id:state.expected_version_id});
    return next('script_prepare',{expected_version_id:result.execution_version_id});
   }
   case 'script_prepare':return next('script_configure',{runtime_json:JSON.stringify(await runtimeAuthorization.prepare(id,{expected_version_id:state.expected_version_id}))});
   case 'script_configure':{
    const result=await remote('runtime',{configuration:runtime().runtime_configuration});
    if(result.written!==true||result.execution!==false||result.nonce!==state.nonce)throw error('linux_pool_configuration_unconfirmed');return next('script_canary');
   }
   case 'script_canary':return next('script_activate',{script_envelope_json:JSON.stringify(await remote('script_canary',{nonce:runtime().nonce}))});
   case 'script_activate':{
    if(await recover('script',id,state,JSON.parse(state.script_envelope_json)))return next('script_prepare',{runtime_json:null,script_envelope_json:null});
    const result=await runtimeAuthorization.activate(id,{runtime_id:runtime().id,expected_version_id:state.expected_version_id,envelope:JSON.parse(state.script_envelope_json)});
    if(result.execution!==true||result.authorization_state!=='active')throw error('linux_pool_runtime_unavailable');return next('active',{active:result});
   }
   case 'active':return state;
   default:throw error('linux_pool_control_unavailable');
  }
 };
}
