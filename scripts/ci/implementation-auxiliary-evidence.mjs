/** 固定Git辅助来源证据；不写依赖图、不执行声明、不创建业务归属。 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { canonicalRepoIdentity } from '../../packages/brain/src/lib/gp-assertion-command.js';
export const SOURCE_RELATIONS_PATH='.implementation-source-relations.json';
const CONFIG_READER='.github/workflows/scripts/__tests__/nightly-runtime.test.mjs',CONFIG_CI='.github/workflows/ci.yml',CONFIG_INPUTS=[CONFIG_CI,'.github/workflows/nightly-regression.yml'];
const brainRequire=createRequire(new URL('../../packages/brain/package.json',import.meta.url));
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
 const config=row?.role==='verification_config';
 const keys=config?'ci_path,consumer_path,owner_path,path,role':'owner_path,path,role';
 if(!row||Array.isArray(row)||Object.keys(row).sort().join(',')!==keys)fail('AUXILIARY_RELATION_INVALID');
 if(config){if(row.owner_path!==CONFIG_READER)fail('AUXILIARY_CONFIG_OWNER_INVALID');}else ownerPath(row.owner_path);
 path(row.path);if(row.path===row.owner_path)fail('AUXILIARY_DIRECTION_INVALID');
 if(config){
  if(!CONFIG_INPUTS.includes(row.path)||row.consumer_path!==CONFIG_READER||row.ci_path!==CONFIG_CI)fail('AUXILIARY_CONFIG_SCOPE_INVALID');
  return row;
 }
 const valid=row.role==='documentation'?/\.md$/.test(row.path):row.role==='release'?/^changes\/(?!README\.md$)[^/]+\.md$/.test(row.path):row.role==='verification'?/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(row.path)||/\/smoke\/[^/]+\.sh$/.test(row.path)||['packages/quality/smoke-allowlist.txt','test-registry.yaml'].includes(row.path):false;
 if(!valid)fail('AUXILIARY_ROLE_INVALID');return row;
}
const rawRelation=row=>({owner_path:row.owner_path,path:row.path,role:row.role,...(row.role==='verification_config'?{consumer_path:row.consumer_path,ci_path:row.ci_path}:{})});
function configProof(reader,ci,input,row){
 const {Linter}=brainRequire('eslint'),yaml=brainRequire('js-yaml');
 const linter=new Linter();
 const errors=linter.verify(reader.toString(),[{languageOptions:{ecmaVersion:'latest',sourceType:'module'}}]);
 const code=linter.getSourceCode();if(errors.some(e=>e.fatal)||!code)fail('AUXILIARY_CONFIG_READER_INVALID');
 const references=new Map(code.scopeManager.scopes.flatMap(s=>s.references).map(r=>[r.identifier,r.resolved]));
 const imported=(node,source,name)=>{
  if(node?.type!=='Identifier')return false;
  const defs=references.get(node)?.defs;
  return defs?.length===1&&defs[0].type==='ImportBinding'&&defs[0].parent.source.value===source&&
   (name==='default'?defs[0].node.type==='ImportDefaultSpecifier':defs[0].node.type==='ImportSpecifier'&&defs[0].node.imported.name===name);
 };
 const lit=(node,value)=>node?.type==='Literal'&&node.value===value;
 const member=(node,name)=>node?.type==='MemberExpression'&&!node.computed&&!node.optional&&node.property.name===name;
 const call=(node)=>node?.type==='CallExpression'&&!node.optional;
 const metaUrl=node=>member(node,'url')&&node.object.type==='MetaProperty'&&node.object.meta.name==='import'&&node.object.property.name==='meta';
 const root=node=>{
  if(node?.type!=='Identifier')return false;
  const defs=references.get(node)?.defs,def=defs?.[0],init=def?.node?.init;
  return defs?.length===1&&def.type==='Variable'&&def.parent.kind==='const'&&
   call(init)&&imported(init.callee,'node:url','fileURLToPath')&&init.arguments.length===1&&
   init.arguments[0].type==='NewExpression'&&init.arguments[0].callee.name==='URL'&&!references.get(init.arguments[0].callee)?.defs?.length&&
   init.arguments[0].arguments.length===2&&lit(init.arguments[0].arguments[0],'../../../../')&&metaUrl(init.arguments[0].arguments[1]);
 };
 const joined=(node,value)=>call(node)&&imported(node.callee,'node:path','join')&&node.arguments.length===2&&root(node.arguments[0])&&lit(node.arguments[1],value);
 const parents=new Map(),nodes=[];
 const walk=(node,parent)=>{
  if(!node||typeof node!=='object'||typeof node.type!=='string')return;
  parents.set(node,parent);nodes.push(node);
  for(const [key,value] of Object.entries(node)){
   if(['parent','tokens','comments'].includes(key))continue;
   if(Array.isArray(value))for(const child of value)walk(child,node);else if(value?.type)walk(value,node);
  }
 };
 walk(code.ast,null);
 for(const [node] of references){
  if(!imported(node,'js-yaml','default'))continue;
  const access=parents.get(node),caller=parents.get(access);
  if(!member(access,'load')||!call(caller)||caller.callee!==access)fail('AUXILIARY_CONFIG_BINDING_MUTATED');
 }
 // 接受真实模块初始化或直接注册的node:test回调；独立未调用函数和条件死分支不能作消费证据。
 const active=node=>{
  for(let child=node,parent=parents.get(node);parent;child=parent,parent=parents.get(parent)){
   if(['IfStatement','ConditionalExpression','LogicalExpression','WhileStatement','ForStatement','ForOfStatement','ForInStatement','SwitchStatement','TryStatement'].includes(parent.type))return false;
   if(['BlockStatement','Program'].includes(parent.type)){
    const index=parent.body.indexOf(child);
    if(index>=0&&parent.body.slice(0,index).some(statement=>['ReturnStatement','ThrowStatement'].includes(statement.type)))return false;
   }
   if(['FunctionExpression','ArrowFunctionExpression','FunctionDeclaration'].includes(parent.type)){
    const caller=parents.get(parent);
    if(!call(caller)||!imported(caller.callee,'node:test','test')||!caller.arguments.includes(parent))return false;
   }
  }
  return true;
 };
 const read=nodes.find(node=>call(node)&&member(node.callee,'load')&&imported(node.callee.object,'js-yaml','default')&&node.arguments.length===1&&
  call(node.arguments[0])&&imported(node.arguments[0].callee,'node:fs','readFileSync')&&node.arguments[0].arguments.length===2&&
  joined(node.arguments[0].arguments[0],row.path)&&lit(node.arguments[0].arguments[1],'utf8')&&active(node));
 if(!read)fail('AUXILIARY_CONFIG_READ_UNPROVEN');
 let workflow,parsedInput;try{workflow=yaml.load(ci.toString(),{schema:yaml.JSON_SCHEMA});parsedInput=yaml.load(input.toString(),{schema:yaml.JSON_SCHEMA});}catch{fail('AUXILIARY_CONFIG_CI_INVALID');}
 if(!parsedInput||typeof parsedInput!=='object'||Array.isArray(parsedInput)||!parsedInput.jobs||typeof parsedInput.jobs!=='object'||!Object.keys(parsedInput.jobs).length)fail('AUXILIARY_CONFIG_INPUT_INVALID');
 const job=workflow?.jobs?.['lint-auto-merge-decision'],aggregate=workflow?.jobs?.['ci-passed'];
 const step=job?.steps?.find(step=>step.run?.trim()===`node --test ${CONFIG_READER}`);
 const needs=Array.isArray(aggregate?.needs)?aggregate.needs:[aggregate?.needs];
 const aggregateRun=aggregate?.steps?.map(step=>step.run||'').join('\n')||'';
 const actualCheck='check "lint-auto-merge-decision" "'+'${{ needs.lint-auto-merge-decision.result }}"';
 if(!job||job.if!=null||job['continue-on-error']||!step||step.if!=null||step['continue-on-error']||
  !needs.includes('lint-auto-merge-decision')||!aggregateRun.split('\n').some(line=>line.trim()===actualCheck)||
  !workflow.on||!(Array.isArray(workflow.on)?workflow.on.includes('pull_request'):Object.hasOwn(workflow.on,'pull_request')))fail('AUXILIARY_CONFIG_CI_UNPROVEN');
 return {read_kind:'yaml.load/readFileSync',read_range:read.range,owner_kind:'claimed-reader',owner_range:[0,reader.length],ci_job:'lint-auto-merge-decision',aggregate_job:'ci-passed'};
}
function validateConfigEvidence(row){
 const proof=row.consumer_evidence;
 if(!hash.test(row.consumer_sha256)||!hash.test(row.ci_sha256)||!proof||
  Object.keys(proof).sort().join(',')!=='aggregate_job,ci_job,owner_kind,owner_range,read_kind,read_range'||
  proof.read_kind!=='yaml.load/readFileSync'||proof.owner_kind!=='claimed-reader'||proof.ci_job!=='lint-auto-merge-decision'||proof.aggregate_job!=='ci-passed'||
  [proof.read_range,proof.owner_range].some(range=>!Array.isArray(range)||range.length!==2||range.some(v=>!Number.isSafeInteger(v)||v<0)||range[1]<=range[0]))fail('AUXILIARY_CONFIG_EVIDENCE_INVALID');
}
/** 版本机器人只移除实际消费的release行，保留其他声明原始字节。 */
export function removeConsumedReleaseRelations(text, consumedPaths) {
 if(Buffer.byteLength(text)>1024*1024)fail('AUXILIARY_MANIFEST_TOO_LARGE');
 let manifest;try{manifest=JSON.parse(text);}catch{fail('AUXILIARY_MANIFEST_INVALID');}
 if(!manifest||Object.keys(manifest).sort().join(',')!=='relations,repo,schema_version'||manifest.schema_version!==1||!/^[-\w.]+\/[-\w.]+$/.test(manifest.repo)||!Array.isArray(manifest.relations)||manifest.relations.length>1024)fail('AUXILIARY_MANIFEST_INVALID');
 const seen=new Set();for(const row of manifest.relations){relation(row);if(row.role==='verification_config'&&manifest.repo!=='perfectuser21/cecelia')fail('AUXILIARY_CONFIG_REPO_INVALID');if(seen.has(row.path))fail('AUXILIARY_RELATION_DUPLICATE');seen.add(row.path);}
 // JSON已经解析成功；额外记录token位置以精确删除数组行及相邻逗号，不重排其余对象。
 const tokens=[...text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:]+/g)];let index=0;
 function node(){
  const first=tokens[index++],out={start:first.index,end:first.index+first[0].length};
  if(first[0]==='{'){
   out.properties=new Map();
   while(tokens[index][0]!=='}'){
    const key=JSON.parse(tokens[index++][0]);index++;
    if(out.properties.has(key))fail('AUXILIARY_MANIFEST_INVALID');
    out.properties.set(key,node());if(tokens[index][0]===',')index++;
   }
   const last=tokens[index++];out.end=last.index+1;
  }else if(first[0]==='['){
   out.children=[];out.commas=[];
   while(tokens[index][0]!==']'){
    out.children.push(node());if(tokens[index][0]===',')out.commas.push(tokens[index++].index);
   }
   const last=tokens[index++];out.end=last.index+1;
  }
  return out;
 }
 const array=node().properties.get('relations'),consumed=new Set(consumedPaths),ranges=[];
 const selected=manifest.relations.map(row=>row.role==='release'&&consumed.has(row.path));
 for(let start=0;start<selected.length;start++){
  if(!selected[start])continue;let end=start;while(selected[end+1])end++;
  if(end<selected.length-1)ranges.push([array.children[start].start,array.commas[end]+1]);
  else if(start>0)ranges.push([array.commas[start-1],array.children[end].end]);
  else ranges.push([array.children[start].start,array.children[end].end]);
  start=end;
 }
 let result=text;for(const [start,end] of ranges.reverse())result=result.slice(0,start)+result.slice(end);
 return result;
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
    const row=relation(raw);if(row.role==='verification_config'&&source.repo!=='perfectuser21/cecelia')fail('AUXILIARY_CONFIG_REPO_INVALID');if(seen.has(row.path))fail('AUXILIARY_RELATION_DUPLICATE');seen.add(row.path);
    const owner=readCommitted(root,rev,row.owner_path),auxiliary=readCommitted(root,rev,row.path);
    if(!owner||!auxiliary)fail('AUXILIARY_SOURCE_MISSING');
    let config={};
    if(row.role==='verification_config'){
     if(row.owner_path!==CONFIG_READER&&!manifest.relations.some(r=>r.role==='verification'&&r.path===row.consumer_path&&r.owner_path===row.owner_path))fail('AUXILIARY_CONFIG_READER_OWNER_MISSING');
     const reader=readCommitted(root,rev,row.consumer_path),ci=readCommitted(root,rev,row.ci_path);if(!reader||!ci)fail('AUXILIARY_CONFIG_SOURCE_MISSING');
     config={consumer_sha256:bytesHash(reader),ci_sha256:bytesHash(ci),consumer_evidence:configProof(reader,ci,auxiliary,row)};
    }
    frozen.relations.push({...row,owner_sha256:bytesHash(owner),sha256:bytesHash(auxiliary),...config});
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
   relation(rawRelation(row));
   const keys=row.role==='verification_config'?'ci_path,ci_sha256,consumer_evidence,consumer_path,consumer_sha256,owner_path,owner_sha256,path,role,sha256':'owner_path,owner_sha256,path,role,sha256';
   if(row.role==='verification_config'){if(source.repo!=='perfectuser21/cecelia')fail('AUXILIARY_CONFIG_REPO_INVALID');validateConfigEvidence(row);}
   if(Object.keys(row).sort().join(',')!==keys||seen.has(row.path)||!hash.test(row.owner_sha256)||!hash.test(row.sha256))fail('AUXILIARY_EVIDENCE_INVALID');seen.add(row.path);
  }
 }
}
export function auxiliaryOwnerPaths(evidence){return evidence?[...new Set(['base','head'].flatMap(side=>evidence[side].relations.map(r=>r.owner_path)))].sort():[];}
function claimedOwners(report,evidence,side){
 const rows=evidence.owner_coverage?.[side];if(!Array.isArray(rows))fail('AUXILIARY_OWNER_EVIDENCE_MISSING');
 const consumers=new Set(report.affected_usages.flatMap(u=>(u.evidence||[]).filter(e=>e.side===side).map(e=>e.implementation?.path)));
 const owners=new Map();
 for(const row of rows){
  if(!(row.path===CONFIG_READER&&evidence[side].relations.some(r=>r.role==='verification_config'&&r.owner_path===row.path)))ownerPath(row.path);
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
