/** 仅证明已审真实测试消费阶段入口；不改变业务执行、不声明实际模型或业务验收成功。 */
import {STAGE_ENVELOPES as STAGE_REVIEWED, ISOLATION_STAGE_ENVELOPES, MERGE_STAGE_ENVELOPES} from './existing-ops-stage-envelopes.js';
import {nativeEvidenceStages,nativeStageTest,NATIVE_PROVENANCE_PATHS,NATIVE_HISTORY_PATH,nativeStaticEdges,nativeEvaluateEdges} from './existing-ops-native-evidence-source.js';
import yaml from 'js-yaml';
import { createHash } from 'node:crypto';
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
const stageProperty=(n,name)=>n?.properties?.find(p=>p.key?.name===name||p.key?.value===name)?.value;
const member=(n,object,name)=>n?.type==='MemberExpression'&&!n.computed&&n.object?.name===object&&n.property?.name===name;
const named=(tree,source,name)=>tree.body.some(n=>n.type==='ImportDeclaration'&&n.source.value===source&&n.specifiers.some(s=>s.type==='ImportSpecifier'&&s.imported.name===name&&s.local.name===name));
const literal=(n,value)=>n?.type==='Literal'&&n.value===value;
/** 版本判别是完整已审代码事实，任何缺失/混配/未知均不是旧版。 */
export function stageSourceVersion(sources,parse){
 if(nativeEvidenceStages(sources,parse))return 'native_evidence';
 const versions={legacy:STAGE_REVIEWED.legacy,recorded:STAGE_REVIEWED.recorded,isolation:{...STAGE_REVIEWED.recorded,...ISOLATION_STAGE_ENVELOPES},source_merge:{...STAGE_REVIEWED.recorded,...MERGE_STAGE_ENVELOPES}};
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
  if(localCalls.length!==1||stageProperty(localCalls[0].arguments[1],'repo_profile')?.name!=='ZJ')return false;
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
  ||stageProperty(options,'stage')?.value!==stage.replace('-','_'))return null;
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
   ||!literal(stageProperty(mapping,'spec_review'),'spec-review')||!calls(handler,'runSession').some(c=>literal(c.arguments[1],'spec_review')))return false;
 }else if(stage==='evaluate'){
  const choice=prompt.arguments[0],local=variable(tree,'local');
  if(choice?.type!=='ConditionalExpression'||choice.test.name!=='local'||!literal(choice.consequent,'evaluate-local')||!literal(choice.alternate,'evaluate')
   ||local?.type!=='BinaryExpression'||local.operator!=='==='||!call(local.left,'qaMode')||!literal(local.right,'local')
   ||!member(local.left.arguments[0],'input','repo_profile')||!named(tree,'../lib/repo-profile.mjs','qaMode'))return false;
 }
 const native=calls(tree,'runClaude');
 return native.some(c=>{let args=stageProperty(c.arguments[0],'args');if(args?.type==='Identifier')args=variable(tree,args.name);
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
 return same(source,expected)&&same(stageProperty(prompt?.arguments[1],'SOURCE_PROVENANCE'),projected);
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
   const expectedTest=version==='native_evidence'?nativeStageTest(stage):STAGE_REVIEWED.tests[stage];
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
  mode={};for(const p of Object.keys(STAGE_REVIEWED.mode)){const text=await readSource(PREFIX+p,revision);mode[p]=p.endsWith('.json')?JSON.parse(text):parse(text);}
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
const fail = () => { throw Error('workspace_selector_unproven'); };
const key = property => property.key?.name ?? property.key?.value;
function property(object, name, required = true) {
  if (object?.type !== 'ObjectExpression' || object.properties.some(p => p.type !== 'Property' || p.computed || p.kind !== 'init')) fail();
  const matches = object.properties.filter(p => key(p) === name);
  if (matches.length > 1 || required && matches.length !== 1) fail();
  return matches[0]?.value;
}
function literals(node) {
  if (node?.type !== 'ArrayExpression' || node.elements.some(n => n?.type !== 'Literal' || typeof n.value !== 'string')) fail();
  return node.elements.map(n => n.value);
}
/** 源码保底协议 v1：只解释经过正反例审查的固定 Git 字节，绝不执行候选代码。 */
export const BASIC_CI = '.github/workflows/ci.yml';
export const BASIC_RUNNER = 'scripts/ci/run-basic-check.mjs';
export const SKILL_SELECTOR = 'scripts/ci/skill-source-tests.mjs';
const PINNED_READER = 'scripts/ci/__tests__/basic-skill-source-coverage.test.mjs';
const PINNED_WORKFLOW = '.github/workflows/skills-source-check.yml';
const SOURCE = 'packages/brain/src/lib/existing-ops-source.js';
const hash = text => createHash('sha256').update(text).digest('hex');
const sorted = x => Array.isArray(x) ? x.map(sorted) : x && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sorted(x[k])])) : x;
const workflowHash = text => hash(JSON.stringify(sorted(yaml.load(text))));
// 完整封印包括plan的组件集合/六分片、真实命令/退出码、scratch隔离和拒绝非success的汇总。
// 更新封印必须先重跑真实命令正反例；候选自己声明marker并不能修改受信任解析器内的封印。
// 仅现行main与经独立审查的新候选完整组可提供来源；历史组合不再授予入口资格。
const REVIEWED_CURRENT = {
  "packages/brain/vitest.config.js": "9566bd1cff449dc15ee924aea4c9f46aaa3457392fadf8cbf10d0b6556c2634e",
  "scripts/ci/basic-scope.mjs": "446605f2052c09c44c21bd2c9f8bcee206b3198be4d18858f1c8298ece0be726",
  "scripts/ci/run-basic-check.mjs": "10e030617fb6ca219bd4965afa2566213f8788bc4e3741d3e7b3d7ebf5e45918",
  "scripts/ci/check-basic-results.mjs": "084cc7187734c0dd83dddb528d87aa16d3ed9a49c3ea0eebf2c97cb4c4775da3",
  "scripts/ci/basic-runtime-smoke.mjs": "b386b8c0c8631de5b6a0eec19494835f48c6ca3822a4533ee154ce8767a21eec",
  "scripts/ci/ops-checks.mjs": "a5eb851d2f526e940432563a70e8a82fb0f128d66a8104515fec530974a55f6b",
  "scripts/ci/run-isolated-staging-smoke.mjs": "fa19da1eaf14621a75d95763229fa8d6de40ce3e55940401458346da37f8fbaf",
  "scripts/ci/skill-source-tests.mjs": "dbb749f30271472fe1f24e1eec2215d7b5999f20c1d4ed74c00fd4b40f6c57c8",
  "apps/api/vitest.config.ts": "6f4d8288dd391a8212c1bc22d434f8c4053f76099df2beb692693b1c80512b33",
  "scripts/ci/__tests__/basic-skill-source-coverage.test.mjs": "acc2046d6691423b739edc4071c9ea87f00e57a1a8b7a06be91d5487d24ad2c9",
  "scripts/ci/check-brain-version-bump.sh": "361c35c33c2d0d404d9365c51478212e50ebe84df6a65eacca473ea57bffa0eb",
  ".github/actions/skills-source/action.yml": "283a44569b4b037d11ebbac624f91ed013ab91be4916182a87a2bf95078ec105",
  "scripts/ci/check-skill-source-identity.py": "ebc6b90fbe187b49c31101a5dba997d133fd45825cfcaa3549aad30581d747c1",
  "scripts/ci/__tests__/basic-skill-identity.test.mjs": "1666a389a01a450bbe2ed14f15abc77dfa00d59ff77cc7aeb08d628cf52d343b",
  "scripts/ci/check-w19-frozen.mjs": "9e3a937e951e712934f8268a3af237b8ba3689d68f42fc9de10bf1b6e3b3ca7b",
  "scripts/ci/__tests__/basic-w19-freeze.test.mjs": "127bfd50494259a78e2f3649c399596fc94acc90a3db17c43077a6ea47cf785a",
  "playground/package-lock.json": "e2fa656e54b0d2d4f8c7398c24651589ff1556ffabbcec368465ff19d12bb6e9",
  "playground/package.json": "9c340ea6eae6af3ad2cf7e41b003141193dbe6369451529e40deb41dd786e85d",
  "playground/server.js": "c77d87096634b48a699c3951a07e0a74609535454f38078b97a0b35f87cfd38e",
  "playground/tests/echo.test.js": "1fb291fdb3de19aca4cbfe5c61ef1571867b720dd4ec2378b169236ab652d7be",
  "playground/tests/kernel-e.test.js": "53c24290c95377b88ab497c5c50f2246fc9accedb6f298c0b484dfb630211ecf",
  "playground/tests/ping.test.js": "d364c15e08f487c70a312c1299a1b02758d935fb4f395a64992456c8fb09eb62",
  "playground/tests/server.test.js": "b6b0628c4435d5a69de002207a35a34c713bda7897505586f501c7048c4adbf8",
  "playground/vitest.config.js": "e6b279b6d857f890dfa2b3a84deb4f52d2d9e9300bdfaf392ebf94f258f6e204",
  "scripts/ci/run-skill-source-check.mjs": "debcaf26aa7025f47d846052e0c2b43d1a04976003936143d80ddac1582d7204",
  "apps/dashboard/vitest.config.ts": "a5899ed07ee4aa8ff262f7da361d695ef8eb26005571c5e09988aac53c1cc261",
  "scripts/ci/prepare-ubuntu-archive.mjs": "ca83d00df2f865fc1836e0f8841bc5f4ba7ddf57416b6f718855f5840205311b",
  "scripts/ci/__tests__/basic-ubuntu-archive.test.mjs": "525456457c116c91aba038f35916352abed5ec38a0aa7c5287fd263ef9ffb175"
};
const REVIEWED_CANDIDATE = {
  "packages/brain/vitest.config.js": "9566bd1cff449dc15ee924aea4c9f46aaa3457392fadf8cbf10d0b6556c2634e",
  "scripts/ci/basic-scope.mjs": "446605f2052c09c44c21bd2c9f8bcee206b3198be4d18858f1c8298ece0be726",
  "scripts/ci/run-basic-check.mjs": "10e030617fb6ca219bd4965afa2566213f8788bc4e3741d3e7b3d7ebf5e45918",
  "scripts/ci/check-basic-results.mjs": "084cc7187734c0dd83dddb528d87aa16d3ed9a49c3ea0eebf2c97cb4c4775da3",
  "scripts/ci/basic-runtime-smoke.mjs": "b386b8c0c8631de5b6a0eec19494835f48c6ca3822a4533ee154ce8767a21eec",
  "scripts/ci/ops-checks.mjs": "a5eb851d2f526e940432563a70e8a82fb0f128d66a8104515fec530974a55f6b",
  "scripts/ci/run-isolated-staging-smoke.mjs": "fa19da1eaf14621a75d95763229fa8d6de40ce3e55940401458346da37f8fbaf",
  "scripts/ci/skill-source-tests.mjs": "dbb749f30271472fe1f24e1eec2215d7b5999f20c1d4ed74c00fd4b40f6c57c8",
  "apps/api/vitest.config.ts": "dbb1e74af497db63cbd2326c5378bb05ca036e1a4590dc2061dce2e5257e776a",
  "scripts/ci/__tests__/basic-skill-source-coverage.test.mjs": "acc2046d6691423b739edc4071c9ea87f00e57a1a8b7a06be91d5487d24ad2c9",
  "scripts/ci/check-brain-version-bump.sh": "361c35c33c2d0d404d9365c51478212e50ebe84df6a65eacca473ea57bffa0eb",
  ".github/actions/skills-source/action.yml": "f106e23e090e1fd1aca6c035f63478365cf4aae2e6b4f2d379569c0a22f18169",
  "scripts/ci/check-skill-source-identity.py": "ebc6b90fbe187b49c31101a5dba997d133fd45825cfcaa3549aad30581d747c1",
  "scripts/ci/__tests__/basic-skill-identity.test.mjs": "151af50620164e01f9e112746aa81adc0efe2e2b46857dae09c5c4c8f7fdd423",
  "scripts/ci/check-w19-frozen.mjs": "9e3a937e951e712934f8268a3af237b8ba3689d68f42fc9de10bf1b6e3b3ca7b",
  "scripts/ci/__tests__/basic-w19-freeze.test.mjs": "127bfd50494259a78e2f3649c399596fc94acc90a3db17c43077a6ea47cf785a",
  "playground/package-lock.json": "e2fa656e54b0d2d4f8c7398c24651589ff1556ffabbcec368465ff19d12bb6e9",
  "playground/package.json": "9c340ea6eae6af3ad2cf7e41b003141193dbe6369451529e40deb41dd786e85d",
  "playground/server.js": "c77d87096634b48a699c3951a07e0a74609535454f38078b97a0b35f87cfd38e",
  "playground/tests/echo.test.js": "1fb291fdb3de19aca4cbfe5c61ef1571867b720dd4ec2378b169236ab652d7be",
  "playground/tests/kernel-e.test.js": "53c24290c95377b88ab497c5c50f2246fc9accedb6f298c0b484dfb630211ecf",
  "playground/tests/ping.test.js": "d364c15e08f487c70a312c1299a1b02758d935fb4f395a64992456c8fb09eb62",
  "playground/tests/server.test.js": "b6b0628c4435d5a69de002207a35a34c713bda7897505586f501c7048c4adbf8",
  "playground/vitest.config.js": "e6b279b6d857f890dfa2b3a84deb4f52d2d9e9300bdfaf392ebf94f258f6e204",
  "scripts/ci/run-skill-source-check.mjs": "debcaf26aa7025f47d846052e0c2b43d1a04976003936143d80ddac1582d7204",
  "apps/dashboard/vitest.config.ts": "a5899ed07ee4aa8ff262f7da361d695ef8eb26005571c5e09988aac53c1cc261",
  "scripts/ci/prepare-ubuntu-archive.mjs": "ca83d00df2f865fc1836e0f8841bc5f4ba7ddf57416b6f718855f5840205311b",
  "scripts/ci/__tests__/basic-ubuntu-archive.test.mjs": "525456457c116c91aba038f35916352abed5ec38a0aa7c5287fd263ef9ffb175",
  "scripts/skill_source_ownership.py": "20fca16bcf474588e9e4d0add00a66c5885b3d85a82275fb9082a0787e72b9a7"
};
const BASIC_PROTOCOLS = {"3636a0489fdc4ce2d9a362db0d635774b13f222d8c3d14939751460a2637faa7":[REVIEWED_CURRENT,REVIEWED_CANDIDATE]};
const reject = () => { throw Error('basic_ci_source_unproven'); };
export function basicCiSelectorEnabled(text, parse) {
  const name = 'EXISTING_OPS_BASIC_CI_SELECTOR_SCHEMA';
  const declarations = parse(text).body.flatMap(row => {
    const statement = row.type === 'ExportNamedDeclaration' ? row.declaration : row;
    return (statement?.declarations || []).filter(d => d.id?.name === name).map(d => ({ row, statement, d }));
  });
  if (!declarations.length) return false;
  const [{ row, statement, d }] = declarations;
  if (declarations.length !== 1 || row.type !== 'ExportNamedDeclaration' || statement.kind !== 'const' || d.init?.type !== 'Literal' || ![0, 1].includes(d.init.value)) reject();
  return d.init.value === 1;
}
export async function basicCiEnabledAt({ paths, readSource, revision, parse }) {
  return paths.includes(SOURCE) && basicCiSelectorEnabled(await readSource(SOURCE, revision), parse);
}
export function basicCiWorkflowProven(text) {
  return Object.hasOwn(BASIC_PROTOCOLS, workflowHash(text));
}
/** 返回明确的排除字面量；不调用外置helper，也不将动态JS猜为选择器。 */
export function skillSourceLiteralExcludes(text, component, parse) {
  if (![REVIEWED_CURRENT[SKILL_SELECTOR],REVIEWED_CANDIDATE[SKILL_SELECTOR]].includes(hash(text))) reject();
  const program = parse(text), object = name => program.body.find(n => n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'VariableDeclaration'
    && n.declaration.declarations.some(d => d.id.name === name))?.declaration.declarations.find(d => d.id.name === name)?.init;
  const literals = (node, name) => {
    const value = node?.properties?.find(p => (p.key.name ?? p.key.value) === name)?.value;
    if (!value) return [];
    if (value.type !== 'ArrayExpression' || value.elements.some(n => n?.type !== 'Literal' || typeof n.value !== 'string')) reject();
    return value.elements.map(n => n.value);
  };
  const tests = object('SKILL_SOURCE_TESTS'), retired = object('RETIRED_SKILL_TESTS');
  return [...literals(tests, component), ...literals(retired, component), ...(component === 'brain' ? literals(tests, 'root').map(p => '../../' + p) : [])];
}
export function skillExcludeSpread(node, program, component) {
  if (node?.type !== 'SpreadElement' || node.argument?.type !== 'CallExpression' || node.argument.callee?.name !== 'skillSourceExcludes'
    || node.argument.arguments.length !== 1 || node.argument.arguments[0]?.value !== component) return false;
  const imports = program.body.filter(n => n.type === 'ImportDeclaration' && n.source.value === '../../scripts/ci/skill-source-tests.mjs');
  return imports.length === 1 && imports[0].specifiers.length === 1 && imports[0].specifiers[0].imported?.name === 'skillSourceExcludes'
    && imports[0].specifiers[0].local.name === 'skillSourceExcludes'
    && !program.body.some(n => n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === 'skillSourceExcludes'));
}
/** 仅解释已封印Deep的integration目录glob；dot默认关闭，显式排除任意层node_modules。 */
export function deepPostgresDirectorySelected(path) {
  const prefix = 'packages/brain/src/';
  if (typeof path !== 'string' || !path.startsWith(prefix)) return false;
  const segments = path.slice(prefix.length).split('/');
  if (segments.some(segment => !segment || segment.startsWith('.') || segment === 'node_modules')) return false;
  return segments.slice(0, -1).includes('integration')
    && /\.(?:test|spec)\.(?:[cm])?[jt]s(?:x)?$/.test(segments.at(-1));
}
export async function collectBasicCiSources({ read, ci, revision, relations, parse, paths }) {
  let protocol;
  for (const candidate of [BASIC_PROTOCOLS[workflowHash(ci)]].flat().filter(Boolean)) {
    let matches = true;
    for (const [path, digest] of Object.entries(candidate)) if (hash(await read(path)) !== digest) { matches = false; break; }
    if (matches) { protocol = candidate; break; }
  }
  if (!protocol) reject();
  const relation = (consumer_path, input_path, kind) => relations.push({ consumer_path, input_path, kind, revision }); const skillWorkflow = Object.hasOwn(protocol, PINNED_WORKFLOW) ? PINNED_WORKFLOW : BASIC_CI;
  if (Object.hasOwn(protocol, PINNED_READER)) {
    if (!Array.isArray(paths)) reject();
    const prefix = 'scripts/ci/__tests__/';
    const testName = /^(basic-.*|run-basic-check|brain-source-only-deploy)\.test\.mjs$/;
    for (const path of paths.filter(path => path.startsWith(prefix))) {
      const relative = path.slice(prefix.length);
      // Git列出的是叶子；同名目录会让旧node --test递归执行，不能当作一级文件集合认领。
      if (relative.includes('/') && testName.test(relative.split('/')[0])) reject();
    }
    const selected = paths.filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/')
      && testName.test(path.slice(prefix.length))).sort();
    if (!selected.includes(PINNED_READER)) reject();
    for (const path of selected) {
      if (!await read(path)) reject();
      relation(BASIC_RUNNER, path, 'reviewed_scripts_node_test_selector');
    }
    // 完整已审reader证明真实URL读取；这条边只声明验证输入，绝不宣称私有源workflow已运行。
    relation(PINNED_READER, skillWorkflow, 'literal_url_workflow_verification_input');
  }
  const frozenW19 = 'scripts/ci/check-w19-frozen.mjs';
  if (Object.hasOwn(protocol, frozenW19)) {
    const regression = 'scripts/ci/__tests__/basic-w19-freeze.test.mjs';
    if (!Array.isArray(paths) || !paths.includes(frozenW19) || !paths.includes(regression)) reject();
    const historical = path => path.startsWith('playground/') && !/\.md$/i.test(path);
    const expected = Object.keys(protocol).filter(historical), selected = paths.filter(historical);
    if (selected.length !== expected.length || selected.some(path => !expected.includes(path))) reject();
    relation(BASIC_RUNNER, frozenW19, 'historical_w19_freeze_guard');
    for (const path of selected) relation(frozenW19, path, 'frozen_historical_w19_input');
  }
  const identity = 'scripts/ci/check-skill-source-identity.py'; if (Object.hasOwn(protocol, 'scripts/ci/prepare-ubuntu-archive.mjs')) relation(BASIC_CI, 'scripts/ci/prepare-ubuntu-archive.mjs', 'official_ubuntu_archive_preparation');
  if (Object.hasOwn(protocol, identity)) {
    relation(skillWorkflow, '.github/actions/skills-source/action.yml', 'registered_skill_identity_composite');
    relation('.github/actions/skills-source/action.yml', identity, 'pre_fetch_registered_ssh_identity_guard');
    if(Object.hasOwn(protocol,'scripts/skill_source_ownership.py')) relation('.github/actions/skills-source/action.yml','scripts/skill_source_ownership.py','registered_skill_ownership_resolver');
  }
  for (const [path, kind] of [['scripts/ci/basic-scope.mjs', 'required_basic_ci_plan'], [BASIC_RUNNER, 'required_basic_ci_matrix_runner'],
    ['scripts/ci/check-basic-results.mjs', 'required_basic_ci_success_aggregate']]) relation(BASIC_CI, path, kind);
  if (Object.hasOwn(protocol, 'scripts/ci/check-brain-version-bump.sh')) {
    relation(BASIC_CI, 'scripts/ci/check-brain-version-bump.sh', 'required_brain_version_increment_guard');
  }
  for (const path of ['scripts/ci/basic-runtime-smoke.mjs', 'packages/brain/src/migrate.js', 'scripts/ci/__tests__/runtime-signal.integration.test.mjs']) {
    await read(path); relation(BASIC_RUNNER, path, 'isolated_scratch_runtime_check');
  }
  for (const [consumer, input] of [[BASIC_RUNNER, 'scripts/ci/ops-checks.mjs'], ['scripts/ci/ops-checks.mjs', 'scripts/ci/run-isolated-staging-smoke.mjs']]) relation(consumer, input, 'reviewed_basic_ci_named_call');
  for (const path of ['package.json', 'package-lock.json']) { await read(path); relation(BASIC_CI, path, 'root_npm_ci_manifest_input'); }
  await read('packages/brain/vitest.config.js');
  relation(BASIC_RUNNER, 'packages/brain/vitest.config.js', 'complete_brain_unit_six_shards');
  relation('packages/brain/vitest.config.js', SKILL_SELECTOR, 'reviewed_skill_source_exclusion');
  relation(BASIC_RUNNER, 'apps/api/vitest.config.ts', 'dashboard_features_unit_config');
  return skillSourceLiteralExcludes(await read(SKILL_SELECTOR), 'brain', parse);
}
/** Deep全PG仅接受现行完整Nightly/config pair，不声明普通PR已执行。 */
export async function collectDeepCiSources({ read, revision, relations }) {
  const workflow = '.github/workflows/nightly-regression.yml', config = 'scripts/ci/deep-integration.config.mjs';
  const protocols = [["b04448b7b47a1893c53a0fecf4e0f81c26611377982e7b12c6e60fe096e8348c","f5b94e5075d47fa2ad47788340d17d6705456c4272cd08cd81ee5b3e1ca5e560"]];
  const pair = [workflowHash(await read(workflow)), hash(await read(config))];
  if (!protocols.some(candidate => candidate.every((digest, index) => digest === pair[index]))) reject();
  relations.push({ consumer_path: workflow, input_path: config, kind: 'scheduled_or_manual_full_postgres_entry', revision },
    { consumer_path: config, input_path: 'packages/brain/vitest.config.js', kind: 'shared_postgres_literal_config', revision });
}
export { property, literals, fail };
