/** 仅证明已审真实测试消费阶段入口；不改变业务执行、不声明实际模型或业务验收成功。 */
import {STAGE_ENVELOPES as REVIEWED, ISOLATION_STAGE_ENVELOPES, MERGE_STAGE_ENVELOPES} from './existing-ops-stage-envelopes.js';
import {nativeEvidenceStages,nativeStageTest,NATIVE_PROVENANCE_PATHS,NATIVE_HISTORY_PATH,nativeStaticEdges,nativeEvaluateEdges} from './existing-ops-native-evidence-source.js';
import {basicCiEnabledAt,collectBasicCiSources,BASIC_CI} from './existing-ops-workspace-source.js';
import {REVIEWED_STAGE_MODES,BASIC_CI_STAGE_MODE} from './existing-ops-stage-modes.js';
export const EXISTING_OPS_REPO_RULES_INPUT_SCHEMA=1;
const PREFIX='packages/brain/scripts/coding-workflow/';
const STAGES=['intent','spec','spec-review','verify','evaluate'];
const path=(kind,name)=>PREFIX+`${kind}/${name}.mjs`;
const canonical=value=>JSON.stringify(value,(key,item)=>['start','end','raw'].includes(key)?undefined:item);
const same=(a,b)=>canonical(a)===canonical(b);
const cache=new Map();
function reviewed(text,parse){if(!cache.has(text))cache.set(text,parse(text));return cache.get(text);}
const nodes=n=>!n||typeof n!=='object'?[]:[...(n.type?[n]:[]),...Object.values(n).flatMap(v=>Array.isArray(v)?v.flatMap(nodes):nodes(v))];
const call=(n,name)=>n?.type==='CallExpression'&&n.callee?.name===name;
const calls=(tree,name)=>nodes(tree).filter(n=>call(n,name));
const variable=(tree,name)=>nodes(tree).find(n=>n.type==='VariableDeclarator'&&n.id.name===name)?.init;
const property=(n,name)=>n?.properties?.find(p=>p.key?.name===name||p.key?.value===name)?.value;
const member=(n,object,name)=>n?.type==='MemberExpression'&&!n.computed&&n.object?.name===object&&n.property?.name===name;
const named=(tree,source,name)=>tree.body.some(n=>n.type==='ImportDeclaration'&&n.source.value===source&&n.specifiers.some(s=>s.type==='ImportSpecifier'&&s.imported.name===name&&s.local.name===name));
const literal=(n,value)=>n?.type==='Literal'&&n.value===value;
/** 版本判别是完整已审代码事实，任何缺失/混配/未知均不是旧版。 */
export function stageSourceVersion(sources,parse){
 if(nativeEvidenceStages(sources,parse))return 'native_evidence';
 const versions={legacy:REVIEWED.legacy,recorded:REVIEWED.recorded,isolation:{...REVIEWED.recorded,...ISOLATION_STAGE_ENVELOPES},source_merge:{...REVIEWED.recorded,...MERGE_STAGE_ENVELOPES}};
 try{return Object.keys(versions).find(version=>STAGES.every(s=>typeof sources[s]==='string'&&same(parse(sources[s]),reviewed(versions[version][s],parse))))??null;}catch{return null;}
}
const WITNESSES={
 intent:'payload.acceptance 优先：只写 payload 的条目',
 spec:'ok：completed，写出合法 02-spec.md，stdout 整体可解析为单个结果 JSON',
 'spec-review':'首轮评分全部 ≥7、无阻断/重要问题 → completed：02-review-r1.md 与 02-review.md 相同，outputs 带 gan 摘要',
 verify:'verify-pass：completed，outputs 为 04-evidence.md 与全部 I-n',
 evaluate:'全部 Q-n PASS → completed，qa.verdict PASS；用预览环境 URL；03/04 运行时被藏起、结束后放回',
};
const LOCAL='不查预览环境（预览不存在也照验），用 evaluate-local 提示词（WORKTREE、本仓生产口径），env.kind=local';
/** 完整AST限制所有setup/注册前置；这里额外锚定正常it与真实helper调用，不以存在/hash作证明。 */
function witness(tree,name){
 const found=[];
 function visit(body){for(const statement of body){const c=statement.expression;if(call(c,'describe'))visit(c.arguments[1]?.body?.body??[]);else if(call(c,'it')&&literal(c.arguments[0],name))found.push(c.arguments[1]);}}
 visit(tree.body);
 return found.length===1&&found[0].async&&found[0].params.length===0?found[0]:null;
}
function testConsumer(tree,stage){
 if(!named(tree,'./helpers/run-activity.mjs','runActivityProcess'))return false;
 const entry=variable(tree,'ENTRY');
 if(!callPathJoin(entry)||!literal(entry.arguments.at(-1),`../activities/${stage}.mjs`))return false;
 const w=witness(tree,WITNESSES[stage]);if(!w)return false;
 if(stage==='intent')return calls(w,'runActivityProcess').some(c=>c.arguments[0]?.name==='ENTRY');
 const run=variable(tree,'run');
 if(!run||!calls(run,'runActivityProcess').some(c=>c.arguments[0]?.name==='ENTRY')||!calls(w,'run').length)return false;
 if(stage==='evaluate'){
  const local=witness(tree,LOCAL),localCalls=calls(local,'run');
  if(localCalls.length!==1||property(localCalls[0].arguments[1],'repo_profile')?.name!=='ZJ')return false;
  if(calls(w,'run').length!==1||calls(w,'run')[0].arguments.length!==1)return false;
 }
 return true;
}
const callPathJoin=n=>n?.type==='CallExpression'&&member(n.callee,'path','join');
function isolationConsumer(tree){
 const begin=calls(tree,'beginEvaluateIsolation');
 const lifecycle=name=>nodes(tree).some(n=>n.type==='CallExpression'&&n.callee?.type==='MemberExpression'
  &&!n.callee.computed&&member(n.callee.object,'state','isolation')&&n.callee.property.name===name);
 return named(tree,'../lib/record-provenance.mjs','beginEvaluateIsolation')&&begin.length===1
  &&nodes(tree).some(n=>n.type==='AssignmentExpression'&&member(n.left,'state','isolation')&&n.right===begin[0])
  &&lifecycle('restore')&&lifecycle('abort');
}
function stageHandler(tree,stage){
 const entry=tree.body.at(-1)?.expression;
 if(entry?.type!=='AwaitExpression'||!call(entry.argument,'runActivity')||!named(tree,'../lib/protocol.mjs','runActivity'))return null;
 const [handler,options]=entry.argument.arguments;
 if(handler?.type!=='ArrowFunctionExpression'||!handler.async||handler.params.length!==1||handler.params[0].name!=='input'
  ||property(options,'stage')?.value!==stage.replace('-','_'))return null;
 return handler;
}
/** 已审CLI子证明保证loadPrompt真实read/render及runClaude原生转发；只锚定本阶段送入的prompt值。 */
function promptConsumer(tree,stage,handler){
 if(stage==='intent'||stage==='verify')return true; // 两者这里只证明Node活动入口，intent没有模型会话。
 if(!named(tree,'../lib/claude.mjs','loadPrompt')||!named(tree,'../lib/claude.mjs','runClaude'))return false;
 const prompt=variable(tree,'prompt');if(!call(prompt,'loadPrompt'))return false;
 if(stage==='spec'&&!literal(prompt.arguments[0],'spec'))return false;
 if(stage==='spec-review'){
  const selected=prompt.arguments[0],mapping=variable(tree,'PROMPTS');
  if(selected?.type!=='MemberExpression'||!selected.computed||selected.object.name!=='PROMPTS'||selected.property.name!=='role'
   ||!literal(property(mapping,'spec_review'),'spec-review')||!calls(handler,'runSession').some(c=>literal(c.arguments[1],'spec_review')))return false;
 }else if(stage==='evaluate'){
  const choice=prompt.arguments[0],local=variable(tree,'local');
  if(choice?.type!=='ConditionalExpression'||choice.test.name!=='local'||!literal(choice.consequent,'evaluate-local')||!literal(choice.alternate,'evaluate')
   ||local?.type!=='BinaryExpression'||local.operator!=='==='||!call(local.left,'qaMode')||!literal(local.right,'local')
   ||!member(local.left.arguments[0],'input','repo_profile')||!named(tree,'../lib/repo-profile.mjs','qaMode'))return false;
 }
 const native=calls(tree,'runClaude');
 return native.some(c=>{let args=property(c.arguments[0],'args');if(args?.type==='Identifier')args=variable(tree,args.name);
  return args?.type==='ArrayExpression'&&literal(args.elements[0],'-p')&&args.elements[1]?.name==='prompt';});
}
async function readStageInputs(readSource,revision){
 const entries={},tests={};
 for(const stage of STAGES){entries[stage]=await readSource(path('activities',stage),revision);tests[stage]=await readSource(PREFIX+`__tests__/${stage}.test.mjs`,revision);}
 return {entries,tests};
}

