/** 只证明固定Git声明的真实测试选择与诊断输入；源码依赖仍由原生扫描器解析。 */
import yaml from 'js-yaml';
import { createHash } from 'node:crypto';
import * as nodeModule from 'node:module';
import { BASIC_CI, BASIC_RUNNER, SKILL_SELECTOR, basicCiEnabledAt, skillSourceLiteralExcludes, skillExcludeSpread, collectBasicCiSources, property, literals, fail } from './existing-ops-stage-source.js';
export { BASIC_CI, BASIC_RUNNER, SKILL_SELECTOR, basicCiSelectorEnabled, basicCiEnabledAt, basicCiWorkflowProven, skillSourceLiteralExcludes, skillExcludeSpread, deepPostgresDirectorySelected, collectBasicCiSources, collectDeepCiSources, collectAutoVersionTestSources } from './existing-ops-stage-source.js';
const WORKFLOW = '.github/workflows/nightly-regression.yml';
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
    if(basicCi)await collectBasicDiagnosticInputs({paths,read,parse,revision,relations});
  } catch { unknown(); }
  return relations.map(row => ({ src_path: row.consumer_path, dst_path: row.input_path, edge_type: 'import', detail: {
    via: 'fixed_git_workspace_input', selector_kind: row.kind, source_revision: revision,
    consumer_sha256: contents.get(row.consumer_path), input_sha256: contents.get(row.input_path), selector_schema: 1,
  } }));
}


const QUALITY_CONFIG='packages/quality/vitest.config.ts';
const GOLDSET_TEST='packages/quality/__tests__/goldset-eval-cli.test.js';
const GOLDSET_SCRIPT='packages/quality/skill-distillation/scripts/goldset-eval.mjs';
const VERSION_TEST='tests/regression/version-gate-silent/check-brain-version-bump.test.js';
const VERSION_SCRIPT='scripts/ci/check-brain-version-bump.sh';
const IMPACT_WORKFLOW='.github/workflows/implementation-impact.yml';
const SOURCE_NODE_ROOTS=['implementation-main-snapshot','workspace-ci-source-bundle','implementation-skill-source','device-patrol-governance']
 .map(name=>`scripts/ci/__tests__/${name}.test.mjs`);
