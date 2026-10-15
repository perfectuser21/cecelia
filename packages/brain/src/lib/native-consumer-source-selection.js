/** 只为无 current 的同 SHA native 历史歧义提供完整固定 Git 证明；不写历史或指针。 */
import {createHash} from 'node:crypto';
import {buildExistingOpsSources,EXISTING_OPS_IDENTITIES,EXISTING_OPS_REPO,EXISTING_OPS_SCOPE} from './existing-ops-source.js';
import {readExistingOpsRegistry,validateExistingOpsRegistry} from './existing-ops-registration.js';
import {readNativeConsumerRuntime,assertNativeConsumerRuntime} from './native-consumer-runtime.js';
import {resolveGitHubToken} from '../harness-credentials.js';
import {stepSha256} from '../../scripts/sync-steps-from-workspace.mjs';
const SHA=/^[a-f0-9]{40}$/;
const native=q=>q.repo===EXISTING_OPS_REPO&&q.scope===EXISTING_OPS_SCOPE&&SHA.test(q.revision||'');
const eligible=w=>w.payload?.definition_scope==='consumer_evidence'&&w.payload.source_scope===EXISTING_OPS_SCOPE
 &&!Object.hasOwn(w.payload,'source_set')&&!w.payload.registration_protocol&&EXISTING_OPS_IDENTITIES.some(i=>i.workflow_id===w.workflow_id);