/** 已审完整 evaluate 之外，明确 SOURCE_PROVENANCE 从同任务/HEAD 自读并送入实际模板。 */
function mergeConsumer(tree,parse){
 if(!named(tree,'../runner/lib/source-provenance.mjs','sourceFacts'))return false;
 const source=variable(tree,'sourceProvenance'),prompt=variable(tree,'prompt');
 const expected=parse("const value = provenanceRequired(worktree) ? sourceFacts(worktree, { taskId: input.task_id, sprintDir }, input.head_sha || await headSha(worktree)) : null;").body[0].declarations[0].init;
 const projected=parse("const value = sourceProvenance ? JSON.stringify(sourceProvenance) : '本仓未接入来源凭证，不能据此宣称来源通过';").body[0].declarations[0].init;
 return same(source,expected)&&same(property(prompt?.arguments[1],'SOURCE_PROVENANCE'),projected);
}
/** 只在已选 evaluate 中登记；完整读取链由 supportProven 的 source_merge 子证明锁定。 */
function mergeReadEdges(edges,entry){
 const reader=PREFIX+'runner/lib/source-provenance.mjs',proof=PREFIX+'runner/lib/source-merge-proof.mjs';
 for(const [from,to] of [[entry,reader],[reader,proof],[reader,PREFIX+'lib/record-provenance.mjs'],[proof,PREFIX+'lib/record-provenance.mjs']])edges.push([from,to,'stage_source_provenance_read']);
 // 这些是模块真实静态导入，不声称其中每个导出函数已在本次 QA 执行。
 edges.push([reader,PREFIX+'lib/protocol.mjs','provenance_static_import_dependency']);
 for(const name of ['provenance-path','record-provenance-records','record-provenance-store'])edges.push([proof,PREFIX+'lib/'+name+'.mjs','provenance_static_import_dependency']);
 for(const name of ['source-merge','source-provenance','cifix','pr-branch','proc','qa-gate','repos'])edges.push([proof,PREFIX+'runner/lib/'+name+'.mjs','controller_identity_byte_input']);
}

