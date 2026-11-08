import fs from 'node:fs';
import path from 'node:path';
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {getRelease,getReleaseGate,lockReleaseTarget} from '../lib/release-index.js';
import {resolveMachineId} from '../machine-registry.js';
export const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const PROFILE=/^[a-z][a-z0-9-]{0,63}$/;
export const SCRIPT_MACHINE='us-mac-m4',SCRIPT_REGISTRY='ed3555dc-4777-446c-bdf0-d928d6a08ef1';
export const need=(ok,code)=>{if(!ok)throw Error('execution_script_'+code);};
function grantCandidate({grant,profileId,profileSha256,machineId,executionVersionId},env){
 const c=readManagedScriptCandidates(env.EXECUTION_MANAGED_SCRIPT_CANDIDATES_FILE)[profileId];
 need(c&&grant.provenance==='mac_managed_profile/v1:'+createHash('sha256').update(JSON.stringify(c)).digest('hex')
  &&c.machine_id===machineId&&c.profile_sha256===profileSha256&&grant.profile_id===profileId&&grant.node_version_id===executionVersionId
  &&grant.state==='active'&&grant.account_id===''&&Array.isArray(grant.repo_scope)&&grant.repo_scope.length===0
  &&grant.evidence_task_id===c.evidence_task_id&&new Date(grant.expires_at).getTime()===Date.parse(c.expires_at)
  &&new Date(grant.expires_at).getTime()>Date.now(),'grant_policy_mismatch');
 return c;
}
function assertCandidateTask(task,c){
 const ship=task?.result?.ship_candidate;
 need(task&&task.id===c.evidence_task_id&&['in_progress','completed','completed_no_pr'].includes(task.status)
  &&ship?.schema_version===1&&ship.stage==='candidate'&&ship.task_id===task.id&&ship.repo===c.source_repo
  &&(ship.head_sha===c.source_commit||task.result.merge_sha===c.source_commit)&&typeof ship.actor==='string'&&ship.actor.length>0
  &&Array.isArray(ship.facts)&&ship.facts.length>0&&Array.isArray(ship.evidence)&&ship.evidence.length>0,'candidate_evidence_required');
}
export async function readManagedScriptCandidateEvidence(db,c,{task,lockRelease=false}={}){
 // Activation passes a Task whose row lock it took before the capacity lock.
 // Dispatch must use plain reads for an independent evidence Task, otherwise
 // its capacity -> evidence Task order can deadlock activation.
 const lockedTask=task!==undefined;
 task??=(await db.query('SELECT id,status,result FROM tasks WHERE id=$1',[c.evidence_task_id])).rows[0];
 assertCandidateTask(task,c);
 const release=await getRelease(db,c.release_id);
 if(lockRelease)await lockReleaseTarget(db,release.environment,release.target);
 const gate=await getReleaseGate(db,c.release_id);
 need(resolveMachineId(release.target)===c.machine_id&&gate.deployed===true&&gate.current_observation_id===c.observation_id
  &&gate.verification?.ci_status==='verified'&&gate.verification?.status==='verified'
  &&release.payload.components.some(component=>component.kind==='repo'&&component.repo===c.source_repo&&component.revision===c.source_commit),'release_unverified');
 if(!lockedTask){
  // Release-lock and gate reads may wait. Recheck the independent Task only
  // after every such await; the pre-lock snapshot cannot authorize a launch.
  task=(await db.query('SELECT id,status,result FROM tasks WHERE id=$1',[c.evidence_task_id])).rows[0];
  assertCandidateTask(task,c);
 }
 return {task,release,gate};
}
export async function assertManagedScriptProfileGrant(identity,env=process.env){
 if(!String(identity.grant?.provenance??'').startsWith('mac_managed_profile/'))return null;
 const c=grantCandidate(identity,env);
 need(typeof identity.db?.query==='function','evidence_database_required');
 await readManagedScriptCandidateEvidence(identity.db,c,{lockRelease:true});
 // DB waits are not permission to use a policy which expired or was replaced.
 grantCandidate(identity,env);
 return c;
}
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
export function readManagedScriptCandidates(file,now=Date.now()){
 need(typeof file==='string'&&path.isAbsolute(file),'policy_unavailable');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);let data;
 try{const a=fs.fstatSync(fd);need(a.isFile()&&(a.mode&0o777)===0o600&&[0,process.geteuid()].includes(a.uid)&&a.nlink===1&&a.size<=65536,'policy_untrusted');
  const bytes=fs.readFileSync(fd),b=fs.fstatSync(fd),c=fs.lstatSync(file);
  need(bytes.length===a.size&&['dev','ino','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]&&a[k]===c[k]),'policy_changed');data=JSON.parse(bytes);
 }finally{fs.closeSync(fd);}
 need(object(data)&&Object.keys(data).sort().join(',')==='profiles,schema_version'&&data.schema_version===1&&object(data.profiles),'policy_invalid');
 const keys='evidence_task_id,expires_at,machine_id,machine_registry_id,observation_id,profile_sha256,release_id,source_commit,source_repo';
 for(const [id,c]of Object.entries(data.profiles)){
  need(PROFILE.test(id)&&object(c)&&Object.keys(c).sort().join(',')===keys,'policy_invalid');
  need(c.machine_id===SCRIPT_MACHINE&&c.machine_registry_id===SCRIPT_REGISTRY&&HASH.test(c.profile_sha256)
   &&/^[a-f0-9]{40}$/.test(c.source_commit)&&/^[\w.-]+\/[\w.-]+$/.test(c.source_repo)
   &&[c.release_id,c.observation_id,c.evidence_task_id].every(v=>UUID.test(v))
   &&typeof c.expires_at==='string'&&new Date(c.expires_at).toISOString()===c.expires_at&&Date.parse(c.expires_at)>now
   &&Date.parse(c.expires_at)<=now+24*3600000,'policy_invalid');
 }
 return data.profiles;
}
export function verifyProfileCatalog(envelope,{token,nonce,machineId,profileId,profileSha256,bootId,configDigest,nowMs=Date.now()}){
 const r=envelope?.receipt,signature=createHmac('sha256',token).update(JSON.stringify(r??null)).digest('hex');
 need(HASH.test(envelope?.signature??'')&&timingSafeEqual(Buffer.from(signature),Buffer.from(envelope.signature)),'worker_unconfirmed');
 const age=nowMs-Date.parse(r?.observed_at);
 need(r?.schema_version==='fleet-workflow-profile/v1'&&r.machine_id===machineId&&r.request_nonce===nonce
  &&r.profile_id===profileId&&r.profile_sha256===profileSha256&&r.boot_id===bootId&&r.config_digest===configDigest
  &&UUID.test(r.boot_id??'')&&HASH.test(r.config_digest??'')&&Number.isFinite(age)&&age>=-1000&&age<=5000,'worker_unconfirmed');
 return r;
}
export function createProfileCatalogClient({token=process.env.KERNEL_FLEET_BRIDGE_TOKEN,fetchFn=globalThis.fetch}={}){
 return {async catalog(node,{profileId,profileSha256,bootId,configDigest}){
  need(typeof token==='string'&&token.length>=32,'worker_unconfigured');
  const endpoint=new URL(node.endpoints.worker),octets=endpoint.hostname.split('.');
  need(endpoint.protocol==='http:'&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash&&endpoint.pathname==='/'&&endpoint.port==='5231'
   &&octets.length===4&&octets.every(p=>/^(?:0|[1-9][0-9]{0,2})$/.test(p)&&Number(p)<=255)&&Number(octets[0])===100&&Number(octets[1])>=64&&Number(octets[1])<=127,'worker_unconfigured');
  const nonce=randomUUID();endpoint.pathname='/workflows/profile-catalog';
  const response=await fetchFn(endpoint.href,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({profile_id:profileId,request_nonce:nonce}),signal:AbortSignal.timeout(5000),redirect:'error'});
  need(response.ok,'worker_unconfirmed');const chunks=[];let length=0;
  for await(const value of response.body??[]){length+=value.length;need(length<=16384,'worker_unconfirmed');chunks.push(value);}
  const envelope=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const receipt=verifyProfileCatalog(envelope,{token,nonce,machineId:node.canonical_id,profileId,profileSha256,bootId,configDigest});
  // JSONB reorders object keys. Keep the exact signed string for independent
  // verification after the audit event has passed through PostgreSQL.
  return {...receipt,receipt,signed_payload:JSON.stringify(receipt),signature:envelope.signature};
 }};
}
