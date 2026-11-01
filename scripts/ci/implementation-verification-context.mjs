/** admission-only配置输入与同侧原生owner的联合证据；不修改来源图、业务owner或执行状态。 */
import {createHash} from 'node:crypto';
import {reverseImplementationPaths} from '../../packages/brain/src/lib/implementation-impact.js';
import {verifyVerificationInputEvidence,collectVerificationRetirementEntryEvidence} from './implementation-verification-inputs.mjs';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const sha=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const equal=(left,right)=>sha(left)===sha(right);
const fail=code=>{throw Object.assign(Error('VERIFICATION_CONTEXT_'+code),{code:'VERIFICATION_CONTEXT_'+code});};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function verificationInputOwnerPaths(evidence){return [...new Set((evidence?.rows||[]).flatMap(row=>row.eligible_owner_paths))].sort();}
function assertInputEnvelope(source,evidence,purpose){
 if(purpose!=='admission_only'||evidence?.purpose!==purpose)fail('ADMISSION_ONLY');
 const {verification_inputs_sha256,...body}=evidence||{};
 if(evidence.schema_version!==1||evidence.evidence_kind!=='derived_verification_input_candidates'||!equal(evidence.source,source)
  ||!hash(verification_inputs_sha256)||sha(body)!==verification_inputs_sha256||!Array.isArray(evidence.rows))fail('INPUT_INVALID');
}
function nativeOwners(report,source,side){
 if(!equal(report.source,source)||report.ci_context?.purpose!=='admission_only'||typeof report.registry_repo!=='string'||report.registry_repo.length>200||!/^[A-Za-z0-9_]/.test(report.registry_repo)||/[^A-Za-z0-9_./-]/.test(report.registry_repo)||report.registry_repo.split('/').some(p=>!p||p==='.'||p==='..'))fail('NATIVE_SOURCE_MISMATCH');
 const actual=report[side],rows=report.verification_owner_coverage?.[side];
 if(actual?.revision!==source[side+'_revision']||actual.mapping_status!=='verified'||actual.traversal?.truncated!==false
  ||actual.graph_snapshot?.source_revision!==actual.revision||!hash(actual.graph_snapshot.digest)||!Array.isArray(rows))fail('NATIVE_SIDE_UNKNOWN');
 const carriers=(report.affected_usages||[]).flatMap(u=>(u.evidence||[]).filter(e=>e.side===side));
 if(carriers.some(e=>e.revision!==actual.revision||e.implementation?.revision!==actual.revision||e.implementation.repo!==source.repo||e.implementation.registry_repo!==report.registry_repo))fail('NATIVE_USAGE_SOURCE_INVALID');
 const consumers=new Set(carriers.map(e=>e.implementation.path));
 const seen=new Set();
 for(const row of rows){
  if(Object.keys(row).sort().join(',')!=='graph_sha256,matched_paths,path,source_revision,truncated'||seen.has(row.path)
   ||row.source_revision!==actual.revision||row.graph_sha256!==actual.graph_snapshot.digest||row.truncated!==false
   ||!Array.isArray(row.matched_paths)||new Set(row.matched_paths).size!==row.matched_paths.length
   ||row.matched_paths.some(p=>typeof p!=='string'||!consumers.has(p)))fail('NATIVE_OWNER_INVALID');
  seen.add(row.path);
 }
 return rows;
}
export function buildVerificationInputContext({source,evidence,reports,raw_consumer_graph_facts,retirement_candidates,retirement_entry_evidence,purpose='admission_only'}){
 assertInputEnvelope(source,evidence,purpose);
 if(!Array.isArray(reports)||!reports.length||new Set(reports.map(r=>r.scope_key)).size!==reports.length)fail('REPORTS_REQUIRED');
 const owners=new Map();
 for(const report of reports)for(const side of['base','head'])owners.set(report.scope_key+':'+side,nativeOwners(report,source,side));
 const graphFacts=assertRawGraphs(source,reports,raw_consumer_graph_facts);
 const authorized=[];
 for(const row of evidence.rows){
  const input=row.input_facts,side=input?.source?.side;
  if(!['base','head'].includes(side)||input.source.revision!==source[side+'_revision']||input.role!=='verification_input'
   ||input.entry_verified!==false||input.owner_verified!==false||row.execution_status!=='not_evaluated'||row.coverage!=='unknown'
   ||!source.changed_files.some(c=>c.path===input.path)||!Array.isArray(row.eligible_owner_paths)||!row.eligible_owner_paths.length)fail('ROW_INVALID');
  const claims=[];
  for(const report of reports)for(const owner of owners.get(report.scope_key+':'+side)){
   if(!owner.matched_paths.length||!row.eligible_owner_paths.includes(owner.path))continue;
   claims.push({scope_key:report.scope_key,side,owner_path:owner.path,source_revision:owner.source_revision,graph_sha256:owner.graph_sha256,
    matched_paths:[...owner.matched_paths],source_report_sha256:sha(report)});
  }
  if(claims.length)authorized.push({path:input.path,side,input_witness_sha256:row.input_witness_sha256,owner_claims:claims});
 }
 const joint_files=[...new Set(authorized.map(r=>r.path))].filter(path=>reports.every(r=>['base','head'].every(side=>{const row=r[side].file_coverage.find(f=>f.path===path);return row&&row.matched_paths.length===0&&!row.coverage_kind;}))).sort().map(path=>({path,input_indexes:authorized.flatMap((row,i)=>row.path===path?[i]:[]),
  resolution_kind:'verification_input',execution_status:'not_evaluated',coverage:'unknown'}));
 const metadata=[];
 for(const row of evidence.metadata_candidates||[]){
  const input=row.input_facts,side=input?.source?.side,graphs=graphFacts?.scopes.map(s=>s[side]);
  if(!['documentation_change','reference_catalog_change'].includes(row.kind)||input.role!==row.kind||input.non_executable!==true||input.owner_verified!==false||input.entry_verified!==false
   ||input.source.revision!==source[side+'_revision']||!source.changed_files.some(c=>c.path===input.path))fail('METADATA_INVALID');
  if(graphs?.length&&graphFacts.scopes.every(scope=>['base','head'].every(side=>{const row=scope[side].rows.find(r=>r.path===input.path);return row&&row.truncated===false&&equal(row.reverse_paths,[input.path]);}))&&reports.every(report=>['base','head'].every(side=>{const row=report[side].file_coverage.find(r=>r.path===input.path);return row&&row.truncated===false&&row.matched_paths.length===0&&!Object.hasOwn(row,'coverage_kind')&&!Object.hasOwn(row,'native_matched_paths');})))metadata.push({path:input.path,side,kind:row.kind,metadata_witness_sha256:row.metadata_witness_sha256,raw_graph_facts_sha256_by_scope:graphFacts.scopes.map(s=>({scope_key:s.scope_key,sha256:s[side].raw_graph_facts_sha256}))});
 }
 for(const path of [...new Set(metadata.map(r=>r.path))].sort()){
  if(joint_files.some(r=>r.path===path))fail('JOINT_ROLE_CONFLICT');
  joint_files.push({path,input_indexes:[],metadata_indexes:metadata.flatMap((r,i)=>r.path===path?[i]:[]),resolution_kind:metadata.find(r=>r.path===path).kind,
   joint_kind:metadata.find(r=>r.path===path).kind,non_executable:true,execution_status:'not_evaluated',coverage:'unknown'});
 }
 const retired=authorizeRetirements(source,reports,owners,graphFacts,retirement_candidates,retirement_entry_evidence);
 for(const path of [...new Set(retired.map(r=>r.path))].sort()){
  if(joint_files.some(r=>r.path===path))fail('JOINT_ROLE_CONFLICT');
  joint_files.push({path,input_indexes:[],retirement_indexes:retired.flatMap((r,i)=>r.path===path?[i]:[]),resolution_kind:'explicit_verification_retirement',joint_kind:'explicit_verification_retirement',non_executable:true,execution_status:'not_evaluated',coverage:'unknown'});
 }
 const body={schema_version:1,purpose,evidence_kind:'derived_verification_input_context',source:structuredClone(source),input_evidence:structuredClone(evidence),
  source_reports:structuredClone(reports),authorized_inputs:authorized,authorized_non_executable_changes:metadata,authorized_retirements:retired,...(retirement_candidates?{retirement_candidates:structuredClone(retirement_candidates),retirement_entry_evidence:structuredClone(retirement_entry_evidence)}:{}),...(graphFacts?{raw_consumer_graph_facts:structuredClone(graphFacts)}:{}),joint_files,execution_status:'not_evaluated',coverage:'unknown'};
 return {...body,context_sha256:sha(body)};
}
/** 纯结构复验供联合切片重建；Git入口重读仍必须在真实断言前后执行。 */
export function assertVerificationInputContext({source,reports,context,purpose='admission_only'}){
 if(!context||context.purpose!==purpose)fail('ADMISSION_ONLY');
 const expected=buildVerificationInputContext({source,reports,evidence:context.input_evidence,raw_consumer_graph_facts:context.raw_consumer_graph_facts,retirement_candidates:context.retirement_candidates,retirement_entry_evidence:context.retirement_entry_evidence,purpose});
 if(!equal(expected,context))fail('MISMATCH');return expected;
}
export function verifyVerificationInputContext(root,{source,reports,context,purpose='admission_only'}){
 if(purpose!=='admission_only')fail('ADMISSION_ONLY');
 const expected=assertVerificationInputContext({source,reports,context,purpose});
 verifyVerificationInputEvidence(root,{source,evidence:expected.input_evidence,purpose});return expected;
}

