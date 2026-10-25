import {collectStageSources} from './existing-ops-stage-source.js';
/** 固定 build/publish 测试的只读执行来源证明；不执行候选程序。 */
// 封套取自正式 Git 2eb4d0557365befafed1953140c9c47e20bab495。
// 仅作 AST 对照数据，不执行：runActivityProcess/baseEnv、runActivity/childEnv、
// runClaude 的 provider/isolateRemote 分支、loadPrompt/renderPrompt、withModel/openSink/claudeTimeoutMs、
// build main 至首次 runClaude 的前缀、spawnClaude 至真正 spawn 的前缀。
// 不冻结整个 build main；额外模板字段仅接受已审 INTENT_PATH。未知结构变化失败关闭，需显式重审。
import { createRequire } from 'node:module';
import { ENVELOPES } from './existing-ops-build-envelopes.js';
import { PROVENANCE_SOURCE_PATHS, readProvenanceSources, normalizeProvenanceBuild, normalizeProvenancePublish, provenanceSourceVersion } from './existing-ops-provenance-envelope.js';
import { NATIVE_PROVENANCE_PATHS, NATIVE_HISTORY_PATH, nativeEvidenceForwarding, nativeStaticEdges } from './existing-ops-native-evidence-source.js';
export { buildSelectorEnabled } from './existing-ops-build-envelopes.js';
const requireAcorn = createRequire(import.meta.url);
function parseEnvelope(text) { return requireAcorn('acorn').parse(text, { ecmaVersion: 'latest', sourceType: 'module' }); }
const PREFIX = 'packages/brain/scripts/coding-workflow/';
export const BUILD_SOURCE_PATHS = Object.freeze({ test: PREFIX+'__tests__/build.test.mjs', helper: PREFIX+'__tests__/helpers/run-activity.mjs', activity: PREFIX+'activities/build.mjs', cli: PREFIX+'lib/claude.mjs', protocol: PREFIX+'lib/protocol.mjs', prompt: PREFIX+'prompts/build.md', fake: PREFIX+'__tests__/fixtures/fake-claude.mjs' });
const canonical = value => JSON.stringify(value, (key,item) => ['start','end','raw'].includes(key) ? undefined : item);
const declaration = node => node?.type === 'ExportNamedDeclaration' ? node.declaration : node;
function walk(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node,parent);
  for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(n=>walk(n,visit,node)); else if (value && typeof value === 'object') walk(value,visit,node);
}
function nodes(node) { const result=[]; walk(node,n=>result.push(n)); return result; }
function bound(node) {
  if (!node) return [];
  if (node.type==='Identifier') return [node.name];
  if (node.type==='AssignmentPattern') return bound(node.left);
  if (node.type==='RestElement') return bound(node.argument);
  if (node.type==='ArrayPattern') return node.elements.flatMap(bound);
  if (node.type==='ObjectPattern') return node.properties.flatMap(p=>bound(p.type==='RestElement'?p.argument:p.value));
  return [];
}
const member=(n,o,p)=>n?.type==='MemberExpression'&&!n.computed&&n.object?.name===o&&n.property?.name===p;
const call=(n,name)=>n?.type==='CallExpression'&&n.callee?.name===name;
const variable=(tree,name)=>nodes(tree).filter(n=>n.type==='VariableDeclarator'&&n.id?.name===name);
const fn=(tree,name)=>tree.body.map(declaration).find(n=>n?.type==='FunctionDeclaration'&&n.id?.name===name);
const same=(a,b)=>canonical(a)===canonical(b);