const digest=text=>createHash('sha256').update(text).digest('hex');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
/** 完整源码封印之外再锚定实际值流；不把出现命令字符串当作执行证明。 */
function diagnosticCall(tree,kind){
 const all=[];inspectNodes(tree,n=>all.push(n));
 const variable=(name,body=tree)=>{const found=[];inspectNodes(body,n=>{if(n.type==='VariableDeclarator'&&n.id.name===name)found.push(n.init);});return found.length===1?found[0]:null;};
 const namedCall=(node,name)=>node?.type==='CallExpression'&&node.callee.name===name;
 const member=(node,object,name)=>node?.type==='MemberExpression'&&!node.computed&&node.object.name===object&&node.property.name===name;
 const functions=name=>all.filter(n=>n.type==='FunctionDeclaration'&&n.id.name===name);
 if(kind==='goldset'){
  const distill=variable('distill'),entry=variable('entry'),fn=functions('evaluate');
  if(distill?.type!=='NewExpression'||distill.callee.name!=='URL'||!literal(distill.arguments[0],'../skill-distillation/')
   ||!namedCall(entry,'fileURLToPath')||entry.arguments[0]?.type!=='NewExpression'||entry.arguments[0].callee.name!=='URL'
   ||!literal(entry.arguments[0].arguments[0],'scripts/goldset-eval.mjs')||entry.arguments[0].arguments[1]?.name!=='distill'||fn.length!==1)return false;
  const args=variable('args',fn[0]),spawn=[];inspectNodes(fn[0],n=>{if(namedCall(n,'spawn'))spawn.push(n);});
  return args?.type==='ArrayExpression'&&args.elements[0]?.name==='entry'&&spawn.length===1
   &&member(spawn[0].arguments[0],'process','execPath')&&spawn[0].arguments[1]?.name==='args'
   &&all.some(n=>namedCall(n,'evaluate')&&n.start>fn[0].end);
 }
 const script=variable('SCRIPT'),fn=functions('runScript'),spawn=[];
 if(!namedCall(script,'resolve')||script.arguments[0]?.name!=='__dirname'||!literal(script.arguments[1],'../../../scripts/ci/check-brain-version-bump.sh')||fn.length!==1)return false;
 inspectNodes(fn[0],n=>{if(namedCall(n,'spawnSync'))spawn.push(n);});
 return spawn.length===1&&literal(spawn[0].arguments[0],'bash')&&spawn[0].arguments[1]?.type==='ArrayExpression'
  &&spawn[0].arguments[1].elements[0]?.name==='SCRIPT'&&all.some(n=>namedCall(n,'runScript')&&n.start>fn[0].end);
}
/** 只对已审新API组合补全选择；旧f92协议不增加声明。完整basic证明先于任何边。 */
export async function collectBasicDiagnosticInputs({paths,read,parse,revision,relations}){
 const ci=await read(BASIC_CI),proof=[],skillText=await read(SKILL_SELECTOR);
 await collectBasicCiSources({ci,read,parse,paths,revision,relations:proof});
 if(!proof.some(r=>r.kind==='separate_api_unit_config'))return;
 const relation=(consumer_path,input_path,kind)=>relations.push({consumer_path,input_path,kind,revision});
 const apiConfig='apps/api/vitest.config.ts',selected=selectors(await read(apiConfig),parse),prefix='apps/api/';
 for(const path of paths.filter(p=>p.startsWith(prefix)&&/\.(?:test|spec)\.(?:ts|tsx)$/.test(p))){
  const relative=path.slice(prefix.length),parts=relative.split('/');
  if(parts.some(p=>p.startsWith('.')||['node_modules','dist','cypress'].includes(p))||
   /(?:^|\/)(?:karma|rollup|webpack|vite|vitest|jest|ava|babel|nyc|cypress|tsup|build|eslint|prettier)\.config\./.test(relative))continue;
  const ancestors=parts.slice(0,-1).map((_,i,ps)=>ps.slice(0,i+1).join('/'));
  if(!selected.include.some(p=>p.test(relative))||selected.exclude.some(p=>p.test(relative)||ancestors.some(a=>p.test(a))))continue;
  await read(path);relation(apiConfig,path,'literal_workspace_vitest_selector');
 }
 const hasDiagnostics=paths.includes(GOLDSET_TEST)||digest(await read(QUALITY_CONFIG))==='a9163321496b5f40a73bfdd3efab18478f3d2da16e3906f413b7f7fb119f4001';
 if(!hasDiagnostics){if(paths.includes(IMPACT_WORKFLOW))await collectSourceNodeInputs({read,paths,revision,relations});return;}
 // 默认Quality选择器是Vitest默认include，排除集必须是已审配置及封印的Skill字面量。
 // 固定版本配置的完整封印同时证明没有projects/dir/testNamePattern或排除该版本fixture。
 for(const [config,test,script,configDigest,testDigest]of[
  [QUALITY_CONFIG,GOLDSET_TEST,GOLDSET_SCRIPT,['09e80d81e95b55086e4fcc5c5d3deb476e2d510a5ae2e578ec7f9b56115c084e','a9163321496b5f40a73bfdd3efab18478f3d2da16e3906f413b7f7fb119f4001'],'8515a4c95b0d8e55b9ca967a66948ee3de8470ad4da0655d095b5a6a4548eecd'],
  ['packages/brain/vitest.config.js',VERSION_TEST,VERSION_SCRIPT,'906b91dbaaf68ea004b60a252ab0af88bda443cde8418d8a3b812b48ebe4c0f8','d06ad5482e7200ff5101cb30b0859b3539adf460cf14204a33b2c3240c56c53e'],
 ]){
  // 未出现的新测试不被历史协议假称执行；一旦声明该诊断，完整前置与真实目标都不可缺。
  if(!paths.includes(test))fail();
  const configText=await read(config),text=await read(test);
  if(![configDigest].flat().includes(digest(configText))||digest(text)!==testDigest)fail();
  const tree=parse(text);
  if(test===GOLDSET_TEST){
   const selected=property(parse(configText).body.find(n=>n.type==='ExportDefaultDeclaration').declaration.arguments[0],'test');
   if(property(selected,'include',false))fail();
   const excluded=property(selected,'exclude').elements.flatMap(n=>skillExcludeSpread(n,parse(configText),'quality')
    ?skillSourceLiteralExcludes(skillText,'quality',parse):literals({type:'ArrayExpression',elements:[n]}));
   // 下列完整已审测试包含it.each/it -> evaluate -> Promise executor -> spawn(process.execPath,args)。
   // entry来自fileURLToPath(new URL('scripts/goldset-eval.mjs',distill))，不执行候选脚本。
   if(excluded.map(glob).some(p=>p.test('__tests__/goldset-eval-cli.test.js')||p.test('__tests__')))fail();
   if(!namedImport(tree,'spawn','node:child_process')||!namedImport(tree,'fileURLToPath','node:url')||!diagnosticCall(tree,'goldset'))fail();
  }else if(!namedImport(tree,'spawnSync','child_process')||!namedImport(tree,'resolve','path')||!diagnosticCall(tree,'version'))fail();
  await read(script);relation(BASIC_RUNNER,config,'reviewed_default_unit_config');
  relation(config,test,'reviewed_default_vitest_diagnostic_selector');
  relation(test,script,'reviewed_actual_test_subprocess_diagnostic');
 }
 if(paths.includes(IMPACT_WORKFLOW))await collectSourceNodeInputs({read,paths,revision,relations});
}
/** 将checkout、Node22/npm安装、环境和无条件命令前置作为一个原子证明，不能拼配。 */
async function collectSourceNodeInputs({read,paths,revision,relations}){
 const doc=yaml.load(await read(IMPACT_WORKFLOW)),job=doc?.jobs?.gate;
 const index=job?.steps?.findIndex(s=>s.name==='来源机制完整单元回归');
 // 此步尚未迁入的历史workflow不宣称执行Node专项；已有main-only调用也不会变成PR执行。
 if(index===undefined||index<0)return;
 const {jobs,...workflow_header}=doc;
 if(!jobs||typeof jobs!=='object'||Array.isArray(jobs))fail();
 const dependencies=new Map(),active=new Set(),done=new Set();
 for(const [name,definition]of Object.entries(jobs)){
  if(!definition||typeof definition!=='object'||Array.isArray(definition))fail();
  const needs=definition.needs===undefined?[]:Array.isArray(definition.needs)?definition.needs:[definition.needs];
  if(new Set(needs).size!==needs.length||needs.some(parent=>typeof parent!=='string'||!Object.hasOwn(jobs,parent)))fail();
  dependencies.set(name,needs);
 }
 const visit=name=>{if(active.has(name))fail();if(done.has(name))return;active.add(name);for(const parent of dependencies.get(name))visit(parent);active.delete(name);done.add(name);};
 for(const name of dependencies.keys())visit(name);
 const job_headers=Object.fromEntries(Object.entries(jobs).map(([name,definition])=>[name,Object.fromEntries(Object.entries(definition).filter(([key])=>key!=='steps'))]));
 const controls={workflow_header,job_headers,gate_prefix:job.steps.slice(0,index+1)};
 const controlHash=digest(JSON.stringify(stable(controls))),native=controlHash==='5dca68dd419fb7025d945179e5e038eefb9074ae60557e5144f587bd92ce4f1a';
 if(!native&&controlHash!=='79a7691ad48ec12828c779e2f58251f598788bba81566f19dd5d41aaa4765525')fail();
 const step=job.steps[index],checkout=job.steps.find(s=>s.uses==='actions/checkout@v4'&&s.with?.path==='source');
 if(!checkout||checkout.with.ref!=='${{ inputs.head_revision || github.event.pull_request.head.sha || github.sha }}'
  ||step['working-directory']!=='source'||step.run!=='node --test '+SOURCE_NODE_ROOTS.join(' ')||step.if!==(native?"github.repository == 'perfectuser21/cecelia' && (!inputs.source_repo || inputs.source_repo == github.repository)":undefined))fail();
 for(const path of SOURCE_NODE_ROOTS){
  if(!paths.includes(path))fail();await read(path);
  relations.push({consumer_path:IMPACT_WORKFLOW,input_path:path,kind:native?'native_repository_source_node_test_entry':'unconditional_source_node_test_entry',revision});
 }
}