function authorizeRetirements(source,reports,owners,graphs,proof,entries){
 if(!proof&&!entries)return[];
 const {retirement_candidates_sha256,...body}=proof||{},entryBody={...entries};delete entryBody.retirement_entry_candidates_sha256;
 if(!proof||proof.purpose!=='admission_only'||proof.kind!=='explicit_verification_retirement'||!equal(proof.source,source)||sha(body)!==retirement_candidates_sha256
  ||!entries||entries.purpose!=='admission_only'||!equal(entries.source,source)||entries.retirement_candidates_sha256!==retirement_candidates_sha256||sha(entryBody)!==entries.retirement_entry_candidates_sha256)fail('RETIREMENT_INVALID');
 const authorized=[];
 for(const retired of proof.rows){
  if(retired.change!=='D'||retired.side!=='base'||retired.head?.absent!==true||retired.head.revision!==source.head_revision||retired.base?.revision!==source.base_revision
   ||retired.requires_native_base_no_business_consumer!==true||retired.entry_verified!==false||retired.owner_verified!==false||retired.retirement_authorized!==false)fail('RETIREMENT_INVALID');
  const baseProofs=graphs?.scopes.map(s=>s.base.rows.find(r=>r.path===retired.path));
  if(!baseProofs?.length||baseProofs.some(r=>!r||r.truncated||!equal(r.reverse_paths,[retired.path])))continue;
  const native=reports.flatMap(r=>['base','head'].flatMap(side=>r[side].file_coverage.filter(f=>f.path===retired.path)));
  if(native.some(r=>r.truncated||r.matched_paths.length||r.coverage_kind))continue;
  const support=entries.rows.find(r=>r.path===retired.path);if(!support||support.replacement_entries.length!==retired.replacement_inputs.length)continue;
  const replacements=[];
  for(const input of retired.replacement_inputs){
   const entry=support.replacement_entries.find(r=>r.path===input.path)?.entry;
   if(!entry||entry.input.source.side!=='head'||entry.input.source.revision!==source.head_revision||entry.input.path!==input.path||entry.input.sha256!==input.sha256
    ||entry.input.git_blob_sha1!==input.git_blob_sha1||entry.witness.config?.sha256!==input.config.sha256||entry.witness.kind!=='vitest_config_input')continue;
   const claims=[];
   for(const report of reports)for(const owner of owners.get(report.scope_key+':head'))if(owner.matched_paths.length&&entry.eligible_owner_paths.includes(owner.path))claims.push({scope_key:report.scope_key,side:'head',owner_path:owner.path,source_revision:owner.source_revision,graph_sha256:owner.graph_sha256,matched_paths:[...owner.matched_paths],source_report_sha256:sha(report)});
   if(claims.length)replacements.push({path:input.path,entry_support_sha256:entry.entry_support_sha256,owner_claims:claims});
  }
  if(replacements.length===retired.replacement_inputs.length)authorized.push({path:retired.path,kind:'explicit_verification_retirement',catalog:retired.catalog,replacements,
   retired_execution_status:'not_evaluated',coverage:'unknown',limitations:retired.catalog_limitations});
 }
 return authorized;
}
function assertRawGraphs(source,reports,proof){
 if(proof===undefined)return null;
 if(!proof||Object.keys(proof).join(',')!=='scopes'||!Array.isArray(proof.scopes)||proof.scopes.length!==reports.length
  ||!equal(proof.scopes.map(s=>s.scope_key),reports.map(r=>r.scope_key)))fail('RAW_GRAPH_INVALID');
 for(const scope of proof.scopes){
  const report=reports.find(r=>r.scope_key===scope.scope_key);if(scope.registry_repo!==report.registry_repo)fail('RAW_GRAPH_INVALID');
  for(const side of['base','head']){
   const {raw_graph_facts_sha256,...body}=scope[side]||{};
   if(sha(body)!==raw_graph_facts_sha256||body.schema_version!==1||body.purpose!=='admission_only'||body.repo!==source.repo||body.registry_repo!==scope.registry_repo||body.side!==side||body.source_revision!==source[side+'_revision']
    ||!Number.isInteger(body.graph_snapshot_row_count)||body.graph_snapshot_row_count<0||!Array.isArray(body.rows)
    ||body.rows.some(r=>!source.changed_files.some(c=>c.path===r.path)||r.truncated!==false||!Array.isArray(r.reverse_paths)||!r.reverse_paths.includes(r.path))
    ||report[side].graph_snapshot.digest!==body.graph_snapshot_digest||Number(report[side].graph_snapshot.row_count)!==body.graph_snapshot_row_count)fail('RAW_GRAPH_INVALID');
  }
 }
 return proof;
}
/** 完整快照只在scratch内读取；证据只携delta反向闭包，不复制整仓scope payload。 */
export function buildVerificationConsumerGraphFacts({source,side,graphSnapshot,edges,paths,registryRepo=source?.repo,purpose='admission_only'}){
 if(purpose!=='admission_only')fail('ADMISSION_ONLY');
 if(source?.repo!=='perfectuser21/cecelia'||!['base','head'].includes(side)||graphSnapshot?.repo!==registryRepo
  ||graphSnapshot.source_revision!==source[side+'_revision']||!Array.isArray(edges)||edges.length>200000||Number(graphSnapshot.row_count)!==edges.length
  ||!Array.isArray(paths)||new Set(paths).size!==paths.length||paths.some(path=>!source.changed_files.some(c=>c.path===path)))fail('RAW_GRAPH_INVALID');
 const rows=[...paths].sort().map(path=>{const proof=reverseImplementationPaths(edges,[path]);return {path,reverse_paths:proof.paths,truncated:proof.truncated};});
 const body={schema_version:1,purpose,repo:source.repo,registry_repo:registryRepo,side,source_revision:source[side+'_revision'],graph_snapshot_row_count:edges.length,
  graph_snapshot_digest:createHash('sha256').update(JSON.stringify(edges)).digest('hex'),rows};
 return {...body,raw_graph_facts_sha256:sha(body)};
}
export async function readVerificationConsumerGraphFacts(db,{source,paths,reports}){
 const identity=(await db.query('SELECT current_database() AS database,current_schema() AS schema')).rows[0];
 if(identity?.database!=='cecelia_scratch'||!/^ci_admission_[a-f0-9]{32}$/.test(identity.schema||''))fail('SCRATCH_REQUIRED');
 if(!Array.isArray(reports)||!reports.length||reports.some(r=>!equal(r.source,source)))fail('RAW_GRAPH_SOURCE_MISMATCH');
 const scopes=[];
 for(const report of reports){
  const registryRepo=report.registry_repo;if(typeof registryRepo!=='string'||!registryRepo)fail('RAW_GRAPH_SOURCE_MISMATCH');
  const scope={scope_key:report.scope_key,registry_repo:registryRepo};
  for(const side of['base','head']){
   const revision=source[side+'_revision'];
   const graphSnapshot=(await db.query('SELECT * FROM graph_snapshot_versions WHERE repo=$1 AND source_revision=$2',[registryRepo,revision])).rows[0];
   const edges=(await db.query('SELECT src_path,dst_path,edge_type,detail FROM graph_edge_snapshots WHERE repo=$1 AND source_revision=$2 ORDER BY src_path,dst_path,edge_type',[registryRepo,revision])).rows;
   scope[side]=buildVerificationConsumerGraphFacts({source,side,registryRepo,graphSnapshot,edges,paths});
  }
  scopes.push(scope);
 }
 return assertRawGraphs(source,reports,{scopes});
}
export async function verifyVerificationConsumerGraphFacts(db,{source,proof,reports}){
 assertRawGraphs(source,reports,proof);
 const paths=proof.scopes[0].base.rows.map(r=>r.path);
 if(proof.scopes.some(s=>['base','head'].some(side=>!equal(s[side].rows.map(r=>r.path),paths))))fail('RAW_GRAPH_INVALID');
 const actual=await readVerificationConsumerGraphFacts(db,{source,paths,reports});
 if(!equal(actual,proof))fail('RAW_GRAPH_CHANGED');return actual;
}

/** 真正使用退休/反证时，必须在同一opaque adapter租约内重读control Git与raw graph。 */
export async function verifyVerificationInputContextAuthority(root,{source,context,reports,db,toolingRoot,toolingRevision}){
 verifyVerificationInputContext(root,{source,reports,context});
 if(context.retirement_candidates){
  if(!toolingRoot||toolingRevision!==context.retirement_candidates.control.revision)fail('RETIREMENT_CONTROL_REQUIRED');
  const {verifyVerificationRetirementCandidates}=await import('./implementation-verification-retirements.mjs');
  verifyVerificationRetirementCandidates(root,{source,proof:context.retirement_candidates,toolingRoot,toolingRevision,purpose:'admission_only'});
  const actual=collectVerificationRetirementEntryEvidence(root,{source,proof:context.retirement_candidates});
  if(!equal(actual,context.retirement_entry_evidence))fail('RETIREMENT_ENTRY_CHANGED');
 }
 if(context.raw_consumer_graph_facts){if(!db)fail('SCRATCH_REQUIRED');await verifyVerificationConsumerGraphFacts(db,{source,proof:context.raw_consumer_graph_facts,reports});}
 return context;
}
