/** 固定Git辅助来源证据；不写依赖图、不执行声明、不创建业务归属。 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { canonicalRepoIdentity } from '../../packages/brain/src/lib/gp-assertion-command.js';
export const SOURCE_RELATIONS_PATH='.implementation-source-relations.json';
const hash=/^[0-9a-f]{64}$/,revision=/^[0-9a-f]{40}$/;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const bytesHash=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
function path(value){
 if(typeof value!=='string'||!value||!/^[-A-Za-z0-9_./@+]+$/.test(value)||value.startsWith('/')||value.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('-')))fail('AUXILIARY_PATH_INVALID');
 return value;
}
function ownerPath(value){path(value);if(!/\.(?:[cm]?[jt]sx?|py|sh)$/.test(value)||/\.(?:test|spec)\./.test(value)||/(?:^|\/)(?:tests|__tests__)\//.test(value))fail('AUXILIARY_OWNER_INVALID');return value;}
function relation(row){
 if(!row||Array.isArray(row)||Object.keys(row).sort().join(',')!=='owner_path,path,role')fail('AUXILIARY_RELATION_INVALID');
 ownerPath(row.owner_path);path(row.path);if(row.path===row.owner_path)fail('AUXILIARY_DIRECTION_INVALID');
 const valid=row.role==='documentation'?/\.md$/.test(row.path):row.role==='release'?/^changes\/(?!README\.md$)[^/]+\.md$/.test(row.path):row.role==='verification'?/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(row.path)||/\/smoke\/[^/]+\.sh$/.test(row.path)||['packages/quality/smoke-allowlist.txt','test-registry.yaml'].includes(row.path):false;
 if(!valid)fail('AUXILIARY_ROLE_INVALID');return row;
}
const git=(root,...args)=>execFileSync('git',args,{cwd:root,maxBuffer:16*1024*1024});
function readCommitted(root,rev,name){
 path(name);const entry=git(root,'ls-tree','-z',rev,'--',name).toString();
 if(!entry)return null;
 const match=/^(100644|100755) blob [0-9a-f]+\t([^\0]+)\0$/.exec(entry);
 if(!match||match[2]!==name)fail('AUXILIARY_SOURCE_NOT_REGULAR_FILE');
 return git(root,'show',`${rev}:${name}`);
}
function sourceValid(source){
 if(!source||!/^[-\w.]+\/[-\w.]+$/.test(source.repo)||!revision.test(source.base_revision)||!revision.test(source.head_revision))fail('AUXILIARY_SOURCE_INVALID');
}
export function collectAuxiliarySourceEvidence(root,source){
 sourceValid(source);
 if(canonicalRepoIdentity(git(root,'remote','get-url','origin').toString().trim()).replace(/^github\.com\//,'')!==source.repo)fail('AUXILIARY_REPO_MISMATCH');
 const body={schema_version:1,source:{repo:source.repo,base_revision:source.base_revision,head_revision:source.head_revision}};
 for(const side of ['base','head']){
  const rev=source[`${side}_revision`],bytes=readCommitted(root,rev,SOURCE_RELATIONS_PATH);
  const frozen={source_revision:rev,manifest_sha256:bytes?bytesHash(bytes):null,relations:[]};
  if(bytes){
   if(bytes.length>1024*1024)fail('AUXILIARY_MANIFEST_TOO_LARGE');
   let manifest;try{manifest=JSON.parse(bytes);}catch{fail('AUXILIARY_MANIFEST_INVALID');}
   if(!manifest||Object.keys(manifest).sort().join(',')!=='relations,repo,schema_version'||manifest.schema_version!==1||manifest.repo!==source.repo||!Array.isArray(manifest.relations)||manifest.relations.length>1024)fail('AUXILIARY_MANIFEST_INVALID');
   const seen=new Set();
   for(const raw of manifest.relations){
    const row=relation(raw);if(seen.has(row.path))fail('AUXILIARY_RELATION_DUPLICATE');seen.add(row.path);
    const owner=readCommitted(root,rev,row.owner_path),auxiliary=readCommitted(root,rev,row.path);
    if(!owner||!auxiliary)fail('AUXILIARY_SOURCE_MISSING');
    frozen.relations.push({...row,owner_sha256:bytesHash(owner),sha256:bytesHash(auxiliary)});
   }
   frozen.relations.sort((a,b)=>a.path.localeCompare(b.path));
  }
  body[side]=frozen;
 }
 if(!body.base.manifest_sha256&&!body.head.manifest_sha256)return null;
 return {...body,evidence_sha256:digest(body)};
}
function frozenBody(evidence){return {schema_version:evidence.schema_version,source:evidence.source,base:evidence.base,head:evidence.head};}
function validateFrozen(evidence,source){
 sourceValid(source);
 if(!evidence||evidence.schema_version!==1||JSON.stringify(canonical(evidence.source))!==JSON.stringify(canonical({repo:source.repo,base_revision:source.base_revision,head_revision:source.head_revision}))||!hash.test(evidence.evidence_sha256)||digest(frozenBody(evidence))!==evidence.evidence_sha256)fail('AUXILIARY_EVIDENCE_INVALID');
 for(const side of ['base','head']){
  const f=evidence[side];if(f?.source_revision!==source[`${side}_revision`]||!(f.manifest_sha256===null||hash.test(f.manifest_sha256))||!Array.isArray(f.relations)||f.relations.length>1024||!f.manifest_sha256&&f.relations.length)fail('AUXILIARY_EVIDENCE_INVALID');
  const seen=new Set();for(const row of f.relations){
   relation({owner_path:row.owner_path,path:row.path,role:row.role});
   if(Object.keys(row).sort().join(',')!=='owner_path,owner_sha256,path,role,sha256'||seen.has(row.path)||!hash.test(row.owner_sha256)||!hash.test(row.sha256))fail('AUXILIARY_EVIDENCE_INVALID');seen.add(row.path);
  }
 }
}
export function auxiliaryOwnerPaths(evidence){return evidence?[...new Set(['base','head'].flatMap(side=>evidence[side].relations.map(r=>r.owner_path)))].sort():[];}
function claimedOwners(report,evidence,side){
 const rows=evidence.owner_coverage?.[side];if(!Array.isArray(rows))fail('AUXILIARY_OWNER_EVIDENCE_MISSING');
 const consumers=new Set(report.affected_usages.flatMap(u=>(u.evidence||[]).filter(e=>e.side===side).map(e=>e.implementation?.path)));
 const owners=new Map();
 for(const row of rows){
  ownerPath(row.path);
  if(owners.has(row.path)||row.source_revision!==report[side].revision||row.graph_sha256!==report[side].graph_snapshot.digest||row.truncated!==false||!Array.isArray(row.matched_paths)||row.matched_paths.some(p=>!consumers.has(p)))fail('AUXILIARY_OWNER_EVIDENCE_INVALID');
  owners.set(row.path,row.matched_paths);
 }
 return owners;
}
function expectedCoverage(evidence,owners,side,name){
 const rows=evidence[side].relations;
 if(name===SOURCE_RELATIONS_PATH){
  if(!rows.length||rows.some(r=>!owners.get(r.owner_path)?.length))return null;
  return {owners:[...new Set(rows.map(r=>r.owner_path))].sort(),matched:[...new Set(rows.flatMap(r=>owners.get(r.owner_path)))].sort(),role:'verification',sha256:evidence[side].manifest_sha256};
 }
 const row=rows.find(r=>r.path===name);if(!row||!owners.get(row.owner_path)?.length)return null;
 return {owners:[row.owner_path],matched:[...new Set(owners.get(row.owner_path))].sort(),role:row.role,sha256:row.sha256};
}
export function assertAuxiliarySourceEvidence(report){
 const e=report.auxiliary_source_evidence;
 if(!e){if(['base','head'].some(s=>report[s]?.file_coverage?.some(f=>f.coverage_kind==='auxiliary_source')))fail('AUXILIARY_EVIDENCE_MISSING');return true;}
 validateFrozen(e,report.source);
 if(e.proof_sha256!==digest({evidence_sha256:e.evidence_sha256,owner_coverage:e.owner_coverage}))fail('AUXILIARY_OWNER_EVIDENCE_INVALID');
 for(const side of ['base','head']){
  const owners=claimedOwners(report,e,side);
  for(const row of e[side].relations)if(!owners.get(row.owner_path)?.length&&!(report.mapping_status==='unknown'&&report.gaps.some(g=>g.code==='auxiliary_owner_unclaimed'&&g.side===side&&g.path===row.owner_path)))fail('AUXILIARY_OWNER_UNCLAIMED');
  for(const f of report[side].file_coverage.filter(f=>f.coverage_kind==='auxiliary_source')){
   const expected=expectedCoverage(e,owners,side,f.path);
   if(!expected||!Array.isArray(f.native_matched_paths)||f.native_matched_paths.length||f.truncated!==false||f.auxiliary_role!==expected.role||f.auxiliary_sha256!==expected.sha256||JSON.stringify(f.auxiliary_owners)!==JSON.stringify(expected.owners)||JSON.stringify(f.matched_paths)!==JSON.stringify(expected.matched))fail('AUXILIARY_COVERAGE_INVALID');
  }
 }
 return true;
}
export function applyAuxiliarySourceEvidence(report,evidence,ownerCoverage){
 if(!evidence)return report;
 validateFrozen(evidence,report.source);
 const proof={...evidence,owner_coverage:{}};
 for(const side of ['base','head'])proof.owner_coverage[side]=(ownerCoverage[side]||[]).map(r=>({...r,source_revision:report[side].revision,graph_sha256:report[side].graph_snapshot.digest}));
 proof.proof_sha256=digest({evidence_sha256:proof.evidence_sha256,owner_coverage:proof.owner_coverage});
 report.auxiliary_source_evidence=proof;
 for(const side of ['base','head']){
  const owners=claimedOwners(report,proof,side);
  for(const row of proof[side].relations)if(!owners.get(row.owner_path)?.length&&!report.gaps.some(g=>g.code==='auxiliary_owner_unclaimed'&&g.side===side&&g.path===row.owner_path))report.gaps.push({code:'auxiliary_owner_unclaimed',side,path:row.owner_path});
  for(const f of report[side].file_coverage){
   if(f.matched_paths.length||f.coverage_kind==='governance')continue;
   const expected=expectedCoverage(proof,owners,side,f.path);if(!expected)continue;
   // matched_paths 是实际owner查询得出的消费者；明确标辅助覆盖，原生图结果另留原值。
   f.native_matched_paths=f.matched_paths;f.matched_paths=expected.matched;f.coverage_kind='auxiliary_source';
   f.auxiliary_owners=expected.owners;f.auxiliary_role=expected.role;f.auxiliary_sha256=expected.sha256;
  }
 }
 const claimed=new Set(report.source.changed_files.filter((_,i)=>['base','head'].some(s=>report[s].file_coverage[i].coverage_kind==='auxiliary_source')).map(f=>f.path));
 report.unclaimed_paths=report.unclaimed_paths.filter(f=>!claimed.has(f.path));
 report.gaps=report.gaps.filter(g=>g.code!=='changed_file_unclaimed'||!claimed.has(g.path));
 report.mapping_status=report.gaps.length?'unknown':'verified';
 assertAuxiliarySourceEvidence(report);return report;
}