/** supportProven/supportVersion来自唯一可信collector实际调用proveBuildSources，绝非候选声明。 */
export async function collectStageSources({parse,paths,selectors,read,readSource,revision,relations,requireProof,supportProven,supportVersion,supportHistory=false}){
 const selected=STAGES.filter(s=>{const p=PREFIX+`__tests__/${s}.test.mjs`;return paths.includes(p)&&selectors.include.some(r=>r.test(p))&&!selectors.exclude.some(r=>r.test(p));});
 const buildTest=PREFIX+'__tests__/build.test.mjs',buildSelected=paths.includes(buildTest)&&selectors.include.some(r=>r.test(buildTest))&&!selectors.exclude.some(r=>r.test(buildTest));
 if(!selected.length&&!buildSelected)return;
 let inputs,version,mode,versionedInputs=false;
 try{
  if(selected.length){
  inputs=await readStageInputs(readSource,revision);version=stageSourceVersion(inputs.entries,parse);
  if(!version||version!==supportVersion||!supportProven)throw Error('stage source combination');
  if(version==='legacy')return; // 旧已知完整组合不追加任何历史绑定。
  for(const stage of STAGES){
   const test=parse(inputs.tests[stage]),entry=parse(inputs.entries[stage]);
   const expectedTest=version==='native_evidence'?nativeStageTest(stage):REVIEWED.tests[stage];
   if(!same(test,reviewed(expectedTest,parse))||!testConsumer(test,stage)||!promptConsumer(entry,stage,stageHandler(entry,stage))||!stageHandler(entry,stage))throw Error('stage consumer');
   if(['isolation','source_merge','native_evidence'].includes(version)&&stage==='evaluate'&&!isolationConsumer(entry))throw Error('stage isolation consumer');
   if(['source_merge','native_evidence'].includes(version)&&stage==='evaluate'&&!mergeConsumer(entry,parse))throw Error('stage source reader consumer');
  }
  }else{
   // Old build-only trees did not declare this evidence protocol; preserve their frozen bindings.
   const own='packages/brain/src/lib/existing-ops-stage-source.js';
   const marked=paths.includes(own)&&(await readSource(own,revision)).includes('EXISTING_OPS_REPO_RULES_INPUT_SCHEMA');
   const reposPath=PREFIX+'repos.json',hint=paths.includes(reposPath)?JSON.parse(await readSource(reposPath,revision)):null;
   if(!marked&&!hint?.repos?.some(profile=>profile.key==='zenithjoy-skills'))return;
   if(!supportProven)throw Error('build source combination');version=supportVersion;
  }
  mode={};for(const p of Object.keys(REVIEWED.mode)){const text=await readSource(PREFIX+p,revision);mode[p]=p.endsWith('.json')?JSON.parse(text):parse(text);}
  // 接受完整旧模式或完整已审Skills扩展，禁止分别挑文件拼接成未知组合。
  const matches=expected=>Object.keys(expected).every(p=>same(mode[p],p.endsWith('.json')?JSON.parse(expected[p]):reviewed(expected[p],parse)));
  if(!REVIEWED_STAGE_MODES.some(matches)){
   if(!matches(BASIC_CI_STAGE_MODE)||!await basicCiEnabledAt({paths,readSource,revision,parse}))throw Error('stage mode');
   await collectBasicCiSources({read:async path=>{if(!paths.includes(path))throw Error('missing basic source');return readSource(path,revision);},ci:await readSource(BASIC_CI,revision),revision,relations:[],parse,paths});
  }
  const repos=mode['repos.json'].repos;
  if(repos.find(r=>r.key==='zenithjoy-workspace')?.preview?.type!=='local'||repos.find(r=>r.default)?.preview?.type!=='brain_preview')throw Error('stage modes');
  // The new reviewed Skills profile always declares these inputs; the marker also upgrades a new two-repo tree.
  versionedInputs=repos.some(profile=>profile.key==='zenithjoy-skills');
  const ownPath='packages/brain/src/lib/existing-ops-stage-source.js';
  if(paths.includes(ownPath)){
   const declarations=parse(await readSource(ownPath,revision)).body.filter(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.type==='VariableDeclaration')
    .flatMap(n=>n.declaration.declarations).filter(n=>n.id?.name==='EXISTING_OPS_REPO_RULES_INPUT_SCHEMA');
   if(declarations.length){if(declarations.length!==1||declarations[0].init?.type!=='Literal'||declarations[0].init.value!==1)throw Error('repo rules evidence schema');versionedInputs=true;}
  }
 }catch{requireProof(false,'native_stage_execution_unproven');return;}
 const edges=selected.length?[[PREFIX+'lib/protocol.mjs',PREFIX+'lib/activity-provenance.mjs','native_activity_provenance_handler'],[PREFIX+'lib/activity-provenance.mjs',PREFIX+'lib/record-provenance.mjs','native_record_provenance_context']]:[];
 if(versionedInputs){
  // The complete reviewed profile module proves repoRules' readFileSync(WORKFLOW_DIR, rules_prompt).
  if(selected.includes('spec')||buildSelected){
   for(const profile of mode['repos.json'].repos)edges.push([PREFIX+'lib/repo-profile.mjs',PREFIX+profile.rules_prompt,'reviewed_repo_rules_read']);
   if(selected.includes('spec'))edges.push([path('activities','spec'),PREFIX+'lib/repo-profile.mjs','stage_repo_rules_call']);
   if(buildSelected)edges.push([path('activities','build'),PREFIX+'lib/repo-profile.mjs','stage_repo_rules_call']);
  }
  if(buildSelected)
   edges.push([path('activities','build'),PREFIX+'lib/ci-precheck.mjs','reviewed_build_precheck_call']);
 }
 if(selected.length){
 for(const name of ['record-provenance-store','record-provenance-records','provenance-path'])edges.push([PREFIX+'lib/record-provenance.mjs',PREFIX+`lib/${name}.mjs`,'provenance_local_prehandler_dependency']);
 if(['isolation','source_merge','native_evidence'].includes(version))edges.push(
  [PREFIX+'lib/record-provenance.mjs',PREFIX+'lib/qa-isolation.mjs','provenance_static_import_dependency'],
  [PREFIX+'lib/qa-isolation.mjs',PREFIX+'lib/record-provenance-store.mjs','provenance_static_import_dependency']);
 if(version==='native_evidence'){
  for(const path of Object.values(NATIVE_PROVENANCE_PATHS))await read(path);
  if(supportHistory)await read(NATIVE_HISTORY_PATH);
  edges.push(...nativeStaticEdges(supportHistory));
 }
 if(selected.some(s=>s!=='intent'))edges.push([PREFIX+'lib/claude.mjs',PREFIX+'lib/record-provenance.mjs','native_pipe_provenance_capture']);
 }
 for(const stage of selected){
  const test=PREFIX+`__tests__/${stage}.test.mjs`,entry=path('activities',stage),helper=PREFIX+'__tests__/helpers/run-activity.mjs';
  edges.push([test,helper,'active_stage_test_helper'],[helper,entry,'native_stage_activity_spawn'],[entry,PREFIX+'lib/protocol.mjs','stage_named_handler_protocol']);
  if(stage!=='intent')edges.push([entry,PREFIX+'lib/claude.mjs','stage_named_cli_call']);
  const names=stage==='spec'?['spec']:stage==='spec-review'?['spec-review']:stage==='evaluate'?['evaluate','evaluate-local']:[];
  for(const name of names)edges.push([entry,PREFIX+`prompts/${name}.md`,'executed_stage_prompt_argument'],[PREFIX+'lib/claude.mjs',PREFIX+`prompts/${name}.md`,'stage_template_read_render']);
  if(stage==='evaluate')edges.push([test,PREFIX+'repos.json','active_local_mode_fixture_read'],[entry,PREFIX+'lib/repo-profile.mjs','stage_qa_mode_call'],[PREFIX+'lib/repo-profile.mjs',PREFIX+'runner/lib/repos.mjs','stage_default_profile_reader']);
  if(stage==='evaluate'&&['isolation','source_merge','native_evidence'].includes(version))edges.push([entry,PREFIX+'lib/record-provenance.mjs','stage_evaluate_isolation_lifecycle']);
  if(stage==='evaluate'&&['source_merge','native_evidence'].includes(version))mergeReadEdges(edges,entry);
  if(stage==='evaluate'&&version==='native_evidence')edges.push(...nativeEvaluateEdges(entry));
 }
 for(const [consumer_path,input_path,kind] of edges){await read(consumer_path);await read(input_path);if(!relations.some(r=>r.consumer_path===consumer_path&&r.input_path===input_path&&r.kind===kind&&r.revision===revision))relations.push({consumer_path,input_path,kind,revision});}
}
