/** 只登记既有工作流的 Git 来源；不创建/激活流程、活动或执行定义。 */
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { resolveGitHubToken } from '../harness-credentials.js';
import { contractPath } from './activity-contract-loader.js';
const REPO='perfectuser21/zenithjoy-workspace';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const KEY=/^[a-zA-Z0-9_-]+$/, SHA=/^[a-f0-9]{40}$/;
const FIELDS=['source_repo','source_path','source_workflow','source_capability'];
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
function validate(input) {
 if(!input || Object.keys(input).some(k=>!['workflow_id','capability_id','revision','actor','expected',...FIELDS].includes(k))
  ||!UUID.test(input.workflow_id)||!UUID.test(input.capability_id)||!SHA.test(input.revision)
  ||input.source_repo!==REPO||!KEY.test(input.source_capability||'')||!KEY.test(input.source_workflow||'')
  ||input.source_path!==contractPath(input.source_capability)||typeof input.actor!=='string'||!input.actor.trim()||input.actor.length>200
  ||!input.expected||Object.keys(input.expected).length!==5||!Number.isSafeInteger(input.expected.contract_sync_revision)||input.expected.contract_sync_revision<0
  ||FIELDS.some(k=>!Object.hasOwn(input.expected,k)||(input.expected[k]!==null&&typeof input.expected[k]!=='string')))fail('WORKFLOW_SOURCE_INPUT_INVALID',400);
}
async function readFixedContract(input,{fetchFn=globalThis.fetch,resolveToken=resolveGitHubToken}={}) {
 const token=await resolveToken();
 const get=async(kind,sha)=>{
  if(!['commits','trees','blobs'].includes(kind)||!SHA.test(sha||''))fail('WORKFLOW_SOURCE_GIT_REFERENCE_INVALID');
  const url=new URL('https://api.github.com');
  url.pathname=`/repos/${REPO}/git/${encodeURIComponent(kind)}/${encodeURIComponent(sha)}`;
  if(kind==='trees')url.search='recursive=1';
  const r=await fetchFn(url.href,{redirect:'error',headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  if(!r.ok)fail('WORKFLOW_SOURCE_GIT_UNAVAILABLE',503);return r.json();
 };
 const commit=await get('commits',input.revision);
 if(commit.sha!==input.revision||!SHA.test(commit.tree?.sha||''))fail('WORKFLOW_SOURCE_COMMIT_MISMATCH');
 const tree=await get('trees',commit.tree.sha);
 if(tree.sha!==commit.tree.sha||tree.truncated||!Array.isArray(tree.tree))fail('WORKFLOW_SOURCE_TREE_INCOMPLETE');
 const entries=tree.tree.filter(e=>e.path===input.source_path);
 if(entries.length!==1||entries[0].type!=='blob'||!['100644','100755'].includes(entries[0].mode))fail('WORKFLOW_SOURCE_FILE_INVALID');
 const blob=await get('blobs',entries[0].sha);
 if(blob.sha!==entries[0].sha||blob.encoding!=='base64'||!Number.isSafeInteger(blob.size)||blob.size<1||blob.size>1024*1024)fail('WORKFLOW_SOURCE_BLOB_INVALID');
 const bytes=Buffer.from(blob.content,'base64');
 if(bytes.length!==blob.size||createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex')!==blob.sha)fail('WORKFLOW_SOURCE_BLOB_MISMATCH');
 return {document:yaml.load(bytes.toString('utf8')),sha256:createHash('sha256').update(bytes).digest('hex')};
}
export async function registerWorkflowSource(pool,input,options={}) {
 validate(input);
 const proof=await (options.readContract||readFixedContract)(input,options),d=proof.document;
 if(!/^[a-f0-9]{64}$/.test(proof.sha256||'')||!d||d.source_repo!==input.source_repo||d.workflow!==input.source_workflow
  ||(d.contract_key??d.capability)!==input.source_capability||typeof d.brain_workflow_key!=='string'||!Array.isArray(d.activities))fail('WORKFLOW_SOURCE_CONTRACT_IDENTITY_INVALID');
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  // 与正式活动同步共锁；网络读取发生在事务前，CAS保护慢读取期间的变更。
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['shared-activity-contracts']);
  const sql=`SELECT w.*,c.capability_code FROM workflows w JOIN capabilities c ON c.id=w.capability_id WHERE w.id=$1 FOR UPDATE OF w,c`;
  const rows=(await client.query(sql,[input.workflow_id])).rows,old=rows[0];
  if(rows.length!==1||old.capability_id!==input.capability_id||old.key!==d.brain_workflow_key||old.capability_code!==d.capability||old.status==='retired')fail('WORKFLOW_SOURCE_OWNER_CONFLICT');
  if(FIELDS.some(k=>old[k]!==input.expected[k])||Number(old.contract_sync_revision)!==input.expected.contract_sync_revision)fail('WORKFLOW_SOURCE_CAS_CONFLICT');
  const competing=(await client.query('SELECT id FROM workflows WHERE source_repo=$1 AND source_capability=$2 AND id<>$3 FOR UPDATE',[input.source_repo,input.source_capability,input.workflow_id])).rows;
  if(competing.some(row=>row.id!==input.workflow_id))fail('WORKFLOW_SOURCE_ALREADY_OWNED');
  await client.query(`UPDATE workflows SET source_repo=$2,source_path=$3,source_workflow=$4,source_capability=$5,
   contract_sync_revision=contract_sync_revision+1,updated_at=NOW() WHERE id=$1`,[input.workflow_id,...FIELDS.map(k=>input[k])]);
  const after=(await client.query(sql,[input.workflow_id])).rows[0];
  if(!after||after.id!==old.id||after.key!==old.key||after.capability_id!==old.capability_id||after.capability_code!==d.capability||FIELDS.some(k=>after[k]!==input[k])
   ||Number(after.contract_sync_revision)!==input.expected.contract_sync_revision+1)fail('WORKFLOW_SOURCE_READBACK_FAILED');
  await client.query('COMMIT');
  return {workflow_id:after.id,key:after.key,capability_id:after.capability_id,capability_code:after.capability_code,
   ...Object.fromEntries(FIELDS.map(k=>[k,after[k]])),contract_sync_revision:Number(after.contract_sync_revision),
   source_commit:input.revision,contract_sha256:proof.sha256,actor:input.actor,readback_verified:true};
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
