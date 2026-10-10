/** 手机巡查窄来源登记：固定 Git、现存组织身份；不是运行完成证明。 */
import {createHash} from 'node:crypto';
export const PATROL_SCOPE='cecelia-device-patrol',PATROL_REPO='perfectuser21/zenithjoy-workspace';
export const PATROL_PATH='scripts/phone-account-patrol/implementation-contract.json';
export const PATROL_PREFIX='scripts/phone-account-patrol/';
export const PATROL_CAPABILITY='2173a385-a743-41f3-bb7d-d0e4b1d51d4e';
const owners=new Map([['66fe22f5-1a60-4e23-bcfb-7b4df2f0fbff','single-phone-account-patrol'],['7dfd3b5d-bc5a-4d96-b744-10d26bc7eb70','phone-account-patrol-batch']]);
export const PATROL_ASSERTION='node --test scripts/phone-account-patrol/implementation-regression.test.mjs';
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const fail=(code,message=code,status=422)=>{throw Object.assign(Error(message),{code,status});};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const revision=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const safePath=value=>typeof value==='string'&&value.startsWith(PATROL_PREFIX)&&/^[-\w./]+$/.test(value)&&!value.split('/').some(p=>!p||p==='.'||p==='..');
export function validatePatrolContract(doc){
 if(!doc||doc.schema_version!==1||doc.scope!==PATROL_SCOPE||doc.capability_id!==PATROL_CAPABILITY||!Array.isArray(doc.workflows)||doc.workflows.length!==owners.size)fail('PATROL_CONTRACT_IDENTITY');
 const seen=new Set(),activities=new Set();
 for(const w of doc.workflows){
  if(owners.get(w.id)!==w.key||seen.has(w.id)||!Array.isArray(w.activities)||!w.activities.length)fail('PATROL_WORKFLOW_IDENTITY');seen.add(w.id);
  for(const a of w.activities){
   if(!uuid(a.id)||activities.has(a.id)||typeof a.key!=='string'||!a.key||a.assertion_ref!==PATROL_ASSERTION||!Array.isArray(a.bindings)||!a.bindings.length||a.bindings.some(p=>!safePath(p)||!(/\.(?:py|mjs|swift)$/.test(p))||/test/.test(p)))fail('PATROL_ACTIVITY_IDENTITY');activities.add(a.id);
  }
 }
 const permitted=new Set([PATROL_PATH,PATROL_PREFIX+'implementation-regression.test.mjs',PATROL_PREFIX+'test_runner.py',PATROL_PREFIX+'test_identity.py',PATROL_PREFIX+'test_runtime_safety.py',PATROL_PREFIX+'test_deploy.py',PATROL_PREFIX+'test_publish.mjs',PATROL_PREFIX+'SKILL.md',PATROL_PREFIX+'RUNBOOK.md']);
 if(!Array.isArray(doc.auxiliary_paths)||doc.auxiliary_paths.some(p=>!permitted.has(p))||new Set(doc.auxiliary_paths).size!==doc.auxiliary_paths.length)fail('PATROL_AUXILIARY_SCOPE');
 if(doc.maintenance_owner!=='主理人'||doc.schedule?.time!=='22:00'||doc.schedule?.timezone!=='Asia/Shanghai')fail('PATROL_OWNER_SCHEDULE');
 return doc;
}
export function validatePatrolBootstrap(proof){
 if(!proof||!revision(proof.base_revision)||!revision(proof.introduced_revision)||proof.base_revision===proof.introduced_revision||!revision(proof.base_tree_sha)||!Array.isArray(proof.base_paths)||!Array.isArray(proof.introduced_paths)||proof.compare_status!=='ahead'||typeof proof.actor!=='string'||!proof.actor.trim()||proof.base_paths.some(p=>p.startsWith(PATROL_PREFIX))||!proof.introduced_paths.includes(PATROL_PATH))fail('PATROL_BASE_NOT_PROVEN');
 return proof;
}
export function patrolSourceProof(contract,sourceRevision,read){
 validatePatrolContract(contract);if(!revision(sourceRevision))fail('PATROL_REVISION_INVALID');
 const bytes=Buffer.from(read(PATROL_PATH)),bindings=[];
 if(JSON.stringify(canonical(JSON.parse(bytes.toString())))!==JSON.stringify(canonical(contract)))fail('PATROL_CONTRACT_BYTES_MISMATCH');
 for(const w of contract.workflows)for(const a of w.activities)for(const path of a.bindings){const contents=Buffer.from(read(path));if(!contents.length)fail('PATROL_SOURCE_EMPTY');bindings.push({workflow_id:w.id,activity_id:a.id,slot_key:a.key,repo:PATROL_REPO,revision:sourceRevision,path,sha256:sha(contents),assertion_ref:a.assertion_ref});}
 const auxiliary=contract.auxiliary_paths.map(path=>({path,sha256:sha(Buffer.from(read(path)))}));
 const body={schema_version:1,scope:PATROL_SCOPE,repo:PATROL_REPO,revision:sourceRevision,capability_id:PATROL_CAPABILITY,contract,contract_sha256:sha(bytes),bindings,auxiliary};
 return {...body,source_sha256:sha(JSON.stringify(canonical(body)))};
}
export function validatePatrolSnapshot(snapshot){
 if(!snapshot||snapshot.schema_version!==1||snapshot.scope!==PATROL_SCOPE||snapshot.repo!==PATROL_REPO||snapshot.purpose!=='scope_identity_bootstrap_only'||snapshot.revision_basis!=='requested_ci_input_not_source_attestation'||snapshot.status!=='verified'||snapshot.gaps?.length!==0||!snapshot.registration||!revision(snapshot.revision))fail('PATROL_SNAPSHOT_UNKNOWN');
 const {snapshot_sha256,...body}=snapshot;if(snapshot_sha256!==sha(JSON.stringify(canonical(body))))fail('PATROL_SNAPSHOT_DIGEST');
 validatePatrolBootstrap(snapshot.registration.provenance);validatePatrolContract(snapshot.registration.source.contract);
 return snapshot;
}
