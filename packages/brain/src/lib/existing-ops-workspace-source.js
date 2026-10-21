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
function engineSelected(config,parse){
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
 const excluded=exclude.elements.flatMap(n=>n.type==='SpreadElement'&&n.argument.name==='PARALLEL_TESTS'?parallelPaths:
  n.type==='Literal'&&typeof n.value==='string'?[n.value]:fail()).map(glob);
 const globalExclude=property(test,'exclude',false);
 if(globalExclude)excluded.push(...literals(globalExclude).map(glob));
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
async function collectEngineInputs({paths,read,parse,revision,relations}){
 if(![ENGINE_CI,ENGINE_CONFIG,ENGINE_TEST,ENGINE_SCRIPT].every(p=>paths.includes(p)))return;
 const text=await read(ENGINE_CI),doc=yaml.load(text),job=doc?.jobs?.['engine-tests'];
 if(!job)return;
 const step=job.steps?.find(s=>s.name==='Unit Tests');
 if(job.needs!=='changes'||doc.jobs.changes?.outputs?.engine!=='${{ steps.detect.outputs.engine }}'
  ||!doc.jobs.changes.steps?.some(s=>s.id==='detect'&&typeof s.run==='string')
  ||job.if!=="needs.changes.outputs.engine == 'true'"||job.defaults||job.env||job.container||job['continue-on-error']||doc.defaults
  ||!step||step.run?.trim()!=='cd packages/engine && npx vitest run --reporter=verbose'||step.if||step.env||step.shell||step['working-directory']||step['continue-on-error'])fail();
 // 这里只证明条件CI声明的输入关系；实际执行/完成仍以该次CI回执为准。
 const manifest='packages/engine/package.json',pkg=JSON.parse(await read(manifest));
 if(!pkg.devDependencies?.vitest||!job.steps.some(s=>s.run==='npm ci --workspace=packages/brain --workspace=packages/engine --ignore-scripts'&&!s.if&&!s.env&&!s['working-directory']))fail();
 if(!engineSelected(await read(ENGINE_CONFIG),parse))return;
 const test=await read(ENGINE_TEST);
 relations.push({consumer_path:ENGINE_CI,input_path:manifest,kind:'declared_engine_install_input',revision},
  {consumer_path:ENGINE_CI,input_path:ENGINE_CONFIG,kind:'required_engine_vitest_config',revision},
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
    await collectEngineInputs({paths,read,parse,revision,relations});
  } catch { unknown(); }
  return relations.map(row => ({ src_path: row.consumer_path, dst_path: row.input_path, edge_type: 'import', detail: {
    via: 'fixed_git_workspace_input', selector_kind: row.kind, source_revision: revision,
    consumer_sha256: contents.get(row.consumer_path), input_sha256: contents.get(row.input_path), selector_schema: 1,
  } }));
}
