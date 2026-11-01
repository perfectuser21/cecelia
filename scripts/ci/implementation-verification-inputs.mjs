/** 派生verification输入的固定Git事实；事实层不授予入口、owner或执行资格。 */
import {createHash} from 'node:crypto';
import yaml from 'js-yaml';
import {parse} from 'acorn';
import {stripTypeScriptTypes} from 'node:module';
import {posix} from 'node:path';
import {selectVitestVerificationInput,selectPinnedSkillVerificationInput} from './implementation-verification-selectors.mjs';
import {fixedLocalGit,readFixedLocalGitBlob} from './fixed-local-git.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const fail=code=>{throw Object.assign(Error('VERIFICATION_INPUT_'+code),{code:'VERIFICATION_INPUT_'+code});};
const location=path=>typeof path==='string'&&/^[-A-Za-z0-9_./@+]+$/.test(path)&&!path.startsWith('/')&&!path.split('/').some(p=>!p||p==='.'||p==='..');
export function verificationInputKind(path){
 if(!location(path))return null;
 if(/\.(?:test|spec)\.[cm]?[jt]sx?$|\.test\.sh$/.test(path))return'test_source';
 if(/(?:^|\/)(?:tests|__tests__)\/(?:helpers\/.*|[^/]+\.fixture\.[cm]?[jt]sx?)$/.test(path)&&/\.[cm]?[jt]sx?$/.test(path))return'test_helper';
 if(/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)||/^(?:(?:packages\/(?:brain|engine|quality)|apps\/(?:api|dashboard))\/)?vitest(?:\.skill-source)?\.config\.[cm]?[jt]s$/.test(path))return'ci_configuration';
 if(['scripts/ci/run-skill-source-check.mjs','scripts/ci/dep-audit-critical.sh','scripts/ci/dep-audit-runtime-high.sh','scripts/ci/validate-npm-audit.mjs','scripts/quickcheck.sh','packages/engine/scripts/e2e-integrity-check.sh'].includes(path))return'ci_tool';
 return null;
}
function checkedSource(root,source){
 if(!source||source.repo!=='perfectuser21/cecelia'||![source.base_revision,source.head_revision].every(s=>/^[a-f0-9]{40}$/.test(s||''))
  ||!Array.isArray(source.changed_files)||!source.changed_files.length||source.changed_files.some(c=>!c||Object.keys(c).join(',')!=='path'||!location(c.path)))fail('SOURCE_INVALID');
 const git=args=>fixedLocalGit(root,args,{encoding:'utf8'}).trim();
 const origin=git(['remote','get-url','origin']);
 if(!['https://github.com/perfectuser21/cecelia.git','https://github.com/perfectuser21/cecelia','git@github.com:perfectuser21/cecelia.git'].includes(origin))fail('REPO_MISMATCH');
 if(git(['rev-parse','HEAD'])!==source.head_revision||git(['status','--porcelain=v1','--untracked-files=no']))fail('STATE_MISMATCH');
 try{git(['merge-base','--is-ancestor',source.base_revision,source.head_revision]);}catch{fail('ANCESTRY_MISMATCH');}
 const actual=fixedLocalGit(root,['diff','--no-renames','--name-only','-z',source.base_revision,source.head_revision,'--'],{encoding:'utf8'}).split('\0').filter(Boolean).sort();
 const supplied=source.changed_files.map(c=>c.path).sort();
 if(new Set(supplied).size!==supplied.length||JSON.stringify(actual)!==JSON.stringify(supplied))fail('DELTA_MISMATCH');
 return git;
}
function fixedInputFacts(root,{source,side,path,purpose='admission_only',allowMissing=false},git,kind=verificationInputKind(path),role='verification_input'){
 if(purpose!=='admission_only')fail('ADMISSION_ONLY');
 if(!['base','head'].includes(side)||!kind)fail('LOCATION_INVALID');
 if(!source.changed_files.some(c=>c.path===path))fail('NOT_IN_DELTA');
 const revision=source[side+'_revision'],tree=git(['rev-parse',revision+'^{tree}']);
 let bytes;try{bytes=readFixedLocalGitBlob(root,{revision,path},{allowMissing});}catch(error){throw Object.assign(Error('VERIFICATION_INPUT_'+error.message),{code:'VERIFICATION_INPUT_GIT_INVALID'});}
 if(bytes===null)return null;
 const entry=fixedLocalGit(root,['ls-tree','-z',revision,'--',path],{encoding:'utf8'}).split('\0').filter(Boolean);
 if(entry.length!==1)fail('GIT_ATTRIBUTES_INVALID');
 const match=entry[0].match(/^(100(?:644|755)) blob ([a-f0-9]{40})\t(.+)$/);
 const blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
 if(!match||match[2]!==blob||match[3]!==path)fail('GIT_ATTRIBUTES_INVALID');
 const body={schema_version:1,purpose,role,input_kind:kind,path,...(role!=='verification_input'?{non_executable:true}:{}),
  source:{repo:source.repo,side,revision,tree_sha1:tree,base_revision:source.base_revision,head_revision:source.head_revision},
  mode:match[1],git_blob_sha1:blob,sha256:sha(bytes),byte_length:bytes.length,entry_verified:false,owner_verified:false};
 return {...body,facts_sha256:sha(JSON.stringify(canonical(body)))};
}
export function readVerificationInputFacts(root,options){return fixedInputFacts(root,options,checkedSource(root,options.source));}
export function nonExecutableChangeKind(path){
 if(['docs/current/CI_PIPELINE.md','docs/current/README.md'].includes(path))return'documentation_change';
 if(['docs/registry/features/task.yml','docs/registry/test-registry.yml'].includes(path))return'reference_catalog_change';return null;
}
export function readNonExecutableChangeFacts(root,options){
 const kind=nonExecutableChangeKind(options?.path);if(!kind)fail('NON_EXECUTABLE_LOCATION_INVALID');
 return fixedInputFacts(root,options,checkedSource(root,options.source),kind,kind);
}
export function verifyVerificationInputFacts(root,{source,row,purpose='admission_only'}){
 if(!row||row.purpose!==purpose)fail('FACTS_INVALID');
 const actual=readVerificationInputFacts(root,{source,side:row.source?.side,path:row.path,purpose});
 if(JSON.stringify(canonical(actual))!==JSON.stringify(canonical(row)))fail('FACTS_MISMATCH');
 return actual;
}

