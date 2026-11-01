/** 显式已排除旧测试的退休候选；不授予执行、覆盖或原生owner资格。 */
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {fixedLocalGit,readFixedLocalGitBlob} from './fixed-local-git.mjs';
import {selectVitestVerificationInput} from './implementation-verification-selectors.mjs';
const REPO='perfectuser21/cecelia',BASE='68b996a5641b69e6f21705a114a4524e407fe097';
const CATALOG='config/verification-retirements/alertness-v1.json';
const CATALOG_SHA256='f9c3f170764dc41dbd4f710e5082551880c47f008bc7a9ca3cbc91eba2e5c73c';
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
function readCatalog(toolingRoot,toolingRevision){
 checkState(toolingRoot,toolingRevision);
 const {bytes}=blob(toolingRoot,toolingRevision,CATALOG,'CATALOG');need(sha(bytes)===CATALOG_SHA256,'CATALOG_DIGEST_MISMATCH');
 let catalog;try{catalog=JSON.parse(bytes);}catch{fail('CATALOG_INVALID');}
 need(catalog.schema_version===1&&catalog.kind==='explicit_verification_retirement_catalog'&&catalog.purpose==='admission_only'
  &&catalog.repo===REPO&&catalog.base_revision===BASE&&catalog.records.length===5&&catalog.replacement_inputs.length===11&&catalog.limitations.length===3,'CATALOG_INVALID');
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
/** 信任目录只从control固定Git读取。候选仓内同名JSON不参与授权。 */
export function collectVerificationRetirementCandidates(repoRoot,{source,toolingRoot,toolingRevision,purpose}={}){
 need(purpose==='admission_only','ADMISSION_ONLY');
 const changes=sourceProof(repoRoot,source),catalog=readCatalog(toolingRoot,toolingRevision);
 const records=catalog.records.filter(record=>changes.has(record.path)),rows=[];
 if(records.length){
  const baseConfig=reviewedBlob(repoRoot,BASE,catalog.base_config,'BASE_CONFIG'),excludes=literalExcludes(baseConfig.bytes.toString());
  const headConfig=reviewedBlob(repoRoot,source.head_revision,catalog.replacement_config,'HEAD_CONFIG');
  const skill=reviewedBlob(repoRoot,source.head_revision,catalog.skill_selector,'HEAD_CONFIG');
  const replacements=catalog.replacement_inputs.map(expected=>{
   const input=reviewedBlob(repoRoot,source.head_revision,expected,'REPLACEMENT');
   const selected=selectVitestVerificationInput({filePath:expected.path,configPath:headConfig.fact.path,
    configText:headConfig.bytes.toString(),skillText:skill.bytes.toString(),component:'brain'});
   need(selected.selected&&selected.witness,'REPLACEMENT_SELECTOR_UNPROVEN');
   return {...input.fact,revision:source.head_revision,config:{...headConfig.fact,revision:source.head_revision},
    selected_candidate:true,selector_witness:selected.witness,entry_verified:false,owner_verified:false};
  });
  for(const record of records){
   need(changes.get(record.path)==='D','DELETION_REQUIRED');
   const old=reviewedBlob(repoRoot,BASE,record.old,'OLD_TEST');
   need(excludes.includes(record.exclude_literal)&&record.exclude_literal==='../../'+record.path,'BASE_LITERAL_EXCLUDE_REQUIRED');
   let absent;try{absent=readFixedLocalGitBlob(repoRoot,{revision:source.head_revision,path:record.path},{allowMissing:true});}catch{fail('HEAD_ABSENCE_UNPROVEN');}
   need(absent===null,'HEAD_ABSENCE_REQUIRED');
   rows.push({path:record.path,change:'D',side:'base',base:{...old.fact,revision:BASE,config:{...baseConfig.fact,revision:BASE,exclude_literal:record.exclude_literal}},
    head:{revision:source.head_revision,absent:true},replacement_inputs:replacements,
    owner_candidates:[{side:'head',revision:source.head_revision,path:headConfig.fact.path,sha256:headConfig.fact.sha256}],
    audit:record.audit,requires_native_base_no_business_consumer:true,entry_verified:false,owner_verified:false,retirement_authorized:false});
  }
 }
 checkState(repoRoot,source.head_revision);checkState(toolingRoot,toolingRevision);
 const body={schema_version:1,kind:'explicit_verification_retirement',purpose,source:structuredClone(source),
  control:{revision:toolingRevision,catalog_path:CATALOG,catalog_sha256:CATALOG_SHA256},rows,limitations:catalog.limitations,
  execution_status:'not_evaluated',coverage:'unknown',business_runtime_status:'not_evaluated'};
 return {...body,retirement_candidates_sha256:digest(body)};
}
/** 复核必须重读同一固定Git；结构自洽与自算摘要不构成审批。 */
export function verifyVerificationRetirementCandidates(repoRoot,{proof,...options}={}){
 need(proof?.purpose==='admission_only'&&options.purpose==='admission_only','ADMISSION_ONLY');
 const actual=collectVerificationRetirementCandidates(repoRoot,options);
 need(digest(proof)===digest(actual),'WITNESS_MISMATCH');return actual;
}
