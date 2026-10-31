/** 只证明固定Git内nightly实际选择的workspace测试；源码依赖仍由原生扫描器解析。 */
import yaml from 'js-yaml';
import { createHash } from 'node:crypto';
import * as nodeModule from 'node:module';
const WORKFLOW = '.github/workflows/nightly-regression.yml';
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
// 现行配置用到的有限glob语法；新语法必须显式重审。
function glob(pattern) {
  if (!pattern || pattern.startsWith('/') || pattern.split('/').some(p => p === '..' || p === '.') || /[\\\0]/.test(pattern)) fail();
  let result = '';
  for (let i = 0; i < pattern.length;) {
    const rest = pattern.slice(i);
    if (rest.startsWith('**/')) { result += '(?:[^/]+/)*'; i += 3; }
    else if (rest === '**') { result += '.*'; i += 2; }
    else if (rest.startsWith('**')) fail();
    else if (rest[0] === '*') { result += '[^/]*'; i++; }
    else if (rest[0] === '{') {
      const group = rest.match(/^\{([a-zA-Z0-9_-]+(?:,[a-zA-Z0-9_-]+)+)\}/);
      if (!group) fail();
      result += `(?:${group[1].split(',').join('|')})`; i += group[0].length;
    } else if (rest[0] === '.') { result += '\\.'; i++; }
    else if (/^[a-zA-Z0-9_/@-]$/.test(rest[0])) { result += rest[0]; i++; }
    else fail();
  }
  return new RegExp(`^${result}$`);
}
function selectors(text, parse) {
  const program = parse(text);
  const imports = program.body.filter(n => n.type === 'ImportDeclaration' && n.source.value === 'vitest/config');
  if (imports.length !== 1 || !imports[0].specifiers.some(n => n.type === 'ImportSpecifier' && n.imported.name === 'defineConfig' && n.local.name === 'defineConfig')) fail();
  if (program.body.some(n => !['ImportDeclaration', 'VariableDeclaration', 'ExportDefaultDeclaration'].includes(n.type))) fail();
  const exported = program.body.filter(n => n.type === 'ExportDefaultDeclaration');
  const config = exported[0]?.declaration;
  if (exported.length !== 1 || config?.type !== 'CallExpression' || config.callee.name !== 'defineConfig' || config.arguments.length !== 1) fail();
  const test = property(config.arguments[0], 'test');
  for (const name of ['root', 'workspace', 'projects']) if (property(config.arguments[0], name, false)) fail();
  for (const name of ['root', 'dir', 'workspace', 'projects']) if (property(test, name, false)) fail();
  const include = literals(property(test, 'include')).map(glob);
  const exclude = property(test, 'exclude', false);
  // Vitest默认排除目录，以及当前API显式排除目录；都不能成为测试来源。
  return { include, exclude: exclude ? literals(exclude).map(glob) : [] };
}
async function collectWorkspaceSources({ nightly, parse, paths, read, revision, relations, requireProof }) {
  const doc = yaml.load(nightly), job = doc?.jobs?.['workspace-test-nightly'];
  const environment = !doc.env || Object.keys(doc.env).every(name => name === 'CODEX_RELAY_HOME');
  if (!requireProof(Boolean(job && environment && !doc.defaults && !job.defaults && job.if === undefined && job.env === undefined && !job.container && !job['continue-on-error']), 'nightly_workspace_job_unproven')) return;
  for (const workspace of ['api', 'dashboard']) {
    const prefix = `apps/${workspace}/`, config = `${prefix}vitest.config.ts`, manifest = `${prefix}package.json`;
    const command = workspace === 'api' ? 'npm test' : 'npx vitest run';
    const step = job.steps?.find(s => s.run?.trim() === `cd apps/${workspace} && npm ci && ${command}`);
    if (!requireProof(Boolean(step && step.if === undefined && step.env === undefined && step.shell === undefined && step['working-directory'] === undefined && !step['continue-on-error']), 'nightly_workspace_command_unproven')) continue;
    const packageText = await read(manifest), configText = await read(config);
    if (!packageText || !configText) continue;
    const pkg = JSON.parse(packageText);
    if (!requireProof(Boolean(pkg.devDependencies?.vitest && !pkg.scripts?.pretest && !pkg.scripts?.posttest &&
      (workspace !== 'api' || pkg.scripts?.test === "NODE_OPTIONS='--max-old-space-size=2048' vitest run")), 'workspace_vitest_entry_unproven')) continue;
    const selected = selectors(configText, parse);
    relations.push({ consumer_path: WORKFLOW, input_path: manifest, kind: 'nightly_workspace_package', revision },
      { consumer_path: WORKFLOW, input_path: config, kind: 'nightly_workspace_vitest_config', revision });
    for (const path of paths.filter(p => p.startsWith(prefix) && /\.(?:test|spec)\.(?:ts|tsx)$/.test(p))) {
      const relative = path.slice(prefix.length);
      const ancestors = relative.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'));
      // 只认默认排除集以外的保守子集；不以文件存在推断cypress/config测试被执行。
      if (relative.split('/').some(part => part.startsWith('.') || ['node_modules', 'dist', 'cypress'].includes(part)) ||
        /(?:^|\/)(?:karma|rollup|webpack|vite|vitest|jest|ava|babel|nyc|cypress|tsup|build|eslint|prettier)\.config\./.test(relative) ||
        !selected.include.some(p => p.test(relative)) || selected.exclude.some(p => p.test(relative) || ancestors.some(parent => p.test(parent)))) continue;
      if (await read(path)) relations.push({ consumer_path: config, input_path: path, kind: 'literal_workspace_vitest_selector', revision });
    }
  }
}