/** 保护真实执行对象：拒动态全局入口、对象逃逸/变更、导入遮蔽及关键绑定再赋值。 */
function intact(tree, additional=[], allowedMutations=[], allowedEnvAliases=[]) {
  const imports=tree.body.filter(n=>n.type==='ImportDeclaration').flatMap(n=>n.specifiers.map(s=>s.local.name));
  const objects=['process','path','fs','spawn','Promise','it','describe'];
  const protectedNames=[...imports,...additional];
  const touches=n=>nodes(n).some(x=>x.type==='Identifier'&&[...objects,...protectedNames].includes(x.name));
  let ok=true;
  walk(tree,(n,parent)=>{
    if (n.type==='Identifier'&&['eval','Function','global','globalThis','Reflect'].includes(n.name)) ok=false;
    if (n.type==='MemberExpression'&&['constructor','prototype','__proto__'].includes(n.computed?n.property?.value:n.property?.name))ok=false;
    if (n.type==='VariableDeclarator'&&bound(n.id).some(name=>imports.includes(name))) ok=false;
    if(n.type==='FunctionDeclaration'&&(imports.includes(n.id?.name)||additional.includes(n.id?.name)&&!['Program','ExportNamedDeclaration'].includes(parent?.type)))ok=false;
    if(member(n,'process','env')&&!allowedEnvAliases.includes(n)) {
      const copied=parent?.type==='SpreadElement';
      const read=parent?.type==='MemberExpression'&&parent.object===n;
      const clone=call(parent,'childEnv')&&parent.arguments[0]===n;
      if(!copied&&!read&&!clone)ok=false;
    }
    if (['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type)&&n.params.flatMap(bound).some(name=>protectedNames.includes(name)||objects.includes(name))) ok=false;
    if (n.type==='CatchClause'&&bound(n.param).some(name=>protectedNames.includes(name)||objects.includes(name))) ok=false;
    if (!allowedMutations.includes(n)&&['AssignmentExpression','UpdateExpression','UnaryExpression'].includes(n.type)&&(n.type!=='UnaryExpression'||n.operator==='delete')&&touches(n.left??n.argument)) ok=false;
    if (n.type==='CallExpression'&&n.callee?.object?.name==='Object'&&['assign','defineProperty','defineProperties','setPrototypeOf'].includes(n.callee.property?.name)) ok=false;
    if (n.type==='Identifier'&&objects.includes(n.name)) {
      const imported=parent?.type?.startsWith('Import');
      const propertyKey=parent?.type==='Property'&&parent.key===n&&!parent.computed&&!parent.shorthand;
      const memberKey=parent?.type==='MemberExpression'&&parent.property===n&&!parent.computed;
      const read=parent?.type==='MemberExpression'&&parent.object===n&&!parent.computed;
      const invoke=['CallExpression','NewExpression'].includes(parent?.type)&&parent.callee===n&&['spawn','Promise','it','describe'].includes(n.name);
      if (!imported&&!propertyKey&&!memberKey&&!read&&!invoke) ok=false;
    }
  });
  return ok;
}
function moduleEnvelope(tree,key,_parse) {
  const actualImports=tree.body.filter(n=>n.type==='ImportDeclaration').filter(n=>!(key==='activity'&&n.source.value==='../lib/spec-check.mjs'&&n.specifiers.length===1&&n.specifiers[0].imported?.name==='INTENT_FILE'&&n.specifiers[0].local.name==='INTENT_FILE'));
  const constants=tree.body.filter(n=>declaration(n)?.type==='VariableDeclaration');
  return same(actualImports,parseEnvelope(ENVELOPES[key+'Imports']).body)&&same(constants,parseEnvelope(ENVELOPES[key+'Constants']).body)
    && tree.body.every(n=>['ImportDeclaration','VariableDeclaration','FunctionDeclaration'].includes(n.type)||n.type==='ExportNamedDeclaration'&&!n.source&&['VariableDeclaration','FunctionDeclaration'].includes(n.declaration?.type)||key==='activity'&&same(n,parseEnvelope(ENVELOPES.entry).body[0])||['test','publishTest'].includes(key)&&call(n.expression,'describe'));
}
/** 固定调用边的 named imports 必须链接到目标的真实公开函数，存在私有同名函数不够。 */
function namedFunctionsLink(consumer,provider,source) {
  const imports=consumer.body.filter(n=>n.type==='ImportDeclaration'&&n.source.value===source);
  const exported=new Set(provider.body.filter(n=>n.type==='ExportNamedDeclaration'&&!n.source&&n.declaration?.type==='FunctionDeclaration').map(n=>n.declaration.id.name));
  return imports.length===1&&imports[0].specifiers.length>0&&imports[0].specifiers.every(n=>n.type==='ImportSpecifier'&&exported.has(n.imported.name));
}
function functionMatches(tree,name,_parse) { return same(fn(tree,name),parseEnvelope(ENVELOPES[name]).body[0]); }
function registration(n) {
  if(n?.type!=='CallExpression')return false;
  if(['beforeAll','beforeEach','afterEach','it','describe'].includes(n.callee?.name))return true;
  if(n.callee?.type==='MemberExpression'&&n.callee.object?.name==='it'&&!n.callee.computed&&['skip','todo','only'].includes(n.callee.property?.name))return true;
  return n.callee?.type==='CallExpression'&&member(n.callee.callee,'it','each')&&n.callee.arguments.length===1&&n.callee.arguments[0]?.type==='ArrayExpression';
}
/** 注册期只允许已有 setup、惰性函数、字面量数据与测试登记；不执行任意初始化。 */
function registrationBody(body, root = false, inherited = new Set()) {
  const values=new Set(inherited);
  const pure=n=>!n||['Literal','ArrowFunctionExpression','FunctionExpression'].includes(n.type)
    ||n.type==='Identifier'&&values.has(n.name)
    ||n.type==='TemplateLiteral'&&n.expressions.every(pure)
    ||n.type==='ArrayExpression'&&n.elements.every(pure)
    ||n.type==='ObjectExpression'&&n.properties.every(p=>p.type==='Property'&&!p.computed&&!p.method&&p.kind==='init'&&pure(p.value));
  for(const statement of body) {
    if(statement.type==='VariableDeclaration') {
      // 根层声明已逐字 AST 对照；嵌套注册只允许无调用的有限数据/函数初始化。
      for(const d of statement.declarations) {
        if(d.id.type!=='Identifier'||(!root&&!pure(d.init)))return false;
        if(d.init?.type==='Literal')values.add(d.id.name);
      }
      continue;
    }
    if(statement.type==='FunctionDeclaration')continue;
    if(statement.type!=='ExpressionStatement'||!registration(statement.expression))return false;
    const expr=statement.expression;
    if(call(expr,'describe')) {
      const callback=expr.arguments[1];
      if(expr.arguments.length!==2||expr.arguments[0]?.type!=='Literal'||typeof expr.arguments[0].value!=='string'||callback?.type!=='ArrowFunctionExpression'||callback.async||callback.params.length||callback.body.type!=='BlockStatement'||!registrationBody(callback.body.body,false,values))return false;
    } else if(['beforeAll','beforeEach','afterEach'].includes(expr.callee?.name)) {
      if(!root)return false; // 仅根层已审的固定 setup，未知嵌套 hook 不作活跃证明。
    } else {
      // it.each 的表格在注册时求值，拒调用、spread 或带 getter 的数据。
      if(expr.callee.type==='CallExpression'&&!pure(expr.callee.arguments[0]))return false;
      if(expr.arguments[0]?.type!=='Literal'||typeof expr.arguments[0].value!=='string'||!['ArrowFunctionExpression','FunctionExpression'].includes(expr.arguments[1]?.type))return false;
      if(expr.arguments.length>2&&expr.arguments.slice(2).some(n=>n.type!=='Literal'))return false;
    }
  }
  return true;
}
function testSetup(tree,key,body,_parse) {
  const rootOf=n=>n?.type==='Identifier'?n.name:n?.type==='MemberExpression'?rootOf(n.object):n?.type==='CallExpression'?rootOf(n.callee):null;
  if(nodes(tree).some(n=>n.type==='MemberExpression'&&['it','describe'].includes(rootOf(n))&&(n.computed?n.property?.value:n.property?.name)==='only'))return false;
  // 测试文件无需进程控制入口；即使藏于先行测试或别名读取也不认领后续 witness。
  if(nodes(tree).some(n=>n.type==='MemberExpression'&&n.object?.name==='process'&&(n.computed?n.property?.value:n.property?.name)!=='env'))return false;
  const hooks=body.filter(n=>n.type==='ExpressionStatement'&&['beforeAll','beforeEach','afterEach'].includes(n.expression?.callee?.name));
  return same(hooks,parseEnvelope(ENVELOPES[key+'Hooks']).body)&&same(body.filter(n=>n.type==='VariableDeclaration'),parseEnvelope(ENVELOPES[key+'Declarations']).body)&&registrationBody(body,true);
}
function testWitness(tree,parse) {
  const top=tree.body.filter(n=>n.type==='ExpressionStatement');
  if(top.length!==1||!call(top[0].expression,'describe'))return false;
  const group=top[0].expression.arguments;
  if(group.length!==2||group[0]?.type!=='Literal'||typeof group[0].value!=='string'||group[1]?.type!=='ArrowFunctionExpression'||group[1].async||group[1].params.length!==0||group[1].body?.type!=='BlockStatement')return false;
  const body=group[1].body.body;
  if(!testSetup(tree,'test',body,parse))return false;
  if(body.some(n=>!['VariableDeclaration','ExpressionStatement'].includes(n.type)))return false;
  if(body.some(n=>n.type==='ExpressionStatement'&&!registration(n.expression)))return false;
  const expected=parse(`const run=(mode,patch,extraEnv={})=>runActivityProcess(ENTRY,input(patch),{CODING_WF_PROVIDER:'claude',CODING_WF_CLAUDE_BIN:FAKE_CLAUDE,FAKE_CLAUDE_MODE:mode,...extraEnv});`).body[0].declarations[0];
  if(['HERE','ENTRY','FAKE_CLAUDE','run'].some(name=>variable(tree,name).length!==1)||!same(variable(tree,'run')[0],expected))return false;
  // 选现有参数检查用例的真实直线首语句；不借助其它任意测试/额外 env 的调用认领。
  const witness=body.find(n=>call(n.expression,'it')&&n.expression.arguments[0]?.value==='claude 参数：acceptEdits，允许 Bash，禁 git push 与 gh；prompt 带 S-n 列表与 03 路径')?.expression;
  if(!witness||witness.arguments.length!==2||witness.arguments[1]?.params?.length!==0||!witness.arguments[1].async)return false;
  const expectedCall=parse("const r=await run('build-ok');").body[0];
  return same(witness.arguments[1].body?.body?.[0],expectedCall)&&intact(tree,['HERE','ENTRY','FAKE_CLAUDE','run']);
}
function mainPrefix(tree,_parse) {
  const main=fn(tree,'main');if(!main?.async||main.params.length!==1||main.params[0].name!=='input')return false;
  const index=main.body.body.findIndex(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id?.name==='run'));
  if(index<0)return false;
  const actual=structuredClone(main.body.body.slice(0,index+1));
  const prompt=variable({body:actual},'prompt');
  if(prompt.length!==1||!call(prompt[0].init,'loadPrompt')||prompt[0].init.arguments[0]?.value!=='build')return false;
  const values=prompt[0].init.arguments[1];
  if(values?.type!=='ObjectExpression'||values.properties.some(p=>p.type!=='Property'||p.computed||p.kind!=='init'||p.method))return false;
  const expected=parseEnvelope(`async function main(input) {${ENVELOPES.mainPrefix}}`).body[0].body.body;
  const expectedValues=variable({body:expected},'prompt')[0].init.arguments[1];
  const key=p=>p.key.type==='Identifier'?p.key.name:p.key.type==='Literal'&&typeof p.key.value==='string'?p.key.value:null;
  const keys=expectedValues.properties.map(key), actualKeys=values.properties.map(key);
  if(actualKeys.some(k=>k===null)||new Set(actualKeys).size!==actualKeys.length)return false;
  // 未绑定标识符会在模板读取前抛错；额外值仅接受下一棒已审的 INTENT_PATH。
  const intentImport=tree.body.some(n=>n.type==='ImportDeclaration'&&n.source.value==='../lib/spec-check.mjs'&&n.specifiers.length===1&&n.specifiers[0].imported?.name==='INTENT_FILE'&&n.specifiers[0].local.name==='INTENT_FILE');
  const safeExtra=p=>key(p)==='INTENT_PATH'&&intentImport
    &&p.value.type==='CallExpression'&&member(p.value.callee,'path','join')&&p.value.arguments.length===2&&p.value.arguments[0]?.name==='dir'&&p.value.arguments[1]?.name==='INTENT_FILE';
  if(values.properties.filter(p=>!keys.includes(key(p))).some(p=>!safeExtra(p)))return false;
  values.properties=values.properties.filter(p=>keys.includes(key(p)));
  return same(actual,expected)&&variable(tree,'prompt').length===2 // precheck 独立局部 + main；不允许额外同名影子
    &&variable(tree,'args').length===1&&intact(tree,['main','prompt','args']);
}
function cliEnvelope(tree,parse) {
  if(!['runClaude','loadPrompt','renderPrompt','withModel','openSink','claudeTimeoutMs','headSha','gitOut','gitRun'].every(name=>functionMatches(tree,name,parse)))return false;
  const spawn=fn(tree,'spawnClaude'),parameters=parseEnvelope(ENVELOPES.spawnParameters).body[0];
  if(!spawn||!same(spawn.params,parameters.params)||spawn.body.body.length!==2||!same(spawn.body.body[0],parseEnvelope(ENVELOPES.spawnOuter).body[0]))return false;
  const returned=spawn.body.body[1];const promise=returned.argument;
  if(returned.type!=='ReturnStatement'||promise?.type!=='NewExpression'||promise.callee?.name!=='Promise'||promise.arguments.length!==1)return false;
  const callback=promise.arguments[0];if(callback.type!=='ArrowFunctionExpression'||callback.params.length!==1||callback.params[0].name!=='resolve')return false;
  const body=callback.body?.body;if(!body)return false;
  const prefix=parseEnvelope(ENVELOPES.spawnPrefix).body;
  if(!same(body.slice(0,prefix.length),prefix)||body[prefix.length]?.type!=='TryStatement'||!same(body[prefix.length].block.body[0],parseEnvelope(ENVELOPES.spawnCall).body[0]))return false;
  return intact(tree,['PROMPTS_DIR','runClaude','spawnClaude','loadPrompt','renderPrompt'],[],nodes(fn(tree,'claudeTimeoutMs')).filter(n=>member(n,'process','env')));
}
/** 只验证所登记的有限执行封套，不执行候选源码，也不承诺任意 JS 的可达性。 */
function proveLegacyBuildSources(sources,parse) {
  try {
    const trees=Object.fromEntries(['test','helper','activity','cli','protocol'].map(k=>[k,parse(sources[k])]));
    for(const [key,tree] of Object.entries(trees))if(!moduleEnvelope(tree,key,parse))return false;
    return namedFunctionsLink(trees.test,trees.helper,'./helpers/run-activity.mjs')
      &&namedFunctionsLink(trees.activity,trees.protocol,'../lib/protocol.mjs')
      &&namedFunctionsLink(trees.activity,trees.cli,'../lib/claude.mjs')
      &&namedFunctionsLink(trees.cli,trees.protocol,'./protocol.mjs')
      &&testWitness(trees.test,parse)&&functionMatches(trees.helper,'runActivityProcess',parse)&&functionMatches(trees.helper,'baseEnv',parse)
      &&intact(trees.helper,['runActivityProcess'])&&functionMatches(trees.activity,'specIds',parse)&&mainPrefix(trees.activity,parse)
      &&same(trees.activity.body.at(-1),parseEnvelope(ENVELOPES.entry).body[0])&&['runActivity','childEnv','readStdin','validateBase','resolveSprintDir'].every(name=>functionMatches(trees.protocol,name,parse))
      &&intact(trees.protocol,['runActivity'],nodes(fn(trees.protocol,'runActivity')).filter(n=>n.type==='AssignmentExpression'&&member(n.left,'process','exitCode')),nodes(fn(trees.protocol,'childEnv')).filter(n=>member(n,'process','env')))&&cliEnvelope(trees.cli,parse);
  } catch { return false; }
}
export function proveBuildSources(sources,parse) {
  if (proveLegacyBuildSources(sources,parse)) return true;
  const normalized=normalizeProvenanceBuild(sources,parse);
  return Boolean(normalized&&proveLegacyBuildSources(normalized,parse));
}
async function provenanceInputs(paths,readSource,revision) {
  return readProvenanceSources(paths, readSource, revision);
}
async function collectProvenanceInputs({read,relations,revision,build,version,historical=false}) {
  // 结构校验可以读取全封套；消费者绑定只包含本分支已证明使用的模块。
  for(const key of ['activityProvenance','recordProvenance','recordStore','recordRecords','provenancePath','qaIsolation'])if((build||key!=='activityProvenance')&&(key!=='qaIsolation'||['isolation','source_merge','native_evidence'].includes(version)))await read(PROVENANCE_SOURCE_PATHS[key]);
  if(version==='native_evidence')for(const path of Object.values(NATIVE_PROVENANCE_PATHS))await read(path);
  const edges=build?[
    [BUILD_SOURCE_PATHS.protocol,PROVENANCE_SOURCE_PATHS.activityProvenance,'native_activity_provenance_handler'],
    [PROVENANCE_SOURCE_PATHS.activityProvenance,PROVENANCE_SOURCE_PATHS.recordProvenance,'native_record_provenance_context'],
    [BUILD_SOURCE_PATHS.cli,PROVENANCE_SOURCE_PATHS.recordProvenance,'native_pipe_provenance_capture'],
  ]:[[PUBLISH_TEST,PROVENANCE_SOURCE_PATHS.recordProvenance,'explicit_test_provenance_fixture']];
  for(const key of ['recordStore','recordRecords','provenancePath'])edges.push([PROVENANCE_SOURCE_PATHS.recordProvenance,PROVENANCE_SOURCE_PATHS[key],'provenance_local_prehandler_dependency']);
  if(['isolation','source_merge','native_evidence'].includes(version))edges.push(
    [PROVENANCE_SOURCE_PATHS.recordProvenance,PROVENANCE_SOURCE_PATHS.qaIsolation,'provenance_static_import_dependency'],
    [PROVENANCE_SOURCE_PATHS.qaIsolation,PROVENANCE_SOURCE_PATHS.recordStore,'provenance_static_import_dependency']);
  if(version==='native_evidence'){if(historical)await read(NATIVE_HISTORY_PATH);edges.push(...nativeStaticEdges(historical));}
  for(const [consumer_path,input_path,kind] of edges)if(!relations.some(r=>r.consumer_path===consumer_path&&r.input_path===input_path&&r.kind===kind&&r.revision===revision))
    relations.push({consumer_path,input_path,kind,revision});
}
export async function collectBuildSources({parse,paths,selectors,read,readSource,revision,relations,requireProof}) {
  const selected=paths.includes(BUILD_SOURCE_PATHS.test)&&selectors.include.some(p=>p.test(BUILD_SOURCE_PATHS.test))&&!selectors.exclude.some(p=>p.test(BUILD_SOURCE_PATHS.test));
  if(selected) {
  const sources={...await provenanceInputs(paths,readSource,revision),...Object.fromEntries(await Promise.all(['test','helper','activity','cli','protocol'].map(async key=>[key,await readSource(BUILD_SOURCE_PATHS[key],revision)])))};
  if(requireProof(proveBuildSources(sources,parse),'native_build_execution_unproven')) {
  for(const key of Object.keys(BUILD_SOURCE_PATHS))await read(BUILD_SOURCE_PATHS[key]);
  for(const [consumer,input,kind] of [['test','helper','active_build_test_helper'],['helper','activity','native_build_activity_spawn'],['activity','prompt','executed_build_prompt_input'],['cli','prompt','native_build_template_reader'],['test','fake','explicit_test_cli_environment'],['cli','fake','native_build_test_cli_spawn']])
    relations.push({consumer_path:BUILD_SOURCE_PATHS[consumer],input_path:BUILD_SOURCE_PATHS[input],kind,revision});
  if(normalizeProvenanceBuild(sources,parse))await collectProvenanceInputs({read,relations,revision,build:true,version:provenanceSourceVersion(sources,parse),historical:Boolean(nativeEvidenceForwarding(sources,parse)?.historical)});
  }
  }
  await collectPublishSources({parse,paths,selectors,read,readSource,revision,relations,requireProof});
  const stageSelected=paths.some(path=>/coding-workflow\/__tests__\/(intent|spec|spec-review|verify|evaluate)\.test\.mjs$/.test(path)&&selectors.include.some(r=>r.test(path))&&!selectors.exclude.some(r=>r.test(path)));
  if(stageSelected||selected){
    const support={...await provenanceInputs(paths,readSource,revision),...Object.fromEntries(await Promise.all(['test','helper','activity','cli','protocol'].map(async key=>[key,await readSource(BUILD_SOURCE_PATHS[key],revision)])))};
    await collectStageSources({parse,paths,selectors,read,readSource,revision,relations,requireProof,
      supportProven:proveBuildSources(support,parse),supportVersion:provenanceSourceVersion(support,parse)??'legacy',supportHistory:Boolean(nativeEvidenceForwarding(support,parse)?.historical)});
  }
}

const PUBLISH_TEST=PREFIX+'__tests__/publish.test.mjs', PUBLISH_ENTRY=PREFIX+'activities/publish.mjs';
/** publish 仅证明真实 Node 入口消费，不声明其 GH 请求成功或额外 fake-GH 归属。 */
function proveLegacyPublishSources(test,helper,parse) {
  try {
    const tree=parse(test),h=parse(helper);
    if(!moduleEnvelope(tree,'publishTest',parse)||!moduleEnvelope(h,'helper',parse)||!namedFunctionsLink(tree,h,'./helpers/run-activity.mjs')||!functionMatches(h,'runActivityProcess',parse)||!functionMatches(h,'baseEnv',parse)||!intact(h,['runActivityProcess']))return false;
    const top=tree.body.filter(n=>n.type==='ExpressionStatement');
    if(top.length!==1||!call(top[0].expression,'describe'))return false;
    const group=top[0].expression.arguments;if(group.length!==2||group[0]?.type!=='Literal'||typeof group[0].value!=='string'||group[1]?.type!=='ArrowFunctionExpression'||group[1].async||group[1].params.length!==0||group[1].body?.type!=='BlockStatement')return false;
    const body=group[1].body.body;
    if(!testSetup(tree,'publishTest',body,parse))return false;
    if(body.some(n=>!['VariableDeclaration','ExpressionStatement'].includes(n.type)))return false;
    if(body.some(n=>n.type==='ExpressionStatement'&&!registration(n.expression)))return false;
    const expected=parse(`const run=(mode,patch,extraEnv={})=>runActivityProcess(ENTRY,input(patch),{CODING_WF_GH_BIN:FAKE_GH,FAKE_GH_MODE:mode,FAKE_GH_LOG:ghLog,...extraEnv});`).body[0].declarations[0];
    if(['HERE','ENTRY','FAKE_GH','run'].some(name=>variable(tree,name).length!==1)||!same(variable(tree,'run')[0],expected))return false;
    const witness=body.find(n=>call(n.expression,'it')&&n.expression.arguments[0]?.value==='new：提交并推送分支，开草稿 PR，输出新 URL 与分支')?.expression;
    return Boolean(witness&&witness.arguments.length===2&&witness.arguments[1]?.params?.length===0&&witness.arguments[1].async
      &&same(witness.arguments[1].body?.body?.[0],parse("const r=await run('new');").body[0])&&intact(tree,['HERE','ENTRY','FAKE_GH','run']));
  } catch { return false; }
}
export function provePublishSources(test,helper,parse,sources) {
  if(proveLegacyPublishSources(test,helper,parse))return true;
  const normalized=normalizeProvenancePublish(test,parse,sources);
  return Boolean(normalized&&proveLegacyPublishSources(normalized,helper,parse));
}
async function collectPublishSources({parse,paths,selectors,read,readSource,revision,relations,requireProof}) {
  if(!paths.includes(PUBLISH_TEST)||!selectors.include.some(p=>p.test(PUBLISH_TEST))||selectors.exclude.some(p=>p.test(PUBLISH_TEST)))return;
  const test=await readSource(PUBLISH_TEST,revision),helper=await readSource(BUILD_SOURCE_PATHS.helper,revision),sources=await provenanceInputs(paths,readSource,revision);
  if(!requireProof(provePublishSources(test,helper,parse,sources),'native_publish_execution_unproven'))return;
  await read(PUBLISH_TEST);await read(BUILD_SOURCE_PATHS.helper);await read(PUBLISH_ENTRY);
  relations.push({consumer_path:PUBLISH_TEST,input_path:BUILD_SOURCE_PATHS.helper,kind:'active_publish_test_helper',revision},
    {consumer_path:BUILD_SOURCE_PATHS.helper,input_path:PUBLISH_ENTRY,kind:'native_publish_activity_spawn',revision});
  if(normalizeProvenancePublish(test,parse,sources))await collectProvenanceInputs({read,relations,revision,build:false,version:provenanceSourceVersion(sources,parse),historical:Boolean(nativeEvidenceForwarding(sources,parse)?.historical)});
}
