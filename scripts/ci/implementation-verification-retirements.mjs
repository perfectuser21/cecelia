/** 显式已排除旧测试的退休候选；不授予执行、覆盖或原生owner资格。 */
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {posix} from 'node:path';
import {fixedLocalGit,readFixedLocalGitBlob} from './fixed-local-git.mjs';
import {selectVitestVerificationInput} from './implementation-verification-selectors.mjs';
const REPO='perfectuser21/cecelia',BASE='68b996a5641b69e6f21705a114a4524e407fe097';
const CATALOG='config/verification-retirements/alertness-v1.json';
const CATALOG_SHA256='f9c3f170764dc41dbd4f710e5082551880c47f008bc7a9ca3cbc91eba2e5c73c';
const CATALOGS=[{path:CATALOG,sha256:CATALOG_SHA256,records:5,inputs:11},
 {path:'config/verification-retirements/legacy-five-v1.json',sha256:'1392c3febd9131416ec8c960a7a5a0ff6553b496084efeee1db6e1c236f25717',records:5,inputs:4}];
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
  &&source.repo===REPO&&source.base_revision===BASE,'BASE_SOURCE_INVALID');
 need(Array.isArray(source.changed_files)&&source.changed_files.length&&source.changed_files.every(c=>c&&Object.keys(c).join(',')==='path'&&safePath(c.path)),'SOURCE_PATH_INVALID');
 checkState(root,source.head_revision);
 try{git(root,'merge-base','--is-ancestor',BASE,source.head_revision);}catch{fail('ANCESTRY_MISMATCH');}
 const actual=fixedLocalGit(root,['diff','--no-renames','--name-only','-z',BASE,source.head_revision,'--'],{encoding:'utf8'}).split('\0').filter(Boolean).sort();
 const supplied=source.changed_files.map(c=>c.path).sort();
 need(new Set(supplied).size===supplied.length&&JSON.stringify(supplied)===JSON.stringify(actual),'DELTA_MISMATCH');
 const tokens=fixedLocalGit(root,['diff','--find-renames=50%','--name-status','-z',BASE,source.head_revision,'--'],{encoding:'utf8'}).split('\0').filter(Boolean),changes=new Map();
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
  &&catalog.repo===REPO&&catalog.base_revision===BASE&&catalog.records.length===spec.records&&catalog.replacement_inputs.length===spec.inputs&&catalog.limitations.length===3,'CATALOG_INVALID');
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
/** 信任目录只从control固定Git读取。候选仓内同名JSON不参与授权。 */
export function collectVerificationRetirementCandidates(repoRoot,{source,toolingRoot,toolingRevision,purpose}={}){
 need(purpose==='admission_only','ADMISSION_ONLY');
 const changes=sourceProof(repoRoot,source),catalogs=CATALOGS.map(spec=>({spec,catalog:readCatalog(toolingRoot,toolingRevision,spec)})),rows=[];
 for(const{spec,catalog}of catalogs){
  const records=catalog.records.filter(record=>changes.has(record.path));if(!records.length)continue;
  const baseConfig=reviewedBlob(repoRoot,BASE,catalog.base_config,'BASE_CONFIG'),excludes=literalExcludes(baseConfig.bytes.toString());
  const configs=new Map((catalog.replacement_configs||[{blob:catalog.replacement_config,component:'brain'}]).map(config=>
   [config.blob.path,{...config,...reviewedBlob(repoRoot,source.head_revision,config.blob,'HEAD_CONFIG')}]));
  const skill=reviewedBlob(repoRoot,source.head_revision,catalog.skill_selector,'HEAD_CONFIG');
  const requiredPaths=new Set(records.flatMap(record=>record.replacement_paths||catalog.replacement_inputs.map(p=>(p.blob||p).path)));
  const replacements=catalog.replacement_inputs.filter(input=>requiredPaths.has((input.blob||input).path)).map(input=>{
   const expected=input.blob||input,config=configs.get(input.config_path||catalog.replacement_config.path);need(config,'REPLACEMENT_CONFIG_INVALID');
   const actualInput=reviewedBlob(repoRoot,source.head_revision,expected,'REPLACEMENT');
   const limited=config.selector_kind==='fixed_dashboard_literal_candidate';
   const selected=limited?dashboardCandidate(config.bytes.toString(),config.fact,expected.path):selectVitestVerificationInput({filePath:expected.path,
    configPath:config.fact.path,configText:config.bytes.toString(),skillText:skill.bytes.toString(),component:config.component});
   need(selected.witness&&(limited||selected.selected),'REPLACEMENT_SELECTOR_UNPROVEN');
   return {...actualInput.fact,revision:source.head_revision,config:{...config.fact,revision:source.head_revision},
    selected_candidate:selected.selected,selector_witness:selected.witness,...(limited?{requires_selector_reverification:true}:{}),entry_verified:false,owner_verified:false};
  });
  for(const record of records){
   need(changes.get(record.path)==='D','DELETION_REQUIRED');
   const old=reviewedBlob(repoRoot,BASE,record.old,'OLD_TEST');
   need(excludes.includes(record.exclude_literal)&&record.exclude_literal===posix.relative(posix.dirname(baseConfig.fact.path),record.path),'BASE_LITERAL_EXCLUDE_REQUIRED');
   let absent;try{absent=readFixedLocalGitBlob(repoRoot,{revision:source.head_revision,path:record.path},{allowMissing:true});}catch{fail('HEAD_ABSENCE_UNPROVEN');}
   need(absent===null,'HEAD_ABSENCE_REQUIRED');
   const policies=(record.policy_sources||[]).map(expected=>reviewedBlob(repoRoot,source.head_revision,expected,'POLICY').fact);
   for(const path of record.required_absent_paths||[])need(readFixedLocalGitBlob(repoRoot,{revision:source.head_revision,path},{allowMissing:true})===null,'POLICY_ABSENCE_REQUIRED');
   let duplicate;
   if(record.duplicate_of){duplicate=reviewedBlob(repoRoot,BASE,record.duplicate_of,'DUPLICATE').fact;need(['mode','git_blob_sha1','sha256','byte_length'].every(k=>duplicate[k]===old.fact[k]),'DUPLICATE_BYTES_MISMATCH');}
   const selectedInputs=replacements.filter(input=>!record.replacement_paths||record.replacement_paths.includes(input.path));need(selectedInputs.length,'REPLACEMENT_MISSING');
   rows.push({path:record.path,change:'D',side:'base',catalog:{path:spec.path,sha256:spec.sha256},base:{...old.fact,revision:BASE,
    config:{...baseConfig.fact,revision:BASE,exclude_literal:record.exclude_literal},...(duplicate?{duplicate_of:duplicate}:{})},
    head:{revision:source.head_revision,absent:true},replacement_inputs:selectedInputs,policy_sources:policies,required_absent_paths:record.required_absent_paths||[],
    owner_candidates:[...new Map(selectedInputs.map(input=>[input.config.path,{side:'head',revision:source.head_revision,path:input.config.path,sha256:input.config.sha256}])).values()],
    audit:record.audit,catalog_limitations:catalog.limitations,requires_native_base_no_business_consumer:true,entry_verified:false,owner_verified:false,retirement_authorized:false});
  }
 }
 checkState(repoRoot,source.head_revision);checkState(toolingRoot,toolingRevision);
 const body={schema_version:1,kind:'explicit_verification_retirement',purpose,source:structuredClone(source),
  control:{revision:toolingRevision,catalog_path:CATALOG,catalog_sha256:CATALOG_SHA256,catalogs:CATALOGS.map(({path,sha256})=>({path,sha256}))},rows,limitations:catalogs[0].catalog.limitations,
  execution_status:'not_evaluated',coverage:'unknown',business_runtime_status:'not_evaluated'};
 return {...body,retirement_candidates_sha256:digest(body)};
}
/** 复核必须重读同一固定Git；结构自洽与自算摘要不构成审批。 */
export function verifyVerificationRetirementCandidates(repoRoot,{proof,...options}={}){
 need(proof?.purpose==='admission_only'&&options.purpose==='admission_only','ADMISSION_ONLY');
 const actual=collectVerificationRetirementCandidates(repoRoot,options);
 need(digest(proof)===digest(actual),'WITNESS_MISMATCH');return actual;
}