const ENGINE_CI='.github/workflows/ci.yml',ENGINE_CONFIG='packages/engine/vitest.config.ts';
const ENGINE_TEST='packages/engine/tests/skills/worktree-cleanup-set-e.test.ts';
const ENGINE_SCRIPT='packages/engine/skills/dev/scripts/worktree-manage.sh';
const literal=(node,value)=>node?.type==='Literal'&&node.value===value;
function inspectNodes(node,visit){
 if(!node||typeof node!=='object')return;
 if(node.type)visit(node);
 for(const value of Object.values(node)){
  if(Array.isArray(value))for(const child of value)inspectNodes(child,visit);
  else if(value&&typeof value==='object')inspectNodes(value,visit);
 }
}
function namedImport(program,name,source){
 const declarations=[];
 inspectNodes(program,node=>{
  if(node.type==='VariableDeclarator'&&node.id.name===name||node.type==='FunctionDeclaration'&&node.id?.name===name)declarations.push(node);
  if(['FunctionDeclaration','ArrowFunctionExpression','FunctionExpression'].includes(node.type))for(const p of node.params)inspectNodes(p,n=>{if(n.type==='Identifier'&&n.name===name)declarations.push(node);});
 });
 const imports=program.body.filter(n=>n.type==='ImportDeclaration').flatMap(n=>n.specifiers.filter(s=>s.local.name===name).map(s=>({s,source:n.source.value})));
 return !declarations.length&&imports.length===1&&imports[0].source===source&&imports[0].s.type==='ImportSpecifier'&&imports[0].s.imported.name===name;
}
function engineSelected(config,parse,skillExcludes=null){
 const program=parse(config),constants=new Map();
 for(const statement of program.body){
  if(statement.type==='VariableDeclaration'&&statement.kind==='const')for(const d of statement.declarations)constants.set(d.id.name,d.init);
  else if(!['ImportDeclaration','ExportDefaultDeclaration'].includes(statement.type))fail();
 }
 if(!namedImport(program,'defineConfig','vitest/config'))fail();
 const exports=program.body.filter(n=>n.type==='ExportDefaultDeclaration');
 const call=exports[0]?.declaration;
 if(exports.length!==1||call?.type!=='CallExpression'||call.callee.name!=='defineConfig'||call.arguments.length!==1)fail();
 const root=call.arguments[0],test=property(root,'test');
 for(const obj of [root,test])for(const field of ['root','dir','workspace','include','setupFiles','testNamePattern'])if(property(obj,field,false))fail();
 const projects=property(test,'projects');
 if(projects?.type!=='ArrayExpression'||projects.elements.length!==2)fail();
 const serial=projects.elements.map(p=>property(p,'test')).find(p=>literal(property(p,'name'),'serial'));
 if(!serial)fail();
 const parallel=constants.get('PARALLEL_TESTS'),parallelPaths=literals(parallel);
 const includes=literals(property(serial,'include')).map(glob),exclude=property(serial,'exclude');
 if(exclude?.type!=='ArrayExpression')fail();
 const excluded=exclude.elements.flatMap(n=>skillExcludes&&skillExcludeSpread(n,program,'engine')?skillExcludes:n.type==='SpreadElement'&&n.argument.name==='PARALLEL_TESTS'?parallelPaths:
  n.type==='Literal'&&typeof n.value==='string'?[n.value]:fail()).map(glob);
 const globalExclude=property(test,'exclude',false);
 if(globalExclude){
  if(globalExclude.type!=='ArrayExpression')fail();
  excluded.push(...globalExclude.elements.flatMap(n=>skillExcludes&&skillExcludeSpread(n,program,'engine')?skillExcludes:n?.type==='Literal'&&typeof n.value==='string'?[n.value]:fail()).map(glob));
 }
 for(const field of ['root','dir','workspace','setupFiles','testNamePattern'])if(property(serial,field,false))fail();
 const relative=ENGINE_TEST.slice('packages/engine/'.length);
 return includes.some(p=>p.test(relative))&&!excluded.some(p=>p.test(relative));
}
/** Node的真实TS解析器仅擦除类型；随后只解释AST，不执行测试或配置。 */
function actualEngineSpawn(text,parse,paths){
 if(typeof nodeModule.stripTypeScriptTypes!=='function')fail();
 const program=parse(nodeModule.stripTypeScriptTypes(text,{mode:'strip'}));
 for(const [name,source] of [['spawnSync','child_process'],['resolve','path'],['existsSync','fs'],['it','vitest'],['describe','vitest']]){
  if(!namedImport(program,name,source))return false;
 }
 const declarations=new Map(),functions=new Map();
 inspectNodes(program,n=>{
  if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'){
   const values=declarations.get(n.id.name)||[];values.push(n.init);declarations.set(n.id.name,values);
   if(['ArrowFunctionExpression','FunctionExpression'].includes(n.init?.type))functions.set(n.id.name,n.init);
  }
  if(n.type==='FunctionDeclaration')functions.set(n.id.name,n);
 });
 const script=declarations.get('SCRIPT');
 if(script?.length!==1)return false;
 const resolved=script[0];
 if(resolved?.type!=='CallExpression'||resolved.callee.name!=='resolve'||resolved.arguments.length!==2||resolved.arguments[0].name!=='__dirname'
  ||!literal(resolved.arguments[1],'../../skills/dev/scripts/worktree-manage.sh')||!paths.includes(ENGINE_SCRIPT))return false;
 let substituted=false;
 inspectNodes(program,n=>{
  if(n.type==='AssignmentExpression'&&n.left.type==='Identifier'&&['SCRIPT','spawnSync','resolve','it','describe',...functions.keys()].includes(n.left.name))substituted=true;
  if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&['mock','doMock','exit'].includes(n.callee.property?.name))substituted=true;
  if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type))for(const p of n.params)inspectNodes(p,x=>{if(x.type==='Identifier'&&['SCRIPT','bash'].includes(x.name))substituted=true;});
 });
 if(substituted)return false;
 let found=false;const stack=new Set(),scopes=[];
 const exists=node=>node?.type==='CallExpression'&&node.callee.name==='existsSync'&&node.arguments.length===1&&node.arguments[0].name==='SCRIPT';
 const registration=node=>{
  if(node?.type==='Identifier'&&['it','describe'].includes(node.name))return {name:node.name,skip:false};
  if(node?.type==='MemberExpression'&&!node.computed&&node.property.name==='skip'){
   const base=registration(node.object);return base?{...base,skip:true}:null;
  }
  if(node?.type==='CallExpression'&&node.callee.type==='MemberExpression'&&!node.callee.computed){
   const base=registration(node.callee.object);if(!base)return null;
   if(node.callee.property.name==='skipIf'&&node.arguments.length===1&&node.arguments[0].type==='UnaryExpression'
    &&node.arguments[0].operator==='!'&&exists(node.arguments[0].argument))return base;
   if(node.callee.property.name==='each'&&node.arguments.length===1&&node.arguments[0].type==='ArrayExpression'&&node.arguments[0].elements.length>0
    &&node.arguments[0].elements.every(e=>e.type==='Literal'))return base;
  }
  return null;
 };
 const bash=node=>literal(node,'bash')||node?.type==='Identifier'&&declarations.get(node.name)?.length===1&&
  (()=>{const init=declarations.get(node.name)[0];return init?.type==='ConditionalExpression'&&init.test.type==='CallExpression'&&init.test.callee.name==='existsSync'
   &&literal(init.test.arguments[0],'/opt/homebrew/bin/bash')&&literal(init.consequent,'/opt/homebrew/bin/bash')&&literal(init.alternate,'bash');})();
 const execute=node=>{
  if(!node||found)return;
  if(node.type==='Program'||node.type==='BlockStatement'){
   const scope=new Map();
   for(const statement of node.body){
    if(statement.type==='FunctionDeclaration')scope.set(statement.id.name,statement);
    if(statement.type==='VariableDeclaration')for(const d of statement.declarations)if(['ArrowFunctionExpression','FunctionExpression'].includes(d.init?.type))scope.set(d.id.name,d.init);
   }
   scopes.push(scope);
   try{for(const statement of node.body)if(execute(statement)===true)return true;}finally{scopes.pop();}
   return;
  }
  if(node.type==='ExpressionStatement'){execute(node.expression);return;}
  if(['ReturnStatement','ThrowStatement'].includes(node.type)){execute(node.argument);return true;}
  if(node.type==='VariableDeclaration'){for(const d of node.declarations)if(!['ArrowFunctionExpression','FunctionExpression'].includes(d.init?.type))execute(d.init);return;}
  if(node.type==='IfStatement'){
   if(literal(node.test,true))return execute(node.consequent);
   if(literal(node.test,false))return execute(node.alternate);
   let exits=false;inspectNodes(node,n=>{if(['ReturnStatement','ThrowStatement'].includes(n.type))exits=true;});return exits||undefined;
  }
  if(node.type!=='CallExpression')return;
  const reg=registration(node.callee);
  if(reg){if(!reg.skip){const fn=node.arguments.at(-1);if(['ArrowFunctionExpression','FunctionExpression'].includes(fn?.type))execute(fn.body);}return;}
  if(node.callee.name==='spawnSync'&&bash(node.arguments[0])&&node.arguments[1]?.type==='ArrayExpression'&&node.arguments[1].elements[0]?.name==='SCRIPT'){found=true;return;}
  const fn=scopes.map(s=>s.get(node.callee.name)).filter(Boolean).at(-1);
  if(fn&&!stack.has(fn)&&(!declarations.has(node.callee.name)||declarations.get(node.callee.name).length===1)){
   stack.add(fn);execute(fn.body);stack.delete(fn);
  }
 };
 execute(program);return found;
}
async function collectEngineInputs({paths,read,parse,revision,relations,basicCi=false}){
 if(![ENGINE_CI,ENGINE_CONFIG,ENGINE_TEST,ENGINE_SCRIPT].every(p=>paths.includes(p))){if(basicCi)fail();return;}
 const text=await read(ENGINE_CI),doc=yaml.load(text),job=doc?.jobs?.['engine-tests'];
 if(!job&&!basicCi)return;
 let skillExcludes=null;
 if(basicCi){
  await collectBasicCiSources({read,ci:text,revision,relations:[],parse,paths});
  skillExcludes=skillSourceLiteralExcludes(await read(SKILL_SELECTOR),'engine',parse);
 }
 if(!basicCi){
 const step=job.steps?.find(s=>s.name==='Unit Tests');
 if(job.needs!=='changes'||doc.jobs.changes?.outputs?.engine!=='${{ steps.detect.outputs.engine }}'
  ||!doc.jobs.changes.steps?.some(s=>s.id==='detect'&&typeof s.run==='string')
  ||job.if!=="needs.changes.outputs.engine == 'true'"||job.defaults||job.env||job.container||job['continue-on-error']||doc.defaults
  ||!step||step.run?.trim()!=='cd packages/engine && npx vitest run --reporter=verbose'||step.if||step.env||step.shell||step['working-directory']||step['continue-on-error'])fail();
 // 这里只证明条件CI声明的输入关系；实际执行/完成仍以该次CI回执为准。
 }
 const manifest='packages/engine/package.json',pkg=JSON.parse(await read(manifest));
 if(!pkg.devDependencies?.vitest||!basicCi&&!job.steps.some(s=>s.run==='npm ci --workspace=packages/brain --workspace=packages/engine --ignore-scripts'&&!s.if&&!s.env&&!s['working-directory']))fail();
 if(!engineSelected(await read(ENGINE_CONFIG),parse,skillExcludes))return;
 const test=await read(ENGINE_TEST);
 relations.push({consumer_path:ENGINE_CI,input_path:manifest,kind:'declared_engine_install_input',revision},
  {consumer_path:basicCi?BASIC_RUNNER:ENGINE_CI,input_path:ENGINE_CONFIG,kind:'required_engine_vitest_config',revision},
  {consumer_path:ENGINE_CONFIG,input_path:ENGINE_TEST,kind:'literal_engine_serial_selector',revision});
 if(actualEngineSpawn(test,parse,paths)){
  await read(ENGINE_SCRIPT);relations.push({consumer_path:ENGINE_TEST,input_path:ENGINE_SCRIPT,kind:'actual_engine_test_spawn',revision});
 }
}