const CI='.github/workflows/ci.yml',BASIC_RUNNER='scripts/ci/run-basic-check.mjs';
const LEGACY_CI='528a08e84e5dc0ffc1c8ae83e8ee54e9e63366513b1dd119598085d86de96181';
const BASIC_CI='7fee2a6d842c7c2595fa882fa61f75750ec6b2787186fdaf8747e1084a64fcee';
const BASIC_ENTRY_SEALS={
 'scripts/ci/run-basic-check.mjs':'c9c1318dcd6b35981453aa06f656f5a99cb6283d2b7e4ea4a1cf8f6772103f6d',
 'scripts/ci/basic-scope.mjs':'9844bb702db2c1a9507f88f1c6c330f676b786cb784592dc4aaefc096b93d6ef',
 'scripts/ci/check-basic-results.mjs':'b6c0b93e15320deff680e765f4558fcdb2a8d98c65d7a926d94f2158af6641e2',
 'scripts/ci/ops-checks.mjs':'96023fd57f11eb1277396b77419bad94a050d0ef64b1c5993db258d87797df82',
};
const UNIT_CONFIGS=[
 {component:'brain',directory:'packages/brain',path:'packages/brain/vitest.config.js'},
 {component:'engine',directory:'packages/engine',path:'packages/engine/vitest.config.ts'},
 {component:'quality',directory:'packages/quality',path:'packages/quality/vitest.config.ts'},
 {component:'api',directory:'apps/api',path:'apps/api/vitest.config.ts'},
 {component:'dashboard',directory:'apps/dashboard',path:'apps/dashboard/vitest.config.ts'},
];
function unitConfigs(path){
 return UNIT_CONFIGS.filter(c=>path.startsWith(c.directory+'/')||c.component==='brain'&&/^(?:tests|sprints)\//.test(path));
}
function componentSelected(profile,component,paths){
 if(profile==='legacy'){
  if(paths.some(p=>p.startsWith('.github/workflows/')))return true;
  if(component==='dashboard')return false;
  const prefixes={brain:['packages/brain/','packages/engine/'],engine:['packages/engine/'],quality:['packages/quality/','packages/engine/'],api:['apps/']}[component];
  return paths.some(p=>prefixes.some(prefix=>p.startsWith(prefix)));
 }
 if(component==='scripts')return true;
 return paths.some(path=>{
  if(/(?:^|\/)(?:README|CHANGELOG|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|LICENSE)\.md$/i.test(path)||/^(?:AGENTS|CLAUDE|DEFINITION|PRD|DoD)\.md$/i.test(path)
   ||/^(?:docs|sprints)\//.test(path)&&/\.(?:md|txt|rst|png|jpe?g|gif|svg|webp|pdf)$/i.test(path))return false;
  const name=path.slice(path.lastIndexOf('/')+1),parts=name.split('.');
  if((['vitest','vite','eslint'].includes(parts[0])&&parts.slice(1).includes('config'))||parts[0]==='tsconfig'&&parts.at(-1)==='json'
   ||name==='.eslintrc'||name.startsWith('.eslintrc.')||/^(?:\.github|scripts|config)\//.test(path)
   ||/^(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|\.npmrc|\.skills-source\.json)$/.test(path))return true;
  if(/^(?:packages\/(?:brain|engine)|apps\/api)\//.test(path))return ['brain','engine','api','ops'].includes(component);
  if(path.startsWith('packages/quality/'))return component==='quality';
  if(path.startsWith('apps/dashboard/'))return component==='dashboard';
  if(/^(?:frontend|apps\/android-agent|packages\/mcp-readonly)\//.test(path))return false;
  return true;
 });
}
/** 同一份固定Git内缓存必要入口/config；仅读delta正文及固定数量的支持文件。 */
function supportReader(root,source,git){
 const cache=new Map(),trees=Object.fromEntries(['base','head'].map(side=>[side,git(['rev-parse',source[side+'_revision']+'^{tree}'])]));
 return (side,path)=>{
  if(!location(path))fail('SUPPORT_LOCATION_INVALID');const key=side+':'+path;
  if(!cache.has(key)){
   const revision=source[side+'_revision'],bytes=readFixedLocalGitBlob(root,{revision,path},{allowMissing:true});
   if(bytes===null){cache.set(key,null);return null;}if(bytes.length>2*1024*1024)fail('INPUT_TOO_LARGE');
   const line=fixedLocalGit(root,['ls-tree','-z',revision,'--',path],{encoding:'utf8'}),match=line.match(/^(100(?:644|755)) blob ([a-f0-9]{40})\t([^\0]+)\0$/);
   const blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
   if(!match||match[2]!==blob||match[3]!==path)fail('SUPPORT_ATTRIBUTES_INVALID');
   cache.set(key,{text:bytes.toString('utf8'),reference:{path,source:{repo:source.repo,side,revision,tree_sha1:trees[side]},mode:match[1],git_blob_sha1:blob,sha256:sha(bytes),byte_length:bytes.length}});
  }
  return cache.get(key);
 };
}
function unitEntry(read,side){
 const workflow=read(side,CI);if(!workflow)return null;let doc;
 try{doc=yaml.load(workflow.text);}catch{return null;}
 const signature=sha(JSON.stringify(canonical(doc)));if(![LEGACY_CI,BASIC_CI].includes(signature))return null;
 const support=[workflow.reference];
 if(signature===BASIC_CI)for(const[path,expected]of Object.entries(BASIC_ENTRY_SEALS)){
  const file=read(side,path);if(!file||file.reference.sha256!==expected)return null;support.push(file.reference);
 }
 return {profile:signature===LEGACY_CI?'legacy':'basic',canonical_sha256:signature,workflow:workflow.reference,support,
  declaration_only:true,execution_status:'not_evaluated'};
}
const PINNED_CI='.github/workflows/skills-source-check.yml';
function runnerSelector(path,entry,paths){
 if(entry?.profile!=='basic')return null;
 const direct=(directory,regex)=>path.startsWith(directory+'/')&&!path.slice(directory.length+1).includes('/')&&regex.test(path.slice(directory.length+1));
 if(direct('scripts/ci/__tests__',/^(basic-.*|run-basic-check|brain-source-only-deploy)\.test\.mjs$/))return {component:'scripts',kind:'basic_regular_node_test',owner:BASIC_RUNNER};
 if(['unit','integration','integrity'].some(kind=>direct('packages/engine/tests/'+kind,/\.test\.sh$/))&&componentSelected('basic','engine',paths))return {component:'engine',kind:'basic_engine_shell_test',owner:BASIC_RUNNER};
 if(!componentSelected('basic','ops',paths))return null;
 if(direct('docker/cecelia-runner/__tests__',/\.test\.(?:cjs|sh)$/)||direct('scripts/__tests__',/^(?:bluegreen-|brain-deploy-|preview-|codex-remote-launch|codex-request).*\.test\.sh$/))return {component:'ops',kind:'basic_ops_regular_test',owner:'scripts/ci/ops-checks.mjs'};
 return null;
}
function pinnedSources(read,side){
 const workflow=read(side,PINNED_CI),runner=read(side,'scripts/ci/run-skill-source-check.mjs'),skill=read(side,'scripts/ci/skill-source-tests.mjs');
 if(!workflow||!runner||!skill||runner.reference.sha256!=='debcaf26aa7025f47d846052e0c2b43d1a04976003936143d80ddac1582d7204'
  ||skill.reference.sha256!=='1daf4f27f6fa97b3c8f3d9a9e1a9e86e44fbe92b84c962d1c2ce3b90db32b147')return null;
 let doc;try{doc=yaml.load(workflow.text);}catch{return null;}
 if(sha(JSON.stringify(canonical(doc)))!=='47ecfb544ffd07de5773a2b53eb60fe31a59a783896bc27de2bf86c65b6d6ccf')return null;
 return {workflow,runner,skill};
}
function pinnedBaseConfiguration(read,side,component,path){
 if(component==='root')return {};
 const config=UNIT_CONFIGS.find(c=>c.component===component),file=config&&read(side,config.path),skill=read(side,'scripts/ci/skill-source-tests.mjs');if(!file)return null;
 try{const parsed=selectVitestVerificationInput({filePath:path,configPath:config.path,configText:file.text,skillText:skill?.text,component});return {base_config:file.reference,base_selector_validation:parsed.witness};}catch{return null;}
}
function pinnedSelector(read,side,path){
 const sources=pinnedSources(read,side);if(!sources)return null;const {workflow,runner,skill}=sources;
 const component=path.startsWith('packages/brain/')?'brain':path.startsWith('packages/engine/')?'engine':path.startsWith('packages/quality/')?'quality':path.startsWith('tests/')?'root':null;
 if(!component)return null;const base=pinnedBaseConfiguration(read,side,component,path);if(!base)return null;const config=read(side,(component==='root'?'':`packages/${component}/`)+'vitest.skill-source.config.mjs');if(!config)return null;
 let selected;try{selected=selectPinnedSkillVerificationInput({filePath:path,configPath:config.reference.path,configText:config.text,skillText:skill.text,component});}catch{return null;}
 if(!selected.selected)return null;
 return {witness:{kind:'pinned_skill_config_input',component,...base,workflow:workflow.reference,runner:runner.reference,skill_selector:skill.reference,config:config.reference,selector:selected.witness},
  eligible_owner_paths:[config.reference.path,'scripts/ci/run-skill-source-check.mjs',PINNED_CI]};
}
function configurationInput(read,side,path,entry){
 if(entry?.profile==='basic'&&/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)){
  const reader=read(side,'scripts/ci/__tests__/basic-workflow.test.mjs');
  if(reader?.reference.sha256==='de63ad0a9ab927069c3ca00994633ab6ba9f503913441f4f25572ce94025a6d4'){
   let doc;try{doc=yaml.load(read(side,path).text);}catch{return null;}
   if(!doc?.on||!doc.jobs||typeof doc.jobs!=='object'||!Object.keys(doc.jobs).length)return null;
   return {witness:{kind:'workflow_yaml_schema_input',entry,reader:reader.reference,selector:'readdir top-level .ya?ml + yaml.load/readFileSync',workflow_jobs_execution:'not_evaluated'},eligible_owner_paths:[BASIC_RUNNER,CI]};
  }
 }
 const pinned=pinnedSources(read,side);if(!pinned)return null;
 if(path==='scripts/ci/run-skill-source-check.mjs')return {witness:{kind:'pinned_contract_runner_input',workflow:pinned.workflow.reference,runner:pinned.runner.reference},eligible_owner_paths:[PINNED_CI]};
 const component={'packages/brain/vitest.skill-source.config.mjs':'brain','packages/engine/vitest.skill-source.config.mjs':'engine','packages/quality/vitest.skill-source.config.mjs':'quality','vitest.skill-source.config.mjs':'root'}[path];
 if(!component)return null;const base=pinnedBaseConfiguration(read,side,component,(component==='root'?'tests/':`packages/${component}/`)+'unselected.test.js');if(!base)return null;const config=read(side,path);
 try{selectPinnedSkillVerificationInput({filePath:(component==='root'?'tests/':`packages/${component}/`)+ 'unselected.test.js',configPath:path,configText:config.text,skillText:pinned.skill.text,component});}catch{return null;}
 return {witness:{kind:'pinned_config_reference_input',...base,workflow:pinned.workflow.reference,runner:pinned.runner.reference,skill_selector:pinned.skill.reference,config:config.reference},eligible_owner_paths:['scripts/ci/run-skill-source-check.mjs',PINNED_CI]};
}
function securityInput(path,entry){
 if(entry?.profile!=='basic'||!['scripts/ci/dep-audit-critical.sh','scripts/ci/dep-audit-runtime-high.sh'].includes(path))return null;
 return {witness:{kind:'security_job_script_input',entry,selector:'security.run exact bash entry',script:path},eligible_owner_paths:[CI]};
}
function packageUnitEntry(read,side,entry,config){
 if(entry.profile!=='legacy'||!['quality','api'].includes(config.component))return [];
 const manifest=read(side,config.directory+'/package.json');let pkg;try{pkg=JSON.parse(manifest?.text);}catch{return null;}
 const allowed=config.component==='quality'?['vitest run']:["NODE_OPTIONS='--max-old-space-size=2048' vitest run",'vitest run'];
 if(!allowed.includes(pkg.scripts?.test)||pkg.scripts.pretest||pkg.scripts.posttest||!pkg.devDependencies?.vitest)return null;
 return [manifest.reference];
}
function selectedReader(read,side,path,entry,paths){
 const body=read(side,path);if(!body||verificationInputKind(path)!=='test_source')return null;
 const direct=runnerSelector(path,entry,paths),pinned=pinnedSelector(read,side,path);
 if(pinned)return {...pinned,reader:body};
 if(direct)return {reader:body,witness:{kind:direct.kind,entry},eligible_owner_paths:[direct.owner,BASIC_RUNNER,CI]};
 if(!entry)return null;
 for(const config of unitConfigs(path)){
  if(!componentSelected(entry.profile,config.component,paths))continue;
  const file=read(side,config.path),package_entry=packageUnitEntry(read,side,entry,config);if(!file||!package_entry)continue;
  const skill=file.text.includes('skillSourceExcludes')?read(side,'scripts/ci/skill-source-tests.mjs'):null;
  try{
   const selected=selectVitestVerificationInput({filePath:path,configPath:config.path,configText:file.text,component:config.component,skillText:skill?.text});
   if(selected.selected)return {reader:body,witness:{kind:'vitest_config_input',entry,package_entry,config:file.reference,selector:selected.witness},eligible_owner_paths:[config.path,...(entry.profile==='basic'?[BASIC_RUNNER]:[]),CI]};
  }catch{/* 未证明的reader不能借path成为自动入口。 */}
 }
 return null;
}
function staticImportMatches(read,side,reader,specifier,target){
 const resolved=posix.normalize(posix.join(posix.dirname(reader),specifier));
 if(resolved===target)return true;
 if(posix.extname(resolved)||!target.startsWith(resolved+'.')||!location(resolved))return false;
 const extensions=['','.mjs','.js','.mts','.ts','.jsx','.tsx','.json'];
 const candidates=extensions.map(ext=>resolved+ext).filter(path=>read(side,path));
 return candidates.length===1&&candidates[0]===target;
}
function importedHelper(read,side,path,entry,paths,readers){
 if(verificationInputKind(path)!=='test_helper')return null;
 for(const candidate of readers){
  const selected=selectedReader(read,side,candidate,entry,paths);if(!selected)continue;let tree;
  try{tree=parse(candidate.endsWith('.ts')?stripTypeScriptTypes(selected.reader.text,{mode:'strip'}):selected.reader.text,{ecmaVersion:'latest',sourceType:'module'});}catch{continue;}
  const imported=tree.body.find(n=>n.type==='ImportDeclaration'&&typeof n.source.value==='string'&&n.source.value.startsWith('.')
   &&staticImportMatches(read,side,candidate,n.source.value,path));
  if(imported)return {witness:{kind:'selected_test_static_import_input',reader:selected.reader.reference,reader_entry:selected.witness,
   import_source:imported.source.value,import_range:[imported.start,imported.end]},eligible_owner_paths:selected.eligible_owner_paths};
 }
 return null;
}
function auditedToolReader(read,side,path,entry,paths){
 if(['scripts/quickcheck.sh','packages/engine/scripts/e2e-integrity-check.sh'].includes(path)){
  const candidate='packages/engine/tests/devgate/quickcheck-dod-guard.test.ts',reader=selectedReader(read,side,candidate,entry,paths);
  if(reader?.reader.reference.sha256==='56fd6ea37aea71ef8fb46bd2e5a2e9d2a38d0b65ae7e375a517cffe61e74c620')return {
   witness:{kind:path==='scripts/quickcheck.sh'?'selected_fixture_copy_input':'selected_fixture_read_input',reader:reader.reader.reference,reader_entry:reader.witness,
    selector:path==='scripts/quickcheck.sh'?'active quickcheck fixture copyFileSync + sourceRoot/script literal loop':'active it readFileSync/join(sourceRoot, literal path)'},eligible_owner_paths:reader.eligible_owner_paths};
 }
 if(path==='scripts/ci/validate-npm-audit.mjs'&&entry?.profile==='basic'){
  const seals={'scripts/ci/dep-audit-critical.sh':'84a7aca5e9f64ecc2142157295578d700f53280881315103fc4dc68a25ba0f08',
   'scripts/ci/dep-audit-runtime-high.sh':'8d8d0a551c9c1bbd45d791bc943ae989a1b5ab386585debd09658690d09fc223'};
  const readers=Object.entries(seals).map(([path,expected])=>read(side,path)).filter(file=>file&&seals[file.reference.path]===file.reference.sha256);
  if(readers.length)return {witness:{kind:'security_audit_node_validator_input',entry,readers:readers.map(r=>r.reference),selector:'actual guarded Node dirname(BASH_SOURCE)/validate-npm-audit.mjs'},eligible_owner_paths:[CI]};
 }
 return null;
}
function metadataCandidate(root,source,side,path,entry,read,git,purpose){
 const kind=nonExecutableChangeKind(path);if(!kind||entry?.profile!=='basic')return null;
 const input_facts=fixedInputFacts(root,{source,side,path,purpose,allowMissing:true},git,kind,kind);if(!input_facts)return null;
 if(kind==='reference_catalog_change'){
  let doc;try{doc=yaml.load(read(side,path).text,{schema:yaml.JSON_SCHEMA});}catch{return null;}
  if(path==='docs/registry/features/task.yml'&&!(doc?.system_id==='task'&&Array.isArray(doc.features)&&doc.features.length&&doc.features.every(f=>typeof f.feature_id==='string')))return null;
  if(path==='docs/registry/test-registry.yml'&&!(Array.isArray(doc?.tests)&&doc.tests.length&&doc.tests.every(t=>typeof t.test_id==='string')&&read(side,path).text.includes('[DEPRECATED]')))return null;
 }
 const row={kind,non_executable:true,input_facts,witness:{kind:kind==='documentation_change'?'sealed_basic_scope_document_classification':'reference_catalog_schema',entry,
  automatic_reader_execution:'not_evaluated',business_owner:'not_assigned'},execution_status:'not_evaluated',coverage:'unknown'};
 return {...row,metadata_witness_sha256:sha(JSON.stringify(canonical(row)))};
}
export function collectVerificationInputEvidence(root,{source,purpose='admission_only',readerPaths={base:[],head:[]}}){
 if(!readerPaths||Object.keys(readerPaths).sort().join(',')!=='base,head'||Object.values(readerPaths).some(rows=>!Array.isArray(rows)||rows.length>1000||new Set(rows).size!==rows.length||rows.some(p=>!location(p)||verificationInputKind(p)!=='test_source')))fail('READERS_INVALID');
 if(purpose!=='admission_only')fail('ADMISSION_ONLY');const git=checkedSource(root,source),read=supportReader(root,source,git),rows=[],states=[],metadata=[];
 const paths=source.changed_files.map(c=>c.path);
 for(const side of ['base','head']){
  const entry=unitEntry(read,side);
  for(const path of paths.filter(nonExecutableChangeKind)){const row=metadataCandidate(root,source,side,path,entry,read,git,purpose);if(row)metadata.push(row);}
  for(const path of paths.filter(p=>verificationInputKind(p))){
   const input_facts=fixedInputFacts(root,{source,side,path,purpose,allowMissing:true},git);
   if(!input_facts){states.push({path,side,selection_state:'absent'});continue;}
   const configs=unitConfigs(path);let reason=entry?'not_selected':'entry_unproven';
   const direct=runnerSelector(path,entry,paths),pinned=pinnedSelector(read,side,path)||configurationInput(read,side,path,entry)||securityInput(path,entry)||importedHelper(read,side,path,entry,paths,readerPaths[side])||auditedToolReader(read,side,path,entry,paths);
   if(direct||pinned){
    const evidence=pinned||{witness:{kind:direct.kind,component:direct.component,entry,selector:{path,regular_file:true}},eligible_owner_paths:[direct.owner,BASIC_RUNNER,CI]};
    const row={input_facts,...evidence,execution_status:'not_evaluated',coverage:'unknown'};
    rows.push({...row,input_witness_sha256:sha(JSON.stringify(canonical(row)))});reason='selected';
   }
   if(entry)for(const config of configs){
    if(!componentSelected(entry.profile,config.component,paths)){reason='component_not_selected';continue;}
    const file=read(side,config.path);if(!file){reason='config_missing';continue;}
    const package_entry=packageUnitEntry(read,side,entry,config);if(!package_entry){reason='package_entry_unproven';continue;}
    const skill=file.text.includes('skillSourceExcludes')?read(side,'scripts/ci/skill-source-tests.mjs'):null;let selected;
    try{selected=selectVitestVerificationInput({filePath:path,configPath:config.path,configText:file.text,component:config.component,skillText:skill?.text});}catch{reason='selector_unproven';continue;}
    if(!selected.selected){if(reason!=='selected')reason=selected.witness?.projects.some(p=>p.matched_exclude.length)?'excluded':'not_selected';continue;}
    const witness={kind:'vitest_config_input',component:config.component,component_selected:true,entry,package_entry,config:file.reference,
     ...(skill&&{skill_selector:skill.reference}),selector:selected.witness};
    const row={input_facts,witness,eligible_owner_paths:[config.path,...(entry.profile==='basic'?[BASIC_RUNNER]:[]),CI],execution_status:'not_evaluated',coverage:'unknown'};
    rows.push({...row,input_witness_sha256:sha(JSON.stringify(canonical(row)))});reason='selected';
   }
   states.push({path,side,selection_state:reason});
  }
 }
 checkedSource(root,source);
 const body={schema_version:1,purpose,evidence_kind:'derived_verification_input_candidates',source:structuredClone(source),rows,metadata_candidates:metadata,selection_states:states,
  unproven:states.filter(s=>!['selected','absent'].includes(s.selection_state)).map(({path,side,selection_state})=>({path,side,reason:selection_state})),
  entry_authorization:'declaration_only',native_owner_authorized:false,reader_paths:structuredClone(readerPaths),execution_status:'not_evaluated',coverage:'unknown'};
 return {...body,verification_inputs_sha256:sha(JSON.stringify(canonical(body)))};
}
export function verifyVerificationInputEvidence(root,{source,evidence,purpose='admission_only'}){
 if(!evidence||evidence.purpose!==purpose)fail('EVIDENCE_INVALID');
 const actual=collectVerificationInputEvidence(root,{source,purpose,readerPaths:evidence.reader_paths});
 if(JSON.stringify(canonical(actual))!==JSON.stringify(canonical(evidence)))fail('WITNESS_MISMATCH');return actual;
}

/** 非delta替代测试的实际entry证据；只可作为退休合同support，不能直接认领变更。 */
function entrySupportWitness(source,side,path,purpose,read,entry){
 if(!['base','head'].includes(side)||!location(path)||verificationInputKind(path)!=='test_source')fail('SUPPORT_LOCATION_INVALID');
 const selected=selectedReader(read,side,path,entry,source.changed_files.map(c=>c.path));if(!selected)return null;
 const body={schema_version:1,purpose,kind:'verification_entry_support',source:{...source,side,revision:source[side+'_revision']},input:selected.reader.reference,witness:selected.witness,
  eligible_owner_paths:selected.eligible_owner_paths,entry_execution_status:'not_evaluated',coverage:'unknown'};
 return {...body,entry_support_sha256:sha(JSON.stringify(canonical(body)))};
}
export function collectVerificationEntryWitness(root,{source,side,path,purpose='admission_only'}){
 if(purpose!=='admission_only')fail('ADMISSION_ONLY');
 const git=checkedSource(root,source),read=supportReader(root,source,git),result=entrySupportWitness(source,side,path,purpose,read,unitEntry(read,side));
 checkedSource(root,source);return result;
}
/** 固定目录候选不授资格；每个替代文件另行证明实际head默认CI配置输入。 */
export function collectVerificationRetirementEntryEvidence(root,{source,proof,purpose='admission_only'}){
 if(purpose!=='admission_only'||proof?.purpose!==purpose||JSON.stringify(canonical(proof.source))!==JSON.stringify(canonical(source)))fail('RETIREMENT_SOURCE_INVALID');
 const {retirement_candidates_sha256,...body}=proof;
 if(sha(JSON.stringify(canonical(body)))!==retirement_candidates_sha256||!Array.isArray(proof.rows)||proof.rows.length>10)fail('RETIREMENT_CANDIDATES_INVALID');
 const git=checkedSource(root,source),read=supportReader(root,source,git),entryHead=unitEntry(read,'head'),cache=new Map();
 const rows=proof.rows.map(row=>({path:row.path,replacement_entries:row.replacement_inputs.map(input=>{
  if(!cache.has(input.path))cache.set(input.path,entrySupportWitness(source,'head',input.path,purpose,read,entryHead));
  const entry=cache.get(input.path);
  if(!entry||entry.input.sha256!==input.sha256||entry.input.git_blob_sha1!==input.git_blob_sha1||entry.witness.config?.sha256!==input.config.sha256)return {path:input.path,entry:null};
  return {path:input.path,entry};
 })}));
 const result={schema_version:1,purpose,source:structuredClone(source),kind:'retirement_replacement_entry_candidates',retirement_candidates_sha256,rows,
  entry_verified:false,owner_verified:false,execution_status:'not_evaluated',coverage:'unknown'};
 checkedSource(root,source);
 return {...result,retirement_entry_candidates_sha256:sha(JSON.stringify(canonical(result)))};
}
export function verificationRetirementOwnerPaths(evidence){return [...new Set((evidence?.rows||[]).flatMap(r=>r.replacement_entries.flatMap(e=>e.entry?.eligible_owner_paths||[])))].sort();}
