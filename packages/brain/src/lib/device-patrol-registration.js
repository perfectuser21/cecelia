/** 内部认证入口背后的真实Git引入登记；客户端不能自报Git树、来源摘要或空base。 */
import {createHash} from 'node:crypto';
import {resolveGitHubToken} from '../harness-credentials.js';
import {snapshotDefinitions} from './definition-versions.js';
import {PATROL_SCOPE,PATROL_REPO,PATROL_PATH,PATROL_CAPABILITY,sha,canonical,validatePatrolBootstrap,validatePatrolContract,patrolSourceProof} from './device-patrol-admission.js';
const fail=(code,status=422)=>{throw Object.assign(Error(code),{code,status});};
const revision=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
async function gitReader({fetchFn,token}){
 const fetchJson=async path=>{const r=await fetchFn(`https://api.github.com/repos/${PATROL_REPO}/${path}`,{redirect:'error',headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});if(!r.ok)fail('PATROL_GIT_UNAVAILABLE',503);return r.json();};
 const tree=async commit=>{const c=await fetchJson(`git/commits/${commit}`);if(c.sha!==commit||!revision(c.tree?.sha))fail('PATROL_GIT_COMMIT_MISMATCH');const t=await fetchJson(`git/trees/${c.tree.sha}?recursive=1`);if(t.sha!==c.tree.sha||t.truncated||!Array.isArray(t.tree))fail('PATROL_GIT_TREE_INCOMPLETE');return {sha:t.sha,entries:t.tree.filter(e=>e.type==='blob')};};
 const blob=async entry=>{if(!entry||!['100644','100755'].includes(entry.mode))fail('PATROL_GIT_FILE_MISSING');const b=await fetchJson(`git/blobs/${entry.sha}`);if(b.sha!==entry.sha||b.encoding!=='base64'||b.size>16*1024*1024)fail('PATROL_GIT_BLOB_INVALID');const bytes=Buffer.from(b.content,'base64'),digest=createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex');if(bytes.length!==b.size||digest!==entry.sha)fail('PATROL_GIT_BLOB_MISMATCH');return bytes;};
 return {tree,blob,compare:(base,head)=>fetchJson(`compare/${base}...${head}`)};
}
export async function bootstrapPatrolScope(pool,input,{fetchFn=globalThis.fetch,resolveToken=resolveGitHubToken,reader}={}){
 if(!input||Object.keys(input).some(k=>!['base_revision','introduced_revision','actor'].includes(k))||!revision(input.base_revision)||!revision(input.introduced_revision)||typeof input.actor!=='string'||!input.actor.trim())fail('PATROL_BOOTSTRAP_INPUT');
 const git=reader||await gitReader({fetchFn,token:await resolveToken()});
 const [base,introduced,compare]=await Promise.all([git.tree(input.base_revision),git.tree(input.introduced_revision),git.compare(input.base_revision,input.introduced_revision)]);
 const provenance=validatePatrolBootstrap({...input,base_tree_sha:base.sha,introduced_tree_sha:introduced.sha,base_paths:base.entries.map(e=>e.path),introduced_paths:introduced.entries.map(e=>e.path),compare_status:compare.status});
 if(compare.merge_base_commit?.sha!==input.base_revision)fail('PATROL_BASE_ANCESTRY_MISMATCH');
 const raw=await git.blob(introduced.entries.find(e=>e.path===PATROL_PATH)),contract=validatePatrolContract(JSON.parse(raw.toString()));
 const paths=[...new Set([PATROL_PATH,...contract.auxiliary_paths,...contract.workflows.flatMap(w=>w.activities.flatMap(a=>a.bindings))])];
 const bytes=new Map(await Promise.all(paths.map(async path=>[path,path===PATROL_PATH?raw:await git.blob(introduced.entries.find(e=>e.path===path))])));
 const source=patrolSourceProof(contract,input.introduced_revision,path=>bytes.get(path));
 const client=await pool.connect();
 try{
  await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('device-patrol-scope-bootstrap'))");
  const existing=(await client.query('SELECT * FROM implementation_scope_bootstraps WHERE scope_key=$1 AND source_repo=$2 FOR UPDATE',[PATROL_SCOPE,PATROL_REPO])).rows[0];
  if(existing){if(existing.base_revision!==input.base_revision||existing.introduced_revision!==input.introduced_revision||existing.registration.source.source_sha256!==source.source_sha256)fail('PATROL_BOOTSTRAP_CONFLICT',409);await client.query('COMMIT');return {registration:existing.registration,created:false};}
  const definitions=new Map(),bindings=new Map(),authoringReceipts=new Map();
  for(const w of contract.workflows){
   const actual=(await client.query('SELECT * FROM workflows WHERE id=$1 FOR UPDATE',[w.id])).rows[0];
   if(!actual||actual.key!==w.key||actual.capability_id!==PATROL_CAPABILITY||actual.status==='retired')fail('PATROL_CANONICAL_WORKFLOW_MISMATCH');
   const authoring=(await client.query(`SELECT result->'workflow_authoring' AS state FROM tasks WHERE result->'workflow_authoring'->'outputs'->'register'->>'workflow_id'=$1 AND result->'workflow_authoring'->'outputs'->'register'->>'readback_verified'='true' ORDER BY updated_at DESC LIMIT 1`,[w.id])).rows[0]?.state;
   if(authoring?.stage!=='completed')fail('PATROL_AUTHORING_NOT_VERIFIED');
   authoringReceipts.set(w.id,authoring.outputs.register);
   const refs=(await client.query('SELECT r.*,a.activity_key FROM workflow_activity_refs r JOIN activities a ON a.id=r.activity_id WHERE r.workflow_id=$1 AND r.active ORDER BY r.sequence_no FOR UPDATE OF r',[w.id])).rows;
   if(refs.length!==w.activities.length||refs.some((r,i)=>r.activity_id!==w.activities[i].id||r.slot_key!==w.activities[i].key))fail('PATROL_CANONICAL_ACTIVITY_MISMATCH');
   definitions.set(w.id,{...w,capability_id:PATROL_CAPABILITY,executable:false,scope:PATROL_SCOPE,maintenance_owner:contract.maintenance_owner,schedule:contract.schedule});
   for(const a of w.activities){
    bindings.set(a.id,source.bindings.filter(b=>b.activity_id===a.id).map(b=>({kind:b.path.endsWith('SKILL.md')?'skill':'code',repo:b.repo,path:b.path,revision:b.revision,content_sha256:b.sha256,status:'verified',validation_scope:'reference_only'})));
   }
  }
  await snapshotDefinitions(client,{workflowIds:contract.workflows.map(w=>w.id),source:{repo:PATROL_REPO,path:PATROL_PATH,commit:input.introduced_revision},bindingsByActivity:bindings,documentsByWorkflow:definitions,admissionScope:PATROL_SCOPE,authoringByWorkflow:authoringReceipts});
  const versions=(await client.query('SELECT id,workflow_id,source_commit,payload_sha256 FROM workflow_definition_versions WHERE source_repo=$1 AND source_commit=$2 AND workflow_id=ANY($3::uuid[]) ORDER BY workflow_id',[PATROL_REPO,input.introduced_revision,contract.workflows.map(w=>w.id)])).rows;
  const registration={schema_version:1,purpose:'source_admission_only',scope:PATROL_SCOPE,repo:PATROL_REPO,provenance,source,definition_versions:versions};
  const hash=sha(JSON.stringify(canonical(registration)));
  await client.query('INSERT INTO implementation_scope_bootstraps(scope_key,source_repo,base_revision,introduced_revision,registration,registration_sha256,actor) VALUES($1,$2,$3,$4,$5,$6,$7)',[PATROL_SCOPE,PATROL_REPO,input.base_revision,input.introduced_revision,registration,hash,input.actor]);
  await client.query('COMMIT');return {registration,created:true};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
export async function exportPatrolAdmissionSnapshot(pool,input){
 if(input.scope!==PATROL_SCOPE||input.repo!==PATROL_REPO||!revision(input.revision))fail('PATROL_SNAPSHOT_INPUT');
 const row=(await pool.query('SELECT * FROM implementation_scope_bootstraps WHERE scope_key=$1 AND source_repo=$2',[PATROL_SCOPE,PATROL_REPO])).rows[0];
 if(!row)fail('PATROL_SCOPE_NOT_BOOTSTRAPPED',409);
 const body={schema_version:1,scope:PATROL_SCOPE,repo:PATROL_REPO,revision:input.revision,revision_basis:'requested_ci_input_not_source_attestation',purpose:'scope_identity_bootstrap_only',status:'verified',gaps:[],registration:row.registration,registration_sha256:row.registration_sha256};
 return {...body,snapshot_sha256:sha(JSON.stringify(canonical(body)))};
}