const validPath=p=>typeof p==='string'&&p.length>0&&!p.includes('\\')&&!p.includes('\0')&&!p.split('/').some(s=>!s||s==='.'||s==='..');
const digest=value=>stepSha256(JSON.parse(JSON.stringify(value)));
const closureHash=digest(readNativeConsumerRuntime().files);
const caches=new WeakMap();
function cacheFor(fetchFn,resolveToken){
 let resolvers=caches.get(fetchFn);if(!resolvers){resolvers=new WeakMap();caches.set(fetchFn,resolvers);}
 let cache=resolvers.get(resolveToken);if(!cache){cache=new Map();resolvers.set(resolveToken,cache);}return cache;
}
async function buildProof(q,fetchFn,resolveToken){
 const token=await resolveToken(),base=`https://api.github.com/repos/${EXISTING_OPS_REPO}`,deadline=AbortSignal.timeout(540000);
 const get=async(url,raw=false)=>{
  const response=await fetchFn(url,{redirect:'error',headers:{Accept:raw?'application/vnd.github.raw':'application/vnd.github+json',Authorization:`Bearer ${token}`},signal:AbortSignal.any([deadline,AbortSignal.timeout(15000)])});
  if(!response.ok)throw Error('source_unavailable');return raw?response.text():response.json();
 };
 const commit=await get(`${base}/git/commits/${q.revision}`);
 if(commit.sha!==q.revision||!SHA.test(commit.tree?.sha||''))throw Error('source_commit_mismatch');
 const tree=await get(`${base}/git/trees/${commit.tree.sha}?recursive=1`);
 if(tree.sha!==commit.tree.sha||tree.truncated!==false||!Array.isArray(tree.tree)||tree.tree.length>200000)throw Error('source_tree_incomplete');
 const entries=new Map();
 for(const entry of tree.tree){
  if(!validPath(entry.path)||entries.has(entry.path)||!SHA.test(entry.sha||'')||!['tree','blob','commit'].includes(entry.type))throw Error('source_tree_invalid');
  entries.set(entry.path,entry);
 }
 const reads=new Map();
 const readSource=async path=>{
  if(reads.has(path))return reads.get(path);
  const entry=entries.get(path);
  if(entry?.type!=='blob'||!['100644','100755'].includes(entry.mode)||reads.size>=10000)throw Error('source_blob_invalid');
  const pending=(async()=>{
   const text=await get(`${base}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${q.revision}`,true);
   if(typeof text!=='string')throw Error('source_blob_invalid');
   const bytes=Buffer.from(text),sha=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
   if(sha!==entry.sha)throw Error('source_blob_mismatch');return text;
  })();reads.set(path,pending);return pending;
 };
 await assertNativeConsumerRuntime(readSource);
 const proof=await buildExistingOpsSources({...q,paths:[...entries.values()].filter(e=>e.type==='blob').map(e=>e.path),readSource});
 if(proof.consumers.length!==EXISTING_OPS_IDENTITIES.length||proof.consumers.some(c=>c.status!=='verified'||c.gaps.length))throw Error('source_unknown');
 return {repo:q.repo,revision:q.revision,tree:tree.sha,collector_sha256:closureHash,proof};
}
async function cachedProof(q,{fetchFn=globalThis.fetch,resolveToken=resolveGitHubToken}={}){
 const cache=cacheFor(fetchFn,resolveToken),prefix=`${q.repo}@${q.revision}:${closureHash}`;
 // SHA 内容不可变；成功项保留 tree identity，不缓存任何数据库状态或失败。
 for(const [key,value] of cache)if(key.startsWith(`${prefix}:`)){cache.delete(key);cache.set(key,value);return value;}
 while(cache.size>=4){const disposable=[...cache.keys()].find(key=>!key.endsWith(':pending'));if(!disposable)throw Error('source_proof_busy');cache.delete(disposable);}
 const pending=buildProof(q,fetchFn,resolveToken),key=`${prefix}:pending`;cache.set(key,pending);
 try{
  const result=await pending;cache.delete(key);cache.set(`${prefix}:${result.tree}`,Promise.resolve(result));
  while(cache.size>4)cache.delete(cache.keys().next().value);return result;
 }catch(error){cache.delete(key);throw error;}
}
/** 事务外预检只决定是否值得取源；最终选择必须在导出 RR 快照重新比对。 */
export async function prepareNativeConsumerSelection(pool,q,options){
 if(!native(q))return null;
 const registrations=(await pool.query('SELECT * FROM map_scope_repositories WHERE scope_key=$1',[q.scope])).rows
  .filter(r=>r.repo===q.repo||r.adapter_config?.source_repo===q.repo);
 if(registrations.length!==1||registrations[0].adapter_config?.definition_protocol)return null;
 const rows=(await pool.query('SELECT * FROM workflow_definition_versions WHERE source_repo=$1 AND source_commit=$2',[q.repo,q.revision])).rows.filter(eligible);
 const workflows=(await pool.query('SELECT * FROM workflows WHERE id=ANY($1::uuid[])',[EXISTING_OPS_IDENTITIES.map(i=>i.workflow_id)])).rows;
 if(!workflows.some(w=>{const candidates=rows.filter(r=>r.workflow_id===w.id);return candidates.length>1&&!candidates.some(r=>r.id===w.current_definition_version_id);}))return null;
 try{return await cachedProof(q,options);}catch{return null;}
}
function sealed(row,source,kind,id,expected){
 return row&&row[`${kind}_id`]===id&&row.source_repo===source.repo&&row.source_commit===source.commit&&row.source_path===source.path
  &&row.contract_sha256===digest(expected.contract)&&row.payload_sha256===digest({source,payload:row.payload})&&digest(row.payload)===digest(expected);
}
/** 完整闭包比较，包含 registry/来源/ref/contract/封印；不按时间、数量、客户端 ID 选版。 */
export async function selectNativeConsumerDefinition(db,q,rows,prepared){
 if(!native(q)||!prepared||prepared.repo!==q.repo||prepared.revision!==q.revision||prepared.collector_sha256!==closureHash||rows.length<2||rows.some(w=>!eligible(w)))return null;
 try{
  const registry=await readExistingOpsRegistry(db);validateExistingOpsRegistry(registry);
  const identity=EXISTING_OPS_IDENTITIES.find(i=>i.workflow_id===rows[0].workflow_id);
  if(!identity||rows.some(w=>w.workflow_id!==identity.workflow_id))return null;
  const consumer=prepared.proof.consumers.find(c=>c.workflow_id===identity.workflow_id),workflow=registry.workflows.find(w=>w.id===identity.workflow_id);
  const ids=rows.flatMap(w=>Array.isArray(w.payload.activities)?w.payload.activities.map(a=>a.activity_version_id):[]).filter(id=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id||''));
  const activities=(await db.query('SELECT * FROM activity_definition_versions WHERE id=ANY($1::uuid[])',[ids])).rows;
  if(activities.some(a=>Object.hasOwn(a.payload,'source_set')))return null;
  const source={repo:q.repo,commit:q.revision,path:identity.workflow_key==='factory_f2_ops'?'.github/workflows/brain-ci-deploy.yml':'.github/workflows/nightly-regression.yml'};
  const contract={key:identity.workflow_key,definition_scope:'consumer_evidence',executable:false,source_basis:'fixed_git_tree'};
  const activityPayload={activity_id:identity.activity_id,definition_key:`${identity.workflow_key}.${identity.slot_key}`,source_scope:EXISTING_OPS_SCOPE,
   definition_scope:'consumer_evidence',registration_sha256:registry.registry_sha256,contract,steps:[],implementation_bindings:consumer.bindings,
   input_relations:consumer.input_relations,verification:{runtime_status:'not_evaluated'}};
  const matches=rows.filter(row=>{
   if(row.payload.activities?.length!==1)return false;
   const activity=activities.find(a=>a.id===row.payload.activities[0].activity_version_id);
   if(!sealed(activity,source,'activity',identity.activity_id,activityPayload))return false;
   const expected={workflow_id:workflow.id,key:workflow.key,name:workflow.name,capability_id:workflow.capability_id,channel:workflow.channel,form:workflow.form,
    source_scope:EXISTING_OPS_SCOPE,definition_scope:'consumer_evidence',registration_sha256:registry.registry_sha256,contract,
    coverage:prepared.proof.workflows.find(w=>w.workflow_id===workflow.id).coverage,
    activities:[{reference_id:identity.reference_id,slot_key:identity.slot_key,sequence_no:identity.sequence_no,activity_id:identity.activity_id,
     activity_version_id:activity.id,source_ref:registry.references.find(r=>r.id===identity.reference_id).source_ref}]};
   return sealed(row,source,'workflow',identity.workflow_id,expected);
  });
  return matches.length===1?matches[0]:null;
 }catch{return null;}
}