/** 图解析能力独立于definition协议：旧定义字节不变，只解析两侧各自真实固定Git输入。 */
export async function collectWorkspaceInputEdges({ revision, paths, readSource, parse }) {
  const unknown = () => { throw Object.assign(Error('workspace input source unproven'), { code: 'WORKSPACE_INPUT_SOURCE_UNPROVEN' }); };
  if (!/^[a-f0-9]{40}$/.test(revision) || !Array.isArray(paths) || typeof readSource !== 'function') unknown();
  if (!paths.includes(WORKFLOW)&&!paths.includes(ENGINE_CI)) return [];
  const contents = new Map(), relations = [];
  const read = async path => {
    if (!paths.includes(path)) unknown();
    const text = await readSource(path, revision);
    if (typeof text !== 'string' || !text.trim()) unknown();
    contents.set(path, createHash('sha256').update(text).digest('hex'));
    return text;
  };
  try {
    if(paths.includes(WORKFLOW)){
    const nightly = await read(WORKFLOW);
    if (yaml.load(nightly)?.jobs?.['workspace-test-nightly']) await collectWorkspaceSources({ nightly, parse, paths, read, revision, relations, requireProof: condition => {
      if (!condition) unknown();
      return true;
    } });
    }
    const basicCi=await basicCiEnabledAt({paths,readSource,revision,parse});
    await collectEngineInputs({paths,read,parse,revision,relations,basicCi});
  } catch { unknown(); }
  return relations.map(row => ({ src_path: row.consumer_path, dst_path: row.input_path, edge_type: 'import', detail: {
    via: 'fixed_git_workspace_input', selector_kind: row.kind, source_revision: revision,
    consumer_sha256: contents.get(row.consumer_path), input_sha256: contents.get(row.input_path), selector_schema: 1,
  } }));
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
const REVIEWED = {
  'packages/brain/vitest.config.js': '689878adaa1135e5783a0904b6c10918f40cd380a8e8bdd9046e32ec7e382e89',
  'packages/engine/vitest.config.ts': '87652971ef852d98a08dceb5f2ecbef2cd6eb2336f1fbce6879d3fa6dc77c2f8',
  'scripts/ci/basic-scope.mjs': '5171c4eed9ab91e2dab79a06a0f7ca775320e35d146d26aa2e0f26a7a656734d',
  [BASIC_RUNNER]: 'c4e57861903b8ad1d2a6b6d3e3385311b8f5ea97c64736fa66e54c4e329b0530',
  'scripts/ci/check-basic-results.mjs': 'b6c0b93e15320deff680e765f4558fcdb2a8d98c65d7a926d94f2158af6641e2',
  'scripts/ci/basic-runtime-smoke.mjs': 'b386b8c0c8631de5b6a0eec19494835f48c6ca3822a4533ee154ce8767a21eec',
  'scripts/ci/ops-checks.mjs': '96023fd57f11eb1277396b77419bad94a050d0ef64b1c5993db258d87797df82',
  'scripts/ci/run-isolated-staging-smoke.mjs': 'fa19da1eaf14621a75d95763229fa8d6de40ce3e55940401458346da37f8fbaf',
  [SKILL_SELECTOR]: '1daf4f27f6fa97b3c8f3d9a9e1a9e86e44fbe92b84c962d1c2ce3b90db32b147',
};
const BASIC_PROTOCOLS = {
  '04474b3e5c646767cdf49a4d03e32b3a2f4042027594dd87ef4d6975390f6298': REVIEWED,
  '7fee2a6d842c7c2595fa882fa61f75750ec6b2787186fdaf8747e1084a64fcee': {
    ...REVIEWED,
    'packages/brain/vitest.config.js': 'fbc5d407a66e895386510bf053232623b3ace335f8a9df4fc130dd6083e2315d',
    'scripts/ci/basic-scope.mjs': '9844bb702db2c1a9507f88f1c6c330f676b786cb784592dc4aaefc096b93d6ef',
    [BASIC_RUNNER]: 'c9c1318dcd6b35981453aa06f656f5a99cb6283d2b7e4ea4a1cf8f6772103f6d',
    'apps/api/vitest.config.ts': '06e1a3d6e071c95de35b874e9f2ca3ddd05bd673257f9761340c6d9b29c16409',
    'apps/api/vitest.integration.config.ts': '6c2a55ccba874bf8fcae7858f0b9f21295f6728f430860a4ee60c1612cc59dec',
    [PINNED_READER]: '3cf300333012557b0191ca6eba5a1bc112c99cbff1daf4ea85da8e2d33f96f66',
    [PINNED_WORKFLOW]: 'aaf1a1cdc30961114927231193c071d53d27976eb09971e0c72e63a8176eb129',
  },
};
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
  if (hash(text) !== REVIEWED[SKILL_SELECTOR]) reject();
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
  const protocol = BASIC_PROTOCOLS[workflowHash(ci)];
  if (!protocol) reject();
  for (const [path, digest] of Object.entries(protocol)) if (hash(await read(path)) !== digest) reject();
  const relation = (consumer_path, input_path, kind) => relations.push({ consumer_path, input_path, kind, revision });
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
    relation(PINNED_READER, PINNED_WORKFLOW, 'literal_url_workflow_verification_input');
  }
  for (const [path, kind] of [['scripts/ci/basic-scope.mjs', 'required_basic_ci_plan'], [BASIC_RUNNER, 'required_basic_ci_matrix_runner'],
    ['scripts/ci/check-basic-results.mjs', 'required_basic_ci_success_aggregate']]) relation(BASIC_CI, path, kind);
  for (const path of ['scripts/ci/basic-runtime-smoke.mjs', 'packages/brain/src/migrate.js', 'scripts/ci/__tests__/runtime-signal.integration.test.mjs']) {
    await read(path); relation(BASIC_RUNNER, path, 'isolated_scratch_runtime_check');
  }
  for (const [consumer, input] of [[BASIC_RUNNER, 'scripts/ci/ops-checks.mjs'], ['scripts/ci/ops-checks.mjs', 'scripts/ci/run-isolated-staging-smoke.mjs']]) relation(consumer, input, 'reviewed_basic_ci_named_call');
  for (const path of ['package.json', 'package-lock.json']) { await read(path); relation(BASIC_CI, path, 'root_npm_ci_manifest_input'); }
  await read('packages/brain/vitest.config.js');
  relation(BASIC_RUNNER, 'packages/brain/vitest.config.js', 'complete_brain_unit_six_shards');
  relation('packages/brain/vitest.config.js', SKILL_SELECTOR, 'reviewed_skill_source_exclusion');
  const apiConfig = 'apps/api/vitest.integration.config.ts';
  if (Object.hasOwn(protocol, apiConfig)) {
    relation(BASIC_RUNNER, apiConfig, 'isolated_api_postgres_config');
    const config = parse(await read(apiConfig)).body.find(n => n.type === 'ExportDefaultDeclaration').declaration.arguments[0];
    for (const selected of property(property(config, 'test'), 'include').elements) {
      const path = 'apps/api/' + selected.value;
      await read(path); relation(apiConfig, path, 'literal_api_postgres_selector');
    }
    relation(BASIC_RUNNER, 'apps/api/vitest.config.ts', 'separate_api_unit_config');
  }
  return skillSourceLiteralExcludes(await read(SKILL_SELECTOR), 'brain', parse);
}
/** Deep 的全 PG 清单独立绑定，不把它声明为普通 PR 中执行过。 */
export async function collectDeepCiSources({ read, revision, relations }) {
  const workflow = '.github/workflows/nightly-regression.yml', config = 'scripts/ci/deep-integration.config.mjs';
  if (workflowHash(await read(workflow)) !== '6be8812458c47df1bb10a841aaa8278b716adb17c3268387a8435f0127ba0724'
    || hash(await read(config)) !== 'ce5df18b0016ce03ed08bf20def00a10ef68652ba7566f665021d8773467e75e') reject();
  relations.push({ consumer_path: workflow, input_path: config, kind: 'scheduled_or_manual_full_postgres_entry', revision },
    { consumer_path: config, input_path: 'packages/brain/vitest.config.js', kind: 'shared_postgres_literal_config', revision });
}

