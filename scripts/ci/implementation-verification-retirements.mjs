/** 显式旧测试退休候选；默认选中例外只准coding-passway，不授予执行、覆盖或原生owner资格。 */
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {posix} from 'node:path';
import {fixedLocalGit,readFixedLocalGitBlob} from './fixed-local-git.mjs';
import {selectVitestVerificationInput} from './implementation-verification-selectors.mjs';
const REPO='perfectuser21/cecelia',BASE='68b996a5641b69e6f21705a114a4524e407fe097';
const CATALOG='config/verification-retirements/alertness-v1.json';
const CATALOG_SHA256='f9c3f170764dc41dbd4f710e5082551880c47f008bc7a9ca3cbc91eba2e5c73c';
const CATALOGS=[{path:'config/verification-retirements/brain-debt-retired-layers-v1.json',sha256:'0019e5aaabb1dce7c39c3cced54fade5521c40e5e29f01b15a47578d8ace83b5',records:8,inputs:10,support_inputs:5,base_revision:'fadbf32852cdb30f71e34dda9ab81b521bda484b',nativePaths:["packages/brain/src/__tests__/coding-passway.test.js"],onlyPaths:["packages/brain/src/__tests__/coding-passway.test.js", "tests/regression/relay-1b1f1ffa/preview-destroyer.test.js", "packages/brain/src/__tests__/planner-initiative-plan.test.js", "packages/brain/src/__tests__/actions-initiative-orchestration.test.js", "packages/brain/src/__tests__/tasks-status.test.js", "tests/regression/relay-1b1f1ffa/capacity-gate.test.js", "tests/regression/relay-57e25e92/headed-smoke-contract.test.ts", "tests/regression/relay-07b2fd3b/captures-api.test.ts"]},
 {path:CATALOG,sha256:CATALOG_SHA256,records:5,inputs:11},
 {path:'config/verification-retirements/legacy-five-v1.json',sha256:'1392c3febd9131416ec8c960a7a5a0ff6553b496084efeee1db6e1c236f25717',records:5,inputs:4},
 {path:'config/verification-retirements/tick-copied-sql-v1.json',sha256:'b6971fcfb043bdb849708e964c7e6eae31f989b1134358187ab7ecdc45350204',records:2,inputs:2,
  onlyPaths:['packages/brain/src/__tests__/tick-dispatch-scope-decomposing.test.js','packages/brain/src/__tests__/tick-kr-decomp.test.js']}];
export const CLOSED_COMPONENT_CATALOG=Object.freeze({path:'config/verification-retirements/closed-components-v1.json',
 sha256:'5b43e42d84aa1b03580b030924cf5b46e0b833f55a8735b86bd185a0bffedc99'});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'
 ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const digest=x=>sha(JSON.stringify(canonical(x)));
const fail=code=>{throw Object.assign(Error('VERIFICATION_RETIREMENT_'+code),{code:'VERIFICATION_RETIREMENT_'+code});};
const need=(condition,code)=>{if(!condition)fail(code);};
const safePath=path=>typeof path==='string'&&path&&!path.startsWith('/')&&!/[\\\0]/.test(path)
 &&!path.split('/').some(part=>!part||part==='.'||part==='..');