// 自身active入口与foreign inactive证明分离。完整原子版本同时封workflow、controller、opaque lease及真实register链。
const ACTIVE_TYPED_PATHS = [
 ".github/workflows/ci-admission-baseline.yml",
 ".github/workflows/implementation-impact.yml","scripts/ci/implementation-multi-pr-gate.mjs",
 "scripts/ci/implementation-pr-gate.mjs","scripts/ci/implementation-multi-scope.mjs",
 "scripts/ci/implementation-snapshot.mjs","scripts/ci/implementation-scratch.mjs",
 "scripts/ci/implementation-gate.mjs","scripts/ci/implementation-pr-baseline.mjs",
 "scripts/ci/implementation-infra-inputs.mjs","scripts/ci/implementation-skill-source.mjs",
 "scripts/ci/ci-admission-inputs.mjs","scripts/ci/ci-admission-handoff.mjs",
 "scripts/ci/ci-admission-artifact.mjs","scripts/ci/ci-admission-envelope.mjs",
 "scripts/ci/ci-admission-authority.mjs","scripts/ci/ci-admission-archive.mjs",
 "scripts/ci/ci-admission-scratch.mjs","scripts/ci/ci-admission-seed.mjs",
 "scripts/ci/ci-admission-builder.mjs","scripts/ci/ci-admission-worker.mjs",
 "scripts/ci/ci-admission-worker-runner.mjs","scripts/ci/ci-admission-publisher.mjs",
 "scripts/ci/implementation-verification-inputs.mjs","scripts/ci/implementation-verification-context.mjs",
 "scripts/ci/implementation-verification-selectors.mjs","scripts/ci/implementation-verification-retirements.mjs",
 "scripts/ci/implementation-auxiliary-evidence.mjs","scripts/ci/fixed-local-git.mjs",
 "packages/brain/src/lib/existing-ops-registration.js","packages/brain/src/lib/implementation-ci-snapshot.js",
 "scripts/ci/config/ci-admission-registry.json",
];
// 旧1f仅是未合并原型，包含已知输出缺陷；历史legacy/read-only组合另行保留。
const ACTIVE_TYPED_TUPLE = '4ba0369ba3011622dc3a46e6b155610972d4eb79f6c3fafee73ef14554efda45';
/** null只表示旧入口；未来入口证明失败绝不回落到legacy资格。 */
export async function collectNativeFutureImpactSources({basicCi,read,parse,revision,relations}){
 const workflow=await read(IMPACT_WORKFLOW);
 if(!workflow||!workflow.includes('IMPLEMENTATION_CI_ADMISSION_INPUT_DIR'))return null;
 if(!basicCi)return false;
 try{
  const texts=new Map([[IMPACT_WORKFLOW,workflow]]),rows=[];
  for(const path of ACTIVE_TYPED_PATHS){const text=texts.get(path)??await read(path);if(!text)return false;texts.set(path,text);rows.push([path,digest(text)]);}
  if(digest(JSON.stringify(rows))!==ACTIVE_TYPED_TUPLE)return false;
  const programs=new Map([...texts].filter(([p])=>p.endsWith('.mjs')||p.endsWith('.js')).map(([p,text])=>[p,parse(text)]));
  const ci=name=>'scripts/ci/'+name+'.mjs',program=name=>programs.get(ci(name));
  const fn=(name,id)=>{const nodes=[];inspectNodes(program(name),n=>{if(n.type==='FunctionDeclaration'&&n.id?.name===id)nodes.push(n);});if(nodes.length!==1)fail();return nodes[0];};
  const calls=(body,name)=>{const nodes=[];inspectNodes(body,n=>{if(n.type==='CallExpression'&&n.callee.type==='Identifier'&&n.callee.name===name)nodes.push(n);});return nodes;};
  const returned=(body,name)=>{const nodes=[];inspectNodes(body,n=>{if(n.type==='ReturnStatement'){const c=n.argument?.type==='AwaitExpression'?n.argument.argument:n.argument;if(c?.type==='CallExpression'&&c.callee.name===name)nodes.push(c);}});if(nodes.length!==1)fail();return nodes[0];};
  const field=(object,key)=>property(object,key),id=(node,name)=>node?.type==='Identifier'&&node.name===name;
  const member=(node,object,key)=>node?.type==='MemberExpression'&&!node.computed&&id(node.object,object)&&id(node.property,key);
  const multi=fn('implementation-multi-pr-gate','runImplementationCiAdmissionHandleGate');
  const handoff=returned(multi,'withCiAdmissionInputsScratch'),callback=handoff.arguments[1];
  if(!id(handoff.arguments[0],'handle')||callback?.type!=='ArrowFunctionExpression'||!callback.async)fail();
  const collected=calls(callback,'collectImplementationPrEvidenceInScratch');if(collected.length!==1)fail();
  const input=collected[0].arguments[0];
  if(!['db','base','head','mode','repoRoot','toolingRoot'].every(k=>id(field(input,k),k))||!['snapshotBase','snapshotHead'].every(k=>id(field(input,k),'snapshot'))||!member(field(input,'scope'),'snapshot','scope'))fail();
  const entry=fn('implementation-multi-pr-gate','runImplementationMultiPrGate');
  if(calls(entry,'loadCiAdmissionInputs').length!==1||calls(entry,'runImplementationCiAdmissionHandleGate').length!==1)fail();
  const collect=fn('implementation-pr-gate','collectImplementationPrEvidenceInScratch'),evidence=returned(collect,'implementationPrEvidence');
  if(!id(evidence.arguments[0],'options')||!literal(evidence.arguments[1],false)||!member(field(evidence.arguments[2],'db'),'options','db'))fail();
  const projected=calls(fn('implementation-pr-gate','implementationPrEvidence'),'buildPrImplementationSnapshot');
  if(projected.length!==1||!member(projected[0].arguments[0],'scratch','db')||!id(projected[0].arguments[2],'head'))fail();
  const native=calls(fn('implementation-snapshot','buildPrImplementationSnapshot'),'registerExistingOpsSources');
  if(native.length!==1||!id(native[0].arguments[0],'db')||!id(field(native[0].arguments[1],'readSource'),'nativeRead')||!member(field(native[0].arguments[1],'revision'),'anchor','revision')||!literal(field(native[0].arguments[1],'mode'),'scratch_candidate'))fail();
  const lease=fn('ci-admission-inputs','withCiAdmissionInputsScratch'),leases=calls(lease,'withCiAdmissionScratch');
  if(leases.length!==1||!member(field(leases[0].arguments[1],'db'),'scratch','db')||!literal(field(leases[0].arguments[1],'usage'),'pr'))fail();
  const builder=calls(fn('ci-admission-builder','buildCiAdmissionDraft'),'registerExistingOpsSources');
  if(builder.length!==1||!id(builder[0].arguments[0],'db')||!id(field(builder[0].arguments[1],'revision'),'sourceRevision')||!literal(field(builder[0].arguments[1],'mode'),'scratch_candidate'))fail();
  // 所有边均来自同一read包装实际读到的、完整封印版本；不执行候选源码。
  relations.push({consumer_path:IMPACT_WORKFLOW,input_path:ci('implementation-multi-pr-gate'),kind:'ci_admission_only_native_pr_runner',revision});
  for(const [path,program]of programs)inspectNodes(program,node=>{
   const specifier=node.type==='ImportDeclaration'?node.source:node.type==='ImportExpression'?node.source:null;
   if(typeof specifier?.value!=='string'||!specifier.value.startsWith('.'))return;
   const resolved=new URL(specifier.value,'file:///'+path).pathname.slice(1);
   if(texts.has(resolved))relations.push({consumer_path:path,input_path:resolved,kind:'sealed_ci_admission_import',revision});
  });
  relations.push({consumer_path:ci('ci-admission-builder'),input_path:'scripts/ci/config/ci-admission-registry.json',kind:'sealed_synthetic_ci_registry',revision});
  return true;
 }catch{return false;}
}