const AUTO_VERSION_TEST='packages/brain/src/__tests__/auto-version-decision.test.js';
const AUTO_VERSION_WORKFLOW='.github/workflows/auto-version.yml';
const AUTO_VERSION_FILES={
  "packages/brain/src/__tests__/auto-version-decision.test.js": "2a242093e5c91a35e243bf100e46ddfd26478210478094a7bca8d0186b09c25f",
  ".github/workflows/auto-version.yml": "c4dd4558b9d3c72583bd2fa8ad2391ca5ecbc11fec7c7ba2271cc66374fc16b0",
  "packages/brain/scripts/auto-version-decision.mjs": "2264d26f91cb4ab6662abfc1eb6eb487fcb884ddb6f582781484c3df0d20c045",
  "packages/brain/scripts/auto-version-apply.mjs": "a8560b338a8fa6e20f985e24a7d6dbf673790ecd11b7c67979f8b0cd535f8b8b",
  "scripts/ci/implementation-auxiliary-evidence.mjs": ["f5d052b9965825c1facb602084f18fa5063c687f8825f6f7711299c419bb09d0", "f96a4c4639f1d8a43acde5e646c5910abc5b0896efadd063939a0cda3f7de3ba"],
  "packages/brain/src/lib/gp-assertion-command.js": "d47bbd492971ad5ed5ec9d4c6915b85bb318c990bc998f84c808ad24aa3f3fe0",
  "packages/brain/src/lib/step-probe-spec.js": "c9c3e710368c0e57e7926b8a6c4a352efbb769210c45e00d13cb47729786f025"
};
export async function collectAutoVersionTestSources({read,requireProof,relations,revision,parse,selectors}) {
  requireProof(Boolean(selectors&&selectors.include.some(pattern=>pattern.test(AUTO_VERSION_TEST))&&!selectors.exclude.some(pattern=>pattern.test(AUTO_VERSION_TEST))),'auto_version_test_selector_unproven');
  const texts=new Map();
  for(const[path,expected]of Object.entries(AUTO_VERSION_FILES)) {
    const text=await read(path);texts.set(path,text);
    requireProof(text&&[expected].flat().includes(createHash('sha256').update(text).digest('hex')),'auto_version_test_source_unproven');
  }
  const relation=(consumer_path,input_path,kind)=>relations.push({consumer_path,input_path,kind,revision});
  relation('packages/brain/vitest.config.js',AUTO_VERSION_TEST,'literal_vitest_verification_selector');
  relation(AUTO_VERSION_TEST,AUTO_VERSION_WORKFLOW,'verified_test_yaml_read');
  for(const input of ['packages/brain/scripts/auto-version-decision.mjs','packages/brain/scripts/auto-version-apply.mjs']) {
    relation(AUTO_VERSION_TEST,input,'verified_test_workflow_bash_script');
    relation(AUTO_VERSION_WORKFLOW,input,'fixed_node_script_verification_input');
  }
  // 从实际冻结语法读取本仓import，不靠出现在traversal里猜直接绑定。
  for(const[path,text]of texts) {
    if(!/\.[cm]?js$/.test(path)||!text)continue;
    for(const node of parse(text).body.filter(node=>node.type==='ImportDeclaration')) {
      const input=node.source.value;if(!input.startsWith('.'))continue;
      const segments=path.split('/').slice(0,-1);
      for(const part of input.split('/')){if(part==='..')segments.pop();else if(part!=='.')segments.push(part);}
      const resolved=segments.join('/');
      requireProof(Object.hasOwn(AUTO_VERSION_FILES,resolved),'auto_version_test_dependency_unproven');
      if(Object.hasOwn(AUTO_VERSION_FILES,resolved))relation(path,resolved,'fixed_relative_verification_import');
    }
  }
}