const git=(root,...args)=>fixedLocalGit(root,args,{encoding:'utf8'}).trim();
function checkState(root,revision){
 need(/^[a-f0-9]{40}$/.test(revision||''),'SOURCE_INVALID');
 need(git(root,'rev-parse','HEAD')===revision&&!git(root,'status','--porcelain=v1','--untracked-files=no'),'STATE_MISMATCH');
 need(['https://github.com/perfectuser21/cecelia.git','https://github.com/perfectuser21/cecelia','git@github.com:perfectuser21/cecelia.git'].includes(git(root,'remote','get-url','origin')),'REPO_MISMATCH');
}
function sourceProof(root,source){
 need(source&&Object.keys(source).sort().join(',')==='base_revision,changed_files,head_revision,repo'
  &&source.repo===REPO&&/^[a-f0-9]{40}$/.test(source.base_revision||''),'BASE_SOURCE_INVALID');
 need(Array.isArray(source.changed_files)&&source.changed_files.length&&source.changed_files.every(c=>c&&Object.keys(c).join(',')==='path'&&safePath(c.path)),'SOURCE_PATH_INVALID');
 checkState(root,source.head_revision);
 try{git(root,'merge-base','--is-ancestor',BASE,source.base_revision);}catch{fail('BASE_ANCESTRY_MISMATCH');}
 try{git(root,'merge-base','--is-ancestor',source.base_revision,source.head_revision);}catch{fail('ANCESTRY_MISMATCH');}
 const actual=fixedLocalGit(root,['diff','--no-renames','--name-only','-z',source.base_revision,source.head_revision,'--'],{encoding:'utf8'}).split('\0').filter(Boolean).sort();
 const supplied=source.changed_files.map(c=>c.path).sort();
 need(new Set(supplied).size===supplied.length&&JSON.stringify(supplied)===JSON.stringify(actual),'DELTA_MISMATCH');
 const tokens=fixedLocalGit(root,['diff','--find-renames=50%','--name-status','-z',source.base_revision,source.head_revision,'--'],{encoding:'utf8'}).split('\0').filter(Boolean),changes=new Map();
 for(let i=0;i<tokens.length;){const status=tokens[i++],path=tokens[i++];need(path&&safePath(path),'DELTA_INVALID');changes.set(path,status);if(/^[RC]/.test(status)){const target=tokens[i++];need(target&&safePath(target),'DELTA_INVALID');changes.set(target,status);}}
 return changes;
}
function blob(root,revision,path,code){
 need(safePath(path),'PATH_INVALID');
 let bytes;try{bytes=readFixedLocalGitBlob(root,{revision,path});}catch{fail(code+'_REGULAR_BLOB_REQUIRED');}
 const match=fixedLocalGit(root,['ls-tree','-z',revision,'--',path],{encoding:'utf8'}).match(/^(100(?:644|755)) blob ([a-f0-9]{40})\t([^\0]+)\0$/);
 need(match&&match[3]===path,'GIT_ATTRIBUTES_INVALID');
 need(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')===match[2],'GIT_ATTRIBUTES_INVALID');
 return {bytes,fact:{path,mode:match[1],git_blob_sha1:match[2],sha256:sha(bytes),byte_length:bytes.length}};
}
function reviewedBlob(root,revision,expected,code){
 const actual=blob(root,revision,expected.path,code);need(digest(actual.fact)===digest(expected),code+'_BYTES_MISMATCH');return actual;
}
function readCatalog(toolingRoot,toolingRevision,spec){
 checkState(toolingRoot,toolingRevision);
 const {bytes}=blob(toolingRoot,toolingRevision,spec.path,'CATALOG');need(sha(bytes)===spec.sha256,'CATALOG_DIGEST_MISMATCH');
 let catalog;try{catalog=JSON.parse(bytes);}catch{fail('CATALOG_INVALID');}
 need(catalog.schema_version===1&&catalog.kind==='explicit_verification_retirement_catalog'&&catalog.purpose==='admission_only'
  &&catalog.repo===REPO&&catalog.base_revision===(spec.base_revision||BASE)&&catalog.records.length===spec.records&&catalog.replacement_inputs.length===spec.inputs&&catalog.limitations.length===3,'CATALOG_INVALID');
 need(!spec.support_inputs||catalog.entry_support?.length===spec.support_inputs,'CATALOG_INVALID');
 return catalog;
}
function literalExcludes(text){
 const tree=parse(text,{ecmaVersion:'latest',sourceType:'module'}),exports=tree.body.filter(n=>n.type==='ExportDefaultDeclaration');
 const property=(object,name)=>{
  need(object?.type==='ObjectExpression'&&object.properties.every(p=>p.type==='Property'&&!p.computed&&p.kind==='init'),'BASE_CONFIG_INVALID');
  const found=object.properties.filter(p=>(p.key.name??p.key.value)===name);need(found.length===1,'BASE_CONFIG_INVALID');return found[0].value;
 };
 const call=exports[0]?.declaration;need(exports.length===1&&call?.type==='CallExpression'&&call.callee.name==='defineConfig'&&call.arguments.length===1,'BASE_CONFIG_INVALID');
 const array=property(property(call.arguments[0],'test'),'exclude');need(array.type==='ArrayExpression','BASE_CONFIG_INVALID');
 return array.elements.filter(n=>n?.type==='Literal'&&typeof n.value==='string').map(n=>n.value);
}
/** 固定Dashboard配置仅交出真实字面量候选；插件初始化与自动入口不在这里获准。 */
function dashboardCandidate(text,config,path){
 const tree=parse(text,{ecmaVersion:'latest',sourceType:'module'}),exported=tree.body.filter(n=>n.type==='ExportDefaultDeclaration');
 const call=exported[0]?.declaration,field=(obj,name)=>{
  need(obj?.type==='ObjectExpression'&&obj.properties.every(p=>p.type==='Property'&&!p.computed&&p.kind==='init'),'REPLACEMENT_CONFIG_INVALID');
  const matches=obj.properties.filter(p=>(p.key.name??p.key.value)===name);need(matches.length<=1,'REPLACEMENT_CONFIG_INVALID');return matches[0]?.value;
 };
 need(exported.length===1&&call?.type==='CallExpression'&&call.callee.name==='defineConfig'&&call.arguments.length===1,'REPLACEMENT_CONFIG_INVALID');
 const root=call.arguments[0],test=field(root,'test');
 for(const obj of[root,test])for(const name of['root','dir','workspace','projects','extends','testNamePattern','includeSource'])need(!field(obj,name),'REPLACEMENT_CONFIG_INVALID');
 const include=field(test,'include');need(include?.type==='ArrayExpression'&&include.elements.every(n=>n?.type==='Literal'&&typeof n.value==='string')&&!field(test,'exclude'),'REPLACEMENT_CONFIG_INVALID');
 return {selected:false,witness:{kind:'fixed_dashboard_literal_candidate',config_path:config.path,config_sha256:config.sha256,
  file_path:path,include_literals:include.elements.map(n=>n.value),requires_selector_reverification:true}};
}
/** 仅固定PG跑道的人工审核候选；不授予自动选择或执行资格。 */
function fixedPgCandidate(config,path){
 const allowed={
  'scripts/ci/deep-integration.config.mjs':[
   'packages/brain/src/__tests__/integration/capacity-gate.test.js',
   'packages/brain/src/__tests__/integration/preview-destroyer.test.js',
   'packages/brain/src/__tests__/integration/retired-harness-dispatch.pg.integration.test.js',
   'packages/brain/src/__tests__/integration/task-status-transitions.integration.test.js'],
  'scripts/ci/debt-pg.config.mjs':['packages/brain/src/routes/__tests__/captures-api.test.ts'],
 };
 need(allowed[config.path]?.includes(path),'REPLACEMENT_CONFIG_INVALID');
 return {selected:false,witness:{kind:'fixed_pg_literal_candidate',config_path:config.path,config_sha256:config.sha256,
  file_path:path,requires_selector_reverification:true,execution_status:'not_evaluated',coverage:'unknown'}};
}
function componentTree(root,revision){
 return new Map(fixedLocalGit(root,['ls-tree','-rz','--full-tree',revision],{encoding:'utf8'}).split('\0').filter(Boolean).map(line=>{
  const [meta,path]=line.split('\t'),[mode,type,id]=meta.split(' ');return [path,{mode,type,id}];
 }));
}
/** 420个固定blob只读一次Git输出；模式、长度、SHA1、SHA256逐条核对，不执行旧代码。 */
function componentBaseFacts(root,source,records){
 const base=componentTree(root,source.base_revision),head=componentTree(root,source.head_revision);
 for(const record of records){
  const entry=base.get(record.path),expected=record.old;
  need(entry?.type==='blob'&&['100644','100755'].includes(entry.mode)&&entry.mode===expected.mode&&entry.id===expected.git_blob_sha1,'COMPONENT_BASE_BLOB_MISMATCH');
  need(!head.has(record.path)&&![...head.keys()].some(path=>path.startsWith(record.path+'/')),'COMPONENT_HEAD_ABSENCE_REQUIRED');
 }
 const bytes=fixedLocalGit(root,['show',...records.map(r=>source.base_revision+':'+r.path)]);let offset=0;
 const facts=records.map(record=>{
  const expected=record.old,body=bytes.subarray(offset,offset+expected.byte_length);offset+=expected.byte_length;
  const fact={path:record.path,mode:base.get(record.path).mode,git_blob_sha1:createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex'),sha256:sha(body),byte_length:body.length};
  need(digest(fact)===digest(expected),'COMPONENT_BASE_BYTES_MISMATCH');
  return {path:record.path,classification:record.classification,base:{...fact,revision:source.base_revision}};
 });
 need(offset===bytes.length,'COMPONENT_BASE_BYTES_MISMATCH');return facts;
}
function closedComponentBundle(root,source,changes){
 const spec=CLOSED_COMPONENT_CATALOG;
 const bytes=readFixedLocalGitBlob(root,{revision:source.head_revision,path:spec.path},{allowMissing:true});
 if(bytes===null)return null;
 need(sha(bytes)===spec.sha256,'COMPONENT_CATALOG_DIGEST_MISMATCH');
 const data=JSON.parse(bytes),records=data.records;
 need(data.schema_version===1&&data.kind==='closed_component_retirement_catalog'&&data.purpose==='admission_only'&&data.repo===REPO
  &&data.anchor_revision==='69de823cda6d789130898399c3ad770c15b6fb71'&&Array.isArray(records)&&records.length===420
  &&new Set(records.map(r=>r.path)).size===420&&records.every(r=>safePath(r.path)&&r.old.path===r.path),'COMPONENT_CATALOG_INVALID');
 if(!changes.has(spec.path)&&!records.some(r=>changes.has(r.path)))return null;
 need(changes.get(spec.path)==='A'&&records.every(r=>changes.get(r.path)==='D'),'COMPONENT_COMPLETE_DELETION_REQUIRED');
 for(const [kind,count]of [['native_selected',15],['verification_not_selected',42],['component_file',363]])need(records.filter(r=>r.classification===kind).length===count,'COMPONENT_CATALOG_INVALID');
 try{git(root,'merge-base','--is-ancestor',data.anchor_revision,source.base_revision);}catch{fail('COMPONENT_ANCHOR_MISMATCH');}
 const closure_records=componentBaseFacts(root,source,records);
 need(data.reference_updates?.length===13&&new Set(data.reference_updates.map(r=>r.path)).size===13,'COMPONENT_REFERENCES_INVALID');
 const reference_updates=data.reference_updates.map(record=>{
  need(record.classification==='reference_cleanup'&&safePath(record.path)&&changes.get(record.path)==='M','COMPONENT_REFERENCE_CHANGE_REQUIRED');
  const old=reviewedBlob(root,source.base_revision,record.old,'COMPONENT_REFERENCE_BASE'),head=reviewedBlob(root,source.head_revision,record.head,'COMPONENT_REFERENCE_HEAD');
  need(old.fact.path===record.path&&head.fact.path===record.path,'COMPONENT_REFERENCES_INVALID');
  return {path:record.path,base:{...old.fact,revision:source.base_revision},head:{...head.fact,revision:source.head_revision},execution_status:'not_evaluated',coverage:'unknown'};
 });
 const config=reviewedBlob(root,source.head_revision,data.replacement_config,'COMPONENT_CONFIG'),skill=reviewedBlob(root,source.head_revision,data.skill_selector,'COMPONENT_SKILL');
 const replacement_inputs=data.replacement_inputs.map(expected=>{
  const actual=reviewedBlob(root,source.head_revision,expected,'COMPONENT_REPLACEMENT');
  const selected=selectVitestVerificationInput({filePath:expected.path,configPath:config.fact.path,configText:config.bytes.toString(),skillText:skill.bytes.toString(),component:'quality'});
  need(selected.selected,'COMPONENT_REPLACEMENT_NOT_SELECTED');
  return {...actual.fact,revision:source.head_revision,config:{...config.fact,revision:source.head_revision},selected_candidate:true,selector_witness:selected.witness,entry_verified:false,owner_verified:false};
 });
 need(replacement_inputs.length===3,'COMPONENT_REPLACEMENT_INVALID');
 return {schema_version:1,kind:'closed_component_retirement_bundle',catalog:{...spec,revision:source.head_revision},anchor_revision:data.anchor_revision,
  closure_records,replacement_inputs,reference_updates,audit_evidence:data.audit_evidence,limitations:data.limitations,execution_status:'not_evaluated',coverage:'unknown'};
}
/** 信任目录只从control固定Git读取。候选仓内同名JSON不参与授权。 */
export function collectVerificationRetirementCandidates(repoRoot,{source,toolingRoot,toolingRevision,purpose}={}){
 need(purpose==='admission_only','ADMISSION_ONLY');
 const changes=sourceProof(repoRoot,source),catalogs=CATALOGS.filter(spec=>!spec.onlyPaths||spec.onlyPaths.some(path=>changes.has(path))).map(spec=>({spec,catalog:readCatalog(toolingRoot,toolingRevision,spec)})),rows=[];
 for(const{spec,catalog}of catalogs){
  const records=catalog.records.filter(record=>changes.has(record.path));if(!records.length)continue;
  const baseConfig=reviewedBlob(repoRoot,source.base_revision,catalog.base_config,'BASE_CONFIG'),excludes=literalExcludes(baseConfig.bytes.toString());
  const configs=new Map((catalog.replacement_configs||[{blob:catalog.replacement_config,component:'brain'}]).map(config=>
   [config.blob.path,{...config,...reviewedBlob(repoRoot,source.head_revision,config.blob,'HEAD_CONFIG')}]));
  const skill=reviewedBlob(repoRoot,source.head_revision,catalog.skill_selector,'HEAD_CONFIG');
  const requiredPaths=new Set(records.flatMap(record=>record.replacement_paths||catalog.replacement_inputs.map(p=>(p.blob||p).path)));
  const replacements=catalog.replacement_inputs.filter(input=>requiredPaths.has((input.blob||input).path)).map(input=>{
   const expected=input.blob||input,config=configs.get(input.config_path||catalog.replacement_config.path);need(config,'REPLACEMENT_CONFIG_INVALID');
   const actualInput=reviewedBlob(repoRoot,source.head_revision,expected,'REPLACEMENT');
   const pgLimited=config.selector_kind==='fixed_pg_literal_candidate';
   const limited=config.selector_kind==='fixed_dashboard_literal_candidate'||pgLimited;
   const selected=pgLimited?fixedPgCandidate(config.fact,expected.path):limited?dashboardCandidate(config.bytes.toString(),config.fact,expected.path):selectVitestVerificationInput({filePath:expected.path,
    configPath:config.fact.path,configText:config.bytes.toString(),skillText:skill.bytes.toString(),component:config.component});
   need(selected.witness&&(limited||selected.selected),'REPLACEMENT_SELECTOR_UNPROVEN');
   return {...actualInput.fact,revision:source.head_revision,config:{...config.fact,revision:source.head_revision},
    selected_candidate:selected.selected,selector_witness:selected.witness,...(limited?{requires_selector_reverification:true}:{}),entry_verified:false,owner_verified:false};
  });
  for(const record of records){
   need(changes.get(record.path)==='D','DELETION_REQUIRED');
   const old=reviewedBlob(repoRoot,source.base_revision,record.old,'OLD_TEST');
   let baseSelector;
   if(record.base_selector_kind==='default_brain_selected'){
    need(spec.nativePaths?.length===1&&spec.nativePaths[0]==='packages/brain/src/__tests__/coding-passway.test.js'
     &&record.path===spec.nativePaths[0]&&record.exclude_literal===undefined,'BASE_SELECTION_PERMISSION_REQUIRED');
    const baseSkill=reviewedBlob(repoRoot,source.base_revision,catalog.skill_selector,'BASE_SELECTOR');
    const selected=selectVitestVerificationInput({filePath:record.path,configPath:baseConfig.fact.path,
     configText:baseConfig.bytes.toString(),skillText:baseSkill.bytes.toString(),component:'brain'});
    need(selected.selected&&selected.witness,'BASE_SELECTED_REQUIRED');baseSelector=selected.witness;
   }else{
    need(excludes.includes(record.exclude_literal)&&record.exclude_literal===posix.relative(posix.dirname(baseConfig.fact.path),record.path),'BASE_LITERAL_EXCLUDE_REQUIRED');
   }
   let absent;try{absent=readFixedLocalGitBlob(repoRoot,{revision:source.head_revision,path:record.path},{allowMissing:true});}catch{fail('HEAD_ABSENCE_UNPROVEN');}
   need(absent===null,'HEAD_ABSENCE_REQUIRED');
   const policies=[...(record.policy_sources||[]),...(catalog.entry_support||[])].map(expected=>reviewedBlob(repoRoot,source.head_revision,expected,'POLICY').fact);
   for(const path of record.required_absent_paths||[])need(readFixedLocalGitBlob(repoRoot,{revision:source.head_revision,path},{allowMissing:true})===null,'POLICY_ABSENCE_REQUIRED');
   let duplicate;
   if(record.duplicate_of){duplicate=reviewedBlob(repoRoot,source.base_revision,record.duplicate_of,'DUPLICATE').fact;need(['mode','git_blob_sha1','sha256','byte_length'].every(k=>duplicate[k]===old.fact[k]),'DUPLICATE_BYTES_MISMATCH');}
   const selectedInputs=replacements.filter(input=>!record.replacement_paths||record.replacement_paths.includes(input.path));need(selectedInputs.length,'REPLACEMENT_MISSING');
   rows.push({path:record.path,change:'D',side:'base',catalog_anchor_revision:catalog.base_revision,catalog:{path:spec.path,sha256:spec.sha256},base:{...old.fact,revision:source.base_revision,
    config:{...baseConfig.fact,revision:source.base_revision,exclude_literal:record.exclude_literal,...(baseSelector?{selector_witness:baseSelector}:{})},...(duplicate?{duplicate_of:duplicate}:{})},
    head:{revision:source.head_revision,absent:true},replacement_inputs:selectedInputs,policy_sources:policies,required_absent_paths:record.required_absent_paths||[],
    owner_candidates:[...new Map(selectedInputs.map(input=>[input.config.path,{side:'head',revision:source.head_revision,path:input.config.path,sha256:input.config.sha256}])).values()],
    audit:record.audit,catalog_limitations:catalog.limitations,requires_native_base_no_business_consumer:true,entry_verified:false,owner_verified:false,retirement_authorized:false});
  }
 }
 const component=closedComponentBundle(repoRoot,source,changes);
 if(component)for(const record of component.closure_records.filter(r=>r.classification!=='native_selected'))rows.push({path:record.path,retirement_kind:'closed_component',
  change:'D',side:'base',base:{revision:source.base_revision},head:{revision:source.head_revision,absent:true},requires_native_base_no_business_consumer:true,
  entry_verified:false,owner_verified:false,retirement_authorized:false});
 checkState(repoRoot,source.head_revision);checkState(toolingRoot,toolingRevision);
 const body={schema_version:1,kind:'explicit_verification_retirement',purpose,source:structuredClone(source),
  control:{revision:toolingRevision,catalog_path:CATALOG,catalog_sha256:CATALOG_SHA256,catalogs:CATALOGS.map(({path,sha256})=>({path,sha256}))},rows,limitations:catalogs[0].catalog.limitations,
  ...(component?{closed_component_bundle:component}:{}),execution_status:'not_evaluated',coverage:'unknown',business_runtime_status:'not_evaluated'};
 return {...body,retirement_candidates_sha256:digest(body)};
}
/** 复核必须重读同一固定Git；结构自洽与自算摘要不构成审批。 */
export function verifyVerificationRetirementCandidates(repoRoot,{proof,...options}={}){
 need(proof?.purpose==='admission_only'&&options.purpose==='admission_only','ADMISSION_ONLY');
 const actual=collectVerificationRetirementCandidates(repoRoot,options);
 need(digest(proof)===digest(actual),'WITNESS_MISMATCH');return actual;
}
