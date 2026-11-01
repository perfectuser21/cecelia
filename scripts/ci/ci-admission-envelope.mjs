/** 专用typed编码；任何裸内层都不是legacy snapshot。原始封套先验证，scratch能力不可序列化。 */
import {basename} from 'node:path';
import {ciAuthorityProof} from './ci-admission-authority.mjs';
import {loadCiAdmissionSeed,CI_ADMISSION_SCOPES as SCOPES} from './ci-admission-seed.mjs';
import {stepSha256 as hash} from '../../packages/brain/scripts/sync-steps-from-workspace.mjs';
import {validateImplementationSnapshot,extractImplementationAdmissionSnapshots} from '../../packages/brain/src/lib/implementation-ci-snapshot.js';
import {classifyAssertionRef} from '../../packages/brain/src/lib/gp-assertion-command.js';
import {fixedLocalGit} from './fixed-local-git.mjs';
const FORMAT='cecelia.ci-admission/v1',SCOPE_FORMAT='cecelia.ci-scope/v1',HASH=/^[a-f0-9]{64}$/;
const capabilities=new WeakMap(),need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
const seal=(body,key)=>({...body,[key]:hash(body)});
const keys=(object,names)=>object&&hash(Object.keys(object).sort())===hash([...names].sort());
const commonKeys=['ci_format','ci_purpose','ci_repository','ci_source_revision','ci_control_revision','ci_source_tree','ci_seed_sha256','ci_scopes','ci_assertions'];
function encode(value){
 if(value===null)return ['ci.null'];
 if(Array.isArray(value))return ['ci.array',value.map(encode)];
 if(typeof value==='object')return ['ci.object',Object.keys(value).sort().map(k=>[k,encode(value[k])])];
 need(['string','boolean','number'].includes(typeof value)&&!(typeof value==='number'&&!Number.isFinite(value)),'CI_ADMISSION_DOCUMENT_TYPE');
 return [`ci.${typeof value}`,value];
}
function decode(document){
 let count=0;
 const read=(n,depth=0)=>{
  need(++count<=500000&&depth<=100&&Array.isArray(n),'CI_ADMISSION_DOCUMENT_INVALID');
  const [kind,value]=n;
  if(kind==='ci.null'){need(n.length===1,'CI_ADMISSION_DOCUMENT_INVALID');return null;}
  need(n.length===2,'CI_ADMISSION_DOCUMENT_INVALID');
  if(kind==='ci.array'){need(Array.isArray(value),'CI_ADMISSION_DOCUMENT_INVALID');return value.map(v=>read(v,depth+1));}
  if(kind==='ci.object'){
   need(Array.isArray(value)&&value.every(p=>Array.isArray(p)&&p.length===2&&typeof p[0]==='string')&&new Set(value.map(p=>p[0])).size===value.length,'CI_ADMISSION_DOCUMENT_INVALID');
   return Object.fromEntries(value.map(([key,v])=>[key,read(v,depth+1)]));
  }
  need(['ci.string','ci.boolean','ci.number'].includes(kind)&&typeof value===kind.slice(3)&&!(typeof value==='number'&&!Number.isFinite(value)),'CI_ADMISSION_DOCUMENT_INVALID');return value;
 };
 return read(document);
}
const providerIdentity=p=>p&&Object.fromEntries(['run_id','attempt','workflow_id','workflow_path','head_revision'].map(k=>[k,p[k]]));
const identity=p=>({repository:p.repository,source_revision:p.source_revision,control_revision:p.control_revision,ci:p.ci,publisher:providerIdentity(p.publisher)});
function snapshotsValid(snapshots,source){
 need(snapshots.length===3&&snapshots.every((s,i)=>s.scope===SCOPES[i]&&s.repo==='perfectuser21/cecelia'&&s.revision===source&&s.status==='verified'&&s.gaps.length===0),'CI_ADMISSION_SCOPES_INVALID');
 try{snapshots.forEach(validateImplementationSnapshot);const pair=extractImplementationAdmissionSnapshots(snapshots[0],SCOPES.slice(0,2));
  need(pair[1].snapshot_sha256===snapshots[1].snapshot_sha256,'CI_ADMISSION_COMPANION_INVALID');
 }catch(error){if(error.code?.startsWith('CI_ADMISSION_'))throw error;need(false,'CI_ADMISSION_SNAPSHOT_INVALID');}
 for(const s of snapshots.slice(1))need(s.execution_status==='unknown'&&s.definitions.workflows.every(w=>w.payload.contract.executable===false&&w.payload.coverage.status==='unknown'),'CI_ADMISSION_EXECUTION_PROMOTION');
}
function assertionRows(snapshots){return snapshots.flatMap(s=>s.assertions.filter(a=>a.assertion_ref).map(a=>({id:a.id,scope:s.scope,assertion_ref:a.assertion_ref}))).sort((a,b)=>a.id.localeCompare(b.id));}
function canonicalValid(seed,snapshots){
 for(const s of snapshots)for(const [kind,ids] of Object.entries(seed.canonical_ids[s.scope])){
  need(hash((s.canonical[kind]||[]).map(r=>r.id).sort())===hash(ids),'CI_ADMISSION_CANONICAL_SET_MISMATCH');
 }
}
function argvValid(ref,argv){
 if(!Array.isArray(argv)||!argv.length||argv.some(v=>typeof v!=='string'))return false;
 let shape;try{shape=classifyAssertionRef(ref);}catch{return false;}
 const tool=basename(argv[0]),path=v=>v===shape.path||v.endsWith('/'+shape.path);
 if(shape.kind==='bash')return tool==='bash'&&argv.length===2&&path(argv[1]);
 if(shape.kind==='node')return /^node(?:[-.].*)?$/.test(tool)&&argv.length===3&&argv[1]==='--test'&&path(argv[2]);
 if(shape.kind==='pytest')return /^python3(?:\.\d+)*$/.test(tool)&&argv.length===5&&argv.slice(1,4).join(' ')==='-m pytest --'&&path(argv[4]);
 return shape.kind==='vitest'&&/^node(?:[-.].*)?$/.test(tool)&&argv.length===5&&basename(argv[1])==='vitest.mjs'&&argv[2]==='run'&&argv[4]==='--'&&(argv[3].startsWith('./')||!argv[3].startsWith('/'))&&shape.path.endsWith(argv[3].replace(/^\.\//,''));
}
function assertionsValid(statement,seed,snapshots,source,seedHash){
 for(const snapshot of snapshots){
  const actual=snapshot.assertions.map(a=>({id:a.id,assertion_ref:a.assertion_ref||null})).sort((a,b)=>a.id.localeCompare(b.id));
  const expectedCells=seed.scope_cells[snapshot.scope].map(a=>({id:a.id,assertion_ref:a.assertion_ref||null})).sort((a,b)=>a.id.localeCompare(b.id));
  need(hash(actual)===hash(expectedCells),'CI_ADMISSION_ASSERTION_REGISTRY_CHANGED');
 }
 const expected=seed.required_assertions.map(({id,scope,assertion_ref})=>({id,scope,assertion_ref})).sort((a,b)=>a.id.localeCompare(b.id));
 need(hash(assertionRows(snapshots))===hash(expected),'CI_ADMISSION_ASSERTION_REGISTRY_CHANGED');
 const bindings=Object.fromEntries(snapshots.map(s=>[s.scope,s.snapshot_sha256]));
 need(statement?.ci_assertion_format==='cecelia.ci-assertions/v1'&&statement.source_revision===source&&statement.seed_sha256===seedHash
  &&hash(statement.scope_hashes)===hash(bindings)&&hash(statement.required)===hash(expected)&&Array.isArray(statement.executions)&&statement.executions.length>0,'CI_ADMISSION_ASSERTION_STATEMENT');
 const ids=[];
 for(const e of statement.executions){
  const required=expected.filter(a=>a.assertion_ref===e.assertion_ref);
  const valid=required.length&&e.source_repo==='perfectuser21/cecelia'&&e.source_revision===source&&e.exit_code===0&&e.signal===null&&e.error===null
   &&Array.isArray(e.registered_ids)&&hash([...e.registered_ids].sort())===hash(required.map(a=>a.id).sort())&&argvValid(e.assertion_ref,e.command_argv)
   &&[e.test_sha256,e.stdout_sha256,e.stderr_sha256].every(v=>HASH.test(v));
  if(!valid)throw Object.assign(Error(`CI_ADMISSION_ASSERTION_FAILED: ${e.assertion_ref} exit=${e.exit_code} signal=${e.signal} error=${e.error} argv=${JSON.stringify(e.command_argv)}`),{code:'CI_ADMISSION_ASSERTION_FAILED'});
  ids.push(...e.registered_ids);
 }
 need(hash(ids.sort())===hash(expected.map(a=>a.id).sort()),'CI_ADMISSION_ASSERTION_DENOMINATOR');
 const {ci_assertions_sha256,...body}=statement;need(ci_assertions_sha256===hash(body),'CI_ADMISSION_ASSERTION_DIGEST');
}
export async function createCiAdmissionDraft({controlRoot,controlRevision,sourceRevision,snapshots,executions,sourceTree}){
 const {seed,digest}=loadCiAdmissionSeed(controlRoot,controlRevision);
 snapshotsValid(snapshots,sourceRevision);canonicalValid(seed,snapshots);
 const tree=fixedLocalGit(controlRoot,['rev-parse',`${sourceRevision}^{tree}`],{encoding:'utf8'}).trim();
 need(tree===sourceTree,'CI_ADMISSION_TREE_MISMATCH');
 const statement=seal({ci_assertion_format:'cecelia.ci-assertions/v1',source_revision:sourceRevision,seed_sha256:digest,
  scope_hashes:Object.fromEntries(snapshots.map(s=>[s.scope,s.snapshot_sha256])),required:seed.required_assertions.map(({id,scope,assertion_ref})=>({id,scope,assertion_ref})).sort((a,b)=>a.id.localeCompare(b.id)),executions:structuredClone(executions)},'ci_assertions_sha256');
 assertionsValid(statement,seed,snapshots,sourceRevision,digest);
 return seal({ci_format:'cecelia.ci-admission-draft/v1',ci_purpose:'ci_admission_draft',ci_repository:'perfectuser21/cecelia',ci_source_revision:sourceRevision,ci_control_revision:controlRevision,
  ci_source_tree:tree,ci_seed_sha256:digest,
  ci_scopes:snapshots.map(s=>({ci_scope_format:SCOPE_FORMAT,ci_scope_key:s.scope,ci_document:encode(s),ci_document_sha256:s.snapshot_sha256})),ci_assertions:statement},'ci_envelope_sha256');
}
export async function createCiAdmissionEnvelope({authority,controlRoot,draft,...input}){
 const proof=ciAuthorityProof(authority);
 draft??=await createCiAdmissionDraft({...input,controlRoot,controlRevision:proof.control_revision,sourceRevision:proof.source_revision});
 need(keys(draft,[...commonKeys,'ci_envelope_sha256'])&&draft.ci_format==='cecelia.ci-admission-draft/v1'&&draft.ci_purpose==='ci_admission_draft','CI_ADMISSION_DRAFT_INVALID');
 const {ci_envelope_sha256,...raw}=draft;need(ci_envelope_sha256===hash(raw),'CI_ADMISSION_DRAFT_DIGEST');
 const envelope=seal({...raw,ci_format:FORMAT,ci_purpose:'ci_admission_only',ci_authority:identity(proof)},'ci_envelope_sha256');
 const {seed,digest}=loadCiAdmissionSeed(controlRoot,proof.control_revision);validate(envelope,proof,seed,digest);
 need(envelope.ci_source_tree===fixedLocalGit(controlRoot,['rev-parse',`${proof.source_revision}^{tree}`],{encoding:'utf8'}).trim(),'CI_ADMISSION_TREE_MISMATCH');return envelope;
}
function validate(envelope,proof,seed,digest){
 need(keys(envelope,[...commonKeys,'ci_authority','ci_envelope_sha256'])&&envelope.ci_format===FORMAT&&envelope.ci_purpose==='ci_admission_only'&&envelope.ci_repository==='perfectuser21/cecelia'
  &&envelope.ci_source_revision===proof.source_revision&&envelope.ci_control_revision===proof.control_revision
  &&hash(envelope.ci_authority)===hash(identity(proof))&&envelope.ci_seed_sha256===digest,'CI_ADMISSION_ENVELOPE_IDENTITY');
 const {ci_envelope_sha256,...body}=envelope;need(ci_envelope_sha256===hash(body),'CI_ADMISSION_ENVELOPE_DIGEST');
 need(Array.isArray(envelope.ci_scopes)&&envelope.ci_scopes.length===3,'CI_ADMISSION_SCOPES_INVALID');
 const snapshots=envelope.ci_scopes.map((e,i)=>{
  need(keys(e,['ci_scope_format','ci_scope_key','ci_document','ci_document_sha256'])&&e.ci_scope_format===SCOPE_FORMAT&&e.ci_scope_key===SCOPES[i],'CI_ADMISSION_SCOPE_ENCODING');
  const snapshot=decode(e.ci_document);need(snapshot.snapshot_sha256===e.ci_document_sha256,'CI_ADMISSION_SCOPE_DIGEST');return snapshot;
 });
 snapshotsValid(snapshots,proof.source_revision);canonicalValid(seed,snapshots);assertionsValid(envelope.ci_assertions,seed,snapshots,proof.source_revision,digest);return snapshots;
}
export async function authorizeCiAdmissionEnvelope(envelope,{authority,controlRoot}){
 const proof=ciAuthorityProof(authority);
 need(proof.publisher?.app_id===15368&&Number.isSafeInteger(proof.publisher.job_id),'CI_ADMISSION_COMPLETED_PROVIDER_REQUIRED');
 need(proof.artifact?.document_sha256===hash(envelope),'CI_ADMISSION_ARTIFACT_BOUND_REQUIRED');
 const {seed,digest}=loadCiAdmissionSeed(controlRoot,proof.control_revision);validate(envelope,proof,seed,digest);
 need(envelope.ci_source_tree===fixedLocalGit(controlRoot,['rev-parse',`${proof.source_revision}^{tree}`],{encoding:'utf8'}).trim(),'CI_ADMISSION_TREE_MISMATCH');
 const cap=Object.freeze(Object.create(null));capabilities.set(cap,{envelope,hash:hash(envelope),proof,seed,digest});return cap;
}
function state(cap){need(capabilities.has(cap),'CI_ADMISSION_ENVELOPE_CAPABILITY_REQUIRED');const s=capabilities.get(cap);need(hash(s.envelope)===s.hash,'CI_ADMISSION_ENVELOPE_CHANGED');return s;}
export function inspectCiAdmission(cap){const s=state(cap);return {source_revision:s.proof.source_revision,control_revision:s.proof.control_revision,scopes:[...SCOPES],envelope_sha256:s.envelope.ci_envelope_sha256};}
function legacyTree(value){if(!value||typeof value!=='object')return false;return value.schema_version===1&&typeof value.scope==='string'&&value.snapshot_sha256||Object.values(value).some(legacyTree);}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export async function withCiAdmissionScratch(cap,{db,usage},consume){
 need(usage==='pr','CI_ADMISSION_USAGE_FORBIDDEN');
 const s=state(cap),views=validate(s.envelope,s.proof,s.seed,s.digest);
 const identity=(await db.query('SELECT current_database() AS database,current_schema() AS schema')).rows;
 need(identity.length===1&&identity[0].database==='cecelia_scratch'&&/^ci_admission_[a-f0-9]{32}$/.test(identity[0].schema||''),'CI_ADMISSION_SCRATCH_REQUIRED');
 const result=await consume(freeze(views));need(!legacyTree(result),'CI_ADMISSION_LEGACY_ESCAPE');return result;
}
