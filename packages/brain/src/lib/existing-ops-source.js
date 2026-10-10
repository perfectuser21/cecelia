/** 已有工厂活动的只读消费者证据；不执行源码，也不声明完整流程可运行。 */
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import yaml from 'js-yaml';
let parse;
async function requireParser() {
  if (parse) return;
  try { parse = (await import('acorn')).parse; }
  catch { throw Object.assign(Error('消费者来源解析器不可用，来源不能核实'), { code: 'OPS_SOURCE_PARSER_UNAVAILABLE', status: 503 }); }
}

export const EXISTING_OPS_REPO = 'perfectuser21/cecelia';
export const EXISTING_OPS_SCOPE = 'cecelia-factory';
// 仅固定 Git 源携带此版本才扩展证据；旧冻结修订的消费者绑定必须保持原样。
export const EXISTING_OPS_SELECTOR_SCHEMA = 2;
export const EXISTING_OPS_IDENTITIES = Object.freeze([
  { workflow_id: '7743d66a-d3e0-4ebf-b82d-3f5d2d769fb1', workflow_key: 'factory_f2_ops', capability_id: '2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6', activity_id: '0ab79a73-1ec3-4ddc-bb88-1433568ae2e2', reference_id: 'a83b69b9-f426-4958-8cef-7560659ef6f8', slot_key: 'step_1', sequence_no: 1,
    unverified_reference_ids: ['3584783c-b847-4eb7-8920-76834cafba38', '5d963288-2dde-4b08-9f8c-5cd7d391a76f', 'c9a31a17-0751-4cad-a982-99325461fdf3'] },
  { workflow_id: 'c308acc7-89ec-4c18-aff6-fd67fdf31ea3', workflow_key: 'factory_f3_ops', capability_id: 'ec4eb591-e064-4886-a7b6-4452cdf333d2', activity_id: '0466016e-6d9f-4325-aeb4-d8bc70424a48', reference_id: '74c9f7ed-6bb3-4b22-b426-7dde0e99cad5', slot_key: 'step_1', sequence_no: 1,
    unverified_reference_ids: ['69f2f796-c462-478e-bd80-3ab91fb2d25e', 'c6dfe695-6677-4104-9f03-f6d33d66c4bd', '8fcfdf94-5ad5-4ddf-ae74-24b12efe3918'] },
]);
const hash = text => createHash('sha256').update(text).digest('hex');
const sourcePath = path => typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !/[\\*?\0#]/.test(path) && !path.split('/').some(p => !p || p === '.' || p === '..');
const shellLines = text => text.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
const member = (node, object, property) => node?.type === 'MemberExpression' && !node.computed && node.object?.name === object && node.property?.name === property;
const call = (node, object, property) => node?.type === 'CallExpression' && member(node.callee, object, property);
const literal = (node, value) => node?.type === 'Literal' && node.value === value;
function nodes(root) {
  const result = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') result.push(node);
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
  }
  visit(root); return result;
}
const ast = text => parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
/** 只接受现行runner的直接try/for数据流；注释、字符串及未执行支路不能提供证据。 */
function migrationInputProven(text) {
  if (!text) return false;
  const program = ast(text);
  const declarations = program.body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations);
  const directory = declarations.find(n => n.id.name === 'MIGRATIONS_DIR')?.init;
  if (!call(directory, 'path', 'join') || directory.arguments[0]?.name !== '__dirname' || !literal(directory.arguments[1], '..') || !literal(directory.arguments[2], 'migrations') || directory.arguments.length !== 3) return false;
  const fn = program.body.find(n => n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'FunctionDeclaration' && n.declaration.id.name === 'runMigrations')?.declaration;
  const body = fn?.body.body.find(n => n.type === 'TryStatement')?.block.body;
  if (!body) return false;
  const files = body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations).find(n => n.id.name === 'files')?.init;
  const filter = files?.callee?.object, discovery = filter?.callee?.object, predicate = filter?.arguments?.[0];
  if (files?.type !== 'CallExpression' || files.callee?.property?.name !== 'sort' || files.arguments.length !== 0
    || filter?.type !== 'CallExpression' || filter.callee?.property?.name !== 'filter' || filter.arguments.length !== 1
    || !call(discovery, 'fs', 'readdirSync') || discovery.arguments.length !== 1 || discovery.arguments[0]?.name !== 'MIGRATIONS_DIR'
    || predicate?.type !== 'ArrowFunctionExpression' || predicate.params.length !== 1 || !call(predicate.body, predicate.params[0].name, 'endsWith') || !literal(predicate.body.arguments[0], '.sql')) return false;
  const loop = body.find(n => n.type === 'ForOfStatement' && n.right?.name === 'files' && n.left?.declarations?.[0]?.id?.name === 'file');
  const sql = loop?.body.body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations).find(n => n.id.name === 'sql')?.init;
  if (!call(sql, 'fs', 'readFileSync') || !call(sql.arguments[0], 'path', 'join') || sql.arguments[0].arguments[0]?.name !== 'MIGRATIONS_DIR' || sql.arguments[0].arguments[1]?.name !== 'file') return false;
  const query = loop.body.body.find(n => n.type === 'TryStatement')?.block.body.find(n => n.type === 'ExpressionStatement' && n.expression?.type === 'AwaitExpression' && call(n.expression.argument, 'client', 'query') && n.expression.argument.arguments[0]?.name === 'sql');
  return Boolean(query);
}
function literalSqlInputs(text) {
  const program = ast(text);
  if (!program.body.some(n => n.type === 'ImportDeclaration' && ['node:fs', 'fs'].includes(n.source.value) && n.specifiers.some(s => s.type === 'ImportSpecifier' && s.imported.name === 'readFileSync' && s.local.name === 'readFileSync'))) return [];
  return nodes(program).filter(n => n.type === 'CallExpression' && n.callee?.name === 'readFileSync' && n.arguments[0]?.type === 'NewExpression' && n.arguments[0].callee?.name === 'URL')
    .map(n => n.arguments[0]).filter(n => typeof n.arguments[0]?.value === 'string' && n.arguments[1]?.type === 'MemberExpression' && n.arguments[1].object?.type === 'MetaProperty' && n.arguments[1].object.meta?.name === 'import' && n.arguments[1].object.property?.name === 'meta' && n.arguments[1].property?.name === 'url')
    .map(n => n.arguments[0].value);
}
function nativeTestSelectorProven(text) {
  const config = ast(text).body.find(n => n.type === 'ExportDefaultDeclaration')?.declaration;
  if (config?.type !== 'CallExpression' || config.callee?.name !== 'defineConfig') return false;
  const test = config.arguments[0]?.properties?.find(p => p.key?.name === 'test')?.value;
  const include = test?.properties?.find(p => p.key?.name === 'include')?.value;
  return include?.type === 'ArrayExpression' && include.elements.some(n => literal(n, 'src/**/*.{test,spec}.?(c|m)[jt]s?(x)'));
}
/** 仅证明现有毕业池，避免逐个远程读取整个 unit 树。未知配置/语法不能扩大认领。 */
function regressionSelectors(text) {
  const program = ast(text);
  const imported = program.body.find(n => n.type === 'ImportDeclaration' && literal(n.source, 'vitest/config'));
  if (!imported?.specifiers.some(n => n.type === 'ImportSpecifier' && n.imported.name === 'defineConfig' && n.local.name === 'defineConfig')) throw Error('selector_import_unproven');
  const config = program.body.find(n => n.type === 'ExportDefaultDeclaration')?.declaration;
  if (config?.type !== 'CallExpression' || config.callee?.name !== 'defineConfig' || config.arguments.length !== 1) throw Error('selector_config_unproven');
  const object = config.arguments[0];
  const property = (parent, key) => {
    if (parent?.type !== 'ObjectExpression' || parent.properties.some(p => p.type === 'SpreadElement' || p.computed)) throw Error('selector_object_unproven');
    const matches = parent.properties.filter(p => (p.key?.name ?? p.key?.value) === key);
    if (matches.length !== 1 || matches[0].kind !== 'init') throw Error('selector_property_unproven');
    return matches[0].value;
  };
  const test = property(object, 'test');
  const postgres = integrationConfigInputs(text).map(path => path.slice('packages/brain/'.length));
  const array = node => {
    if (node?.type !== 'ArrayExpression') throw Error('selector_array_unproven');
    return node.elements.flatMap(n => {
      if (n?.type === 'Literal' && typeof n.value === 'string') return [n.value];
      if (n?.type === 'SpreadElement' && n.argument?.name === 'POSTGRES_INTEGRATION_TESTS') return postgres;
      throw Error('selector_literal_unproven');
    });
  };
  // 支持当前配置实际使用的 glob 子集；新语法必须重新证明，不能猜匹配结果。
  const compile = pattern => {
    if (!pattern || pattern.startsWith('/') || /[\\\0]/.test(pattern)) throw Error('selector_path_unproven');
    const normalized = posix.normalize(`packages/brain/${pattern}`);
    if (normalized === '..' || normalized.startsWith('../')) throw Error('selector_escapes_repo');
    let result = '';
    for (let i = 0; i < normalized.length;) {
      const rest = normalized.slice(i);
      if (rest.startsWith('**/') && (i === 0 || normalized[i - 1] === '/')) { result += '(?:[^/]+/)*'; i += 3; }
      else if (rest === '**' && (i === 0 || normalized[i - 1] === '/')) { result += '.*'; i += 2; }
      else if (rest.startsWith('**')) throw Error('selector_globstar_unproven');
      else if (rest[0] === '*') { result += '[^/]*'; i++; }
      else if (rest.startsWith('?(')) {
        const group = rest.match(/^\?\(([a-zA-Z]+(?:\|[a-zA-Z]+)*)\)/);
        if (!group) throw Error('selector_extglob_unproven');
        result += `(?:${group[1]})?`; i += group[0].length;
      } else if (rest[0] === '?') { result += '[^/]'; i++; }
      else if (rest[0] === '{') {
        const group = rest.match(/^\{([a-zA-Z0-9_-]+(?:,[a-zA-Z0-9_-]+)+)\}/);
        if (!group) throw Error('selector_braces_unproven');
        result += `(?:${group[1].split(',').join('|')})`; i += group[0].length;
      } else if (rest[0] === '[') {
        const group = rest.match(/^\[([a-zA-Z0-9]+)\]/);
        if (!group) throw Error('selector_class_unproven');
        result += group[0]; i += group[0].length;
      } else if (/^[a-zA-Z0-9_/@:-]$/.test(rest[0])) { result += rest[0]; i++; }
      else if (rest[0] === '.') { result += '\\.'; i++; }
      else throw Error('selector_glob_unproven');
    }
    return new RegExp(`^${result}$`);
  };
  return { include: array(property(test, 'include')).map(compile), exclude: array(property(test, 'exclude')).map(compile) };
}
function expandedSelectorSchema(text) {
  const declaration = ast(text).body.find(n => n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'VariableDeclaration'
    && n.declaration.declarations.some(d => d.id?.name === 'EXISTING_OPS_SELECTOR_SCHEMA'))?.declaration;
  if (!declaration) return false;
  const value = declaration.declarations.find(d => d.id?.name === 'EXISTING_OPS_SELECTOR_SCHEMA')?.init;
  if (declaration.kind !== 'const' || !literal(value, 2)) throw Error('selector_schema_unknown');
  return true;
}
function nativeIntegrationConfigProven(text) {
  const program = ast(text);
  const imported = program.body.find(n => n.type === 'ImportDeclaration' && literal(n.source, './vitest.config.js'));
  if (!imported?.specifiers.some(n => n.type === 'ImportDefaultSpecifier' && n.local.name === 'brainConfig')
    || !imported.specifiers.some(n => n.type === 'ImportSpecifier' && n.imported.name === 'POSTGRES_INTEGRATION_TESTS' && n.local.name === 'POSTGRES_INTEGRATION_TESTS')) return false;
  const config = program.body.find(n => n.type === 'ExportDefaultDeclaration')?.declaration;
  if (config?.type !== 'CallExpression' || config.callee?.name !== 'defineConfig') return false;
  const test = config.arguments[0]?.properties?.find(p => p.key?.name === 'test')?.value;
  const exclude = test?.properties?.find(p => p.key?.name === 'exclude')?.value;
  if (exclude?.type !== 'CallExpression' || exclude.callee?.property?.name !== 'filter' || exclude.callee.object?.property?.name !== 'exclude'
    || !member(exclude.callee.object.object, 'brainConfig', 'test')) return false;
  const predicate=exclude.arguments[0],name=predicate?.params?.[0]?.name,body=predicate?.body;
  return predicate?.type==='ArrowFunctionExpression'&&predicate.params.length===1&&body?.type==='LogicalExpression'&&body.operator==='&&'
    &&body.left?.type==='BinaryExpression'&&body.left.operator==='!=='&&body.left.left?.name===name&&literal(body.left.right,'src/__tests__/integration/**')
    &&body.right?.type==='UnaryExpression'&&body.right.operator==='!'&&call(body.right.argument,'POSTGRES_INTEGRATION_TESTS','includes')
    &&body.right.argument.arguments.length===1&&body.right.argument.arguments[0]?.name===name;
}
function integrationConfigInputs(text) {
  const declaration=ast(text).body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.type==='VariableDeclaration'
    &&n.declaration.declarations.some(d=>d.id.name==='POSTGRES_INTEGRATION_TESTS'))?.declaration.declarations.find(d=>d.id.name==='POSTGRES_INTEGRATION_TESTS');
  if(declaration?.init?.type!=='ArrayExpression'||declaration.init.elements.some(n=>n?.type!=='Literal'||typeof n.value!=='string'))throw Error('integration_inputs_unproven');
  return declaration.init.elements.map(n=>`packages/brain/${n.value}`).filter(sourcePath);
}
function deployRouteProven(text) {
  const handler = nodes(ast(text)).find(n => call(n, 'router', 'post') && literal(n.arguments[0], '/deploy'))?.arguments[1];
  if (!handler?.body || !['FunctionExpression', 'ArrowFunctionExpression'].includes(handler.type)) return false;
  const declarations = handler.body.body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations);
  const script = declarations.find(n => n.id?.name === 'scriptDir')?.init;
  const args = declarations.find(n => n.id?.name === 'args')?.init;
  const spawn = declarations.find(n => n.id?.name === 'child')?.init;
  return script?.type === 'TemplateLiteral' && script.expressions.length === 1 && script.expressions[0]?.name === 'repoRoot'
    && script.quasis[0].value.cooked === '' && script.quasis[1].value.cooked === '/scripts/deploy-local.sh'
    && args?.type === 'ArrayExpression' && literal(args.elements[0], 'bash') && args.elements[1]?.name === 'scriptDir'
    && spawn?.type === 'CallExpression' && spawn.callee?.name === 'spawn'
    && spawn.arguments[0]?.type === 'MemberExpression' && spawn.arguments[0].object?.name === 'args' && literal(spawn.arguments[0].property, 0)
    && call(spawn.arguments[1], 'args', 'slice') && literal(spawn.arguments[1].arguments[0], 1);
}
function workflowRuns(text) {
  const doc = yaml.load(text), runs = [];
  if (!doc?.jobs || typeof doc.jobs !== 'object') return runs;
  for (const [job, value] of Object.entries(doc.jobs)) for (const step of value.steps || [])
    if (typeof step.run === 'string') runs.push({ job, run: step.run, env: { ...(value.env || {}), ...(step.env || {}) } });
  return runs;
}
// 唯一已审核的条件shell协议；改变分支/命令/退出语义必须重新证明，不接受字符串扫描。
const IMPACT_WORKFLOW='.github/workflows/implementation-impact.yml';
const MULTI_ENTRY='scripts/ci/implementation-multi-pr-gate.mjs', MULTI_SOURCE='scripts/ci/implementation-multi-scope.mjs';
const LEGACY_IMPACT_GATE_SHA256='4b63956a9e5f6753f8fb9cb4d1ddada6fa4e281f1cd45dd4078afc0a5f3dc522';
const LEGACY_ADMISSION_SCOPES="${{ inputs.admission_scopes || vars.IMPLEMENTATION_ADMISSION_SCOPES || '' }}";
const SELF_PR_ADMISSION_SCOPES="${{ inputs.admission_scopes || vars.IMPLEMENTATION_ADMISSION_SCOPES || (github.event_name == 'pull_request' && github.repository == 'perfectuser21/cecelia' && '{\"schema_version\":1,\"scopes\":[\"cecelia-kr\",\"cecelia-factory\"]}' || '') }}";
const IMPACT_GATE_SHA256='8e54cd03b82a18c8c94eaf0a438744193e093d680aa133f416e33ba4ca3ae21d';
function impactRunnerProven(text){
  const doc=yaml.load(text),input=doc?.on?.workflow_call?.inputs?.admission_scopes,job=doc?.jobs?.gate;
  if(!input||Object.keys(input).sort().join(',')!=='default,required,type'||input.required!==false||input.type!=='string'||input.default!=='')return false;
  if(!doc.on.pull_request||job?.if!=="always() && (github.event_name == 'pull_request' || needs.snapshot-main.result == 'success')"
    ||job.env?.MODE!=="${{ inputs.mode || (github.event_name == 'pull_request' && 'pr' || 'main') }}"
    ||![LEGACY_ADMISSION_SCOPES,SELF_PR_ADMISSION_SCOPES].includes(job.env?.ADMISSION_SCOPES))return false;
  return job.steps?.some(step=>step.if===undefined&&typeof step.run==='string'&&hash(step.run)===IMPACT_GATE_SHA256);
}
function legacyImpactRunnerProven(text,prText,gateText){
 const doc=yaml.load(text),job=doc?.jobs?.gate;
 if(!doc?.on?.pull_request||job?.if!=="always() && (github.event_name == 'pull_request' || needs.snapshot-main.result == 'success')"
   ||job.env?.MODE!=="${{ inputs.mode || (github.event_name == 'pull_request' && 'pr' || 'main') }}"
   ||!job.steps?.some(step=>step.if===undefined&&typeof step.run==='string'&&hash(step.run)===LEGACY_IMPACT_GATE_SHA256))return false;
 const pr=ast(prText),gate=ast(gateText),fn=namedExport(pr,'runImplementationPrGate'),gateFn=namedExport(gate,'runImplementationGate');
 const delegated=fn?.body.body.at(-1)?.type==='ReturnStatement'&&fn.body.body.at(-1).argument?.callee?.name==='implementationPrEvidence'&&literal(fn.body.body.at(-1).argument.arguments[1],true);
 if(delegated&&fn.body.body.slice(0,-1).some(n=>n.type!=='IfStatement'||n.test?.type!=='MemberExpression'||n.test.object?.name!=='options'||!['multi','extractScopes'].includes(n.test.property?.name)))return false;
 const caller=delegated?pr.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='implementationPrEvidence'):fn;
 const statements=caller?.body.body.find(n=>n.type==='TryStatement')?.block.body;
 return namedImport(pr,'./implementation-gate.mjs',['runImplementationGate'])
   &&variableCall(statements,'receipt','runImplementationGate',true)
   &&!statements.slice(0,-1).some(n=>{
     if(delegated&&n.type==='IfStatement'&&n.test?.type==='UnaryExpression'&&n.test.operator==='!'&&n.test.argument?.name==='execute'&&n.consequent?.type==='ReturnStatement')return false;
     return nodes(n).some(x=>x.type==='ReturnStatement');
   })
   &&variableCall(gateFn?.body.body,'assertions','runRegisteredAssertions',true)
   &&cliInvokes(pr,prText,'runImplementationPrGate');
}
function cliInvokes(program,text,name){
 const cli=program.body.find(n=>n.type==='IfStatement'&&text.slice(n.test.start,n.test.end)==="process.argv[1]&&fileURLToPath(import.meta.url)===realpathSync(process.argv[1])");
 const body=cli?.consequent?.type==='BlockStatement'?cli.consequent.body:[cli?.consequent];
 if(body.length!==1)return false;
 const catchCall=body[0]?.expression,thenCall=catchCall?.callee?.object,run=thenCall?.callee?.object;
 return catchCall?.callee?.property?.name==='catch'&&thenCall?.callee?.property?.name==='then'&&run?.callee?.name===name;
}

function namedExport(program,name){return program.body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.type==='FunctionDeclaration'&&n.declaration.id?.name===name)?.declaration;}
function namedImport(program,path,names){
 const row=program.body.find(n=>n.type==='ImportDeclaration'&&literal(n.source,path));
 return names.every(name=>row?.specifiers.some(s=>s.type==='ImportSpecifier'&&s.imported.name===name&&s.local.name===name))
  &&!nodes(program).some(n=>(n.type==='VariableDeclarator'&&nodes(n.id).some(id=>id.type==='Identifier'&&names.includes(id.name)))
    ||n.type==='FunctionDeclaration'&&names.includes(n.id?.name))
  &&!nodes(program).some(n=>(n.type==='AssignmentExpression'&&names.includes(n.left?.name))||(n.type==='UpdateExpression'&&names.includes(n.argument?.name)));
}
function variableCall(statements,name,callee,awaited=false){
 const variable=statements?.filter(n=>n.type==='VariableDeclaration').flatMap(n=>n.declarations).find(n=>n.id?.name===name)?.init;
 const expression=awaited?(variable?.type==='AwaitExpression'?variable.argument:null):variable;
 return expression?.type==='CallExpression'&&expression.callee?.name===callee;
}
function impactImportsProven(entryText,multiText,prText,gateText){
 const entry=ast(entryText),multi=ast(multiText),fn=namedExport(entry,'runImplementationMultiPrGate');
 if(!namedImport(entry,'./implementation-pr-gate.mjs',['collectImplementationPrEvidence'])
   ||!namedImport(entry,'./implementation-multi-scope.mjs',['resolveScopedImplementationReports','runScopedImplementationGate'])
   ||!namedImport(multi,'./implementation-gate.mjs',['runRegisteredAssertions']))return false;
 const statements=fn?.body.body.find(n=>n.type==='TryStatement')?.block.body;
 if(!statements||statements.slice(0,-1).some(n=>n.type==='ReturnStatement'||n.type==='ThrowStatement'
   ||n.type==='IfStatement'&&nodes(n).some(x=>x.type==='ReturnStatement')))return false;
 const loop=statements.find(n=>n.type==='ForOfStatement'&&n.right?.name==='scopes');
 const init=loop?.body.body.find(n=>n.type==='VariableDeclaration')?.declarations?.[0];
 if(init?.id?.type!=='ObjectPattern'||!init.id.properties.some(p=>p.key.name==='report')||init.init?.type!=='AwaitExpression'
   ||init.init.argument?.callee?.name!=='collectImplementationPrEvidence'
   ||nodes(loop.body).some(n=>['ReturnStatement','BreakStatement','ContinueStatement','ThrowStatement'].includes(n.type)))return false;
 if(!variableCall(statements,'resolution','resolveScopedImplementationReports')||!variableCall(statements,'receipt','runScopedImplementationGate',true))return false;
 if(!cliInvokes(entry,entryText,'runImplementationMultiPrGate'))return false;
 const gate=namedExport(multi,'runScopedImplementationGate'),gateLoop=gate?.body.body.find(n=>n.type==='ForOfStatement'&&n.right?.type==='MemberExpression'&&n.right.object?.name==='evidence'&&n.right.property?.name==='scope_reports');
 if(!variableCall(gateLoop?.body.body,'assertions','runRegisteredAssertions',true)
   ||gate.body.body.slice(0,gate.body.body.indexOf(gateLoop)).some(n=>nodes(n).some(x=>['ReturnStatement','BreakStatement','ContinueStatement','ThrowStatement'].includes(x.type)))
   ||nodes(gateLoop.body).some(n=>['ReturnStatement','BreakStatement','ContinueStatement','ThrowStatement'].includes(n.type)))return false;
 return Boolean(namedExport(ast(prText),'collectImplementationPrEvidence')&&namedExport(ast(gateText),'runRegisteredAssertions'));
}
const NIGHTLY_READER='.github/workflows/scripts/__tests__/nightly-runtime.test.mjs';
const F5_SMOKE='packages/brain/scripts/smoke/factory-f5-cockpit-smoke.sh';
const HEALTH_SMOKE='packages/brain/scripts/smoke/healthz-smoke.sh';
function nightlyReaderProven(text) {
  const program=ast(text),imports=program.body.filter(n=>n.type==='ImportDeclaration');
  const named=(source,name)=>imports.some(n=>literal(n.source,source)&&n.specifiers.some(s=>s.type==='ImportSpecifier'&&s.imported.name===name&&s.local.name===name));
  if(!named('node:test','test')||!named('node:fs','readFileSync')||!named('node:path','join')||!named('node:child_process','spawn')||!named('node:url','fileURLToPath')
    ||!imports.some(n=>literal(n.source,'js-yaml')&&n.specifiers.some(s=>s.type==='ImportDefaultSpecifier'&&s.local.name==='yaml')))return false;
  const root=program.body.filter(n=>n.type==='VariableDeclaration').flatMap(n=>n.declarations).find(d=>d.id.name==='root')?.init;
  const url=root?.arguments?.[0],meta=url?.arguments?.[1];
  if(root?.callee?.name!=='fileURLToPath'||url?.type!=='NewExpression'||url.callee?.name!=='URL'||!literal(url.arguments[0],'../../../../')
    ||meta?.type!=='MemberExpression'||meta.object?.type!=='MetaProperty'||meta.object.meta?.name!=='import'||meta.object.property?.name!=='meta'||meta.property?.name!=='url')return false;
  const testBodies=nodes(program).filter(n=>n.type==='CallExpression'&&n.callee?.name==='test')
    .map(n=>n.arguments.find(a=>['ArrowFunctionExpression','FunctionExpression'].includes(a?.type))?.body).filter(n=>n?.type==='BlockStatement');
  const executed=program.body.filter(n=>n.type==='VariableDeclaration').flatMap(n=>n.declarations.map(d=>d.init)).concat(testBodies);
  const all=executed.flatMap(nodes);
  const yamlInput=path=>all.some(n=>call(n,'yaml','load')&&n.arguments.length===1&&n.arguments[0]?.callee?.name==='readFileSync'
    &&n.arguments[0].arguments[0]?.callee?.name==='join'&&n.arguments[0].arguments[0].arguments[0]?.name==='root'
    &&literal(n.arguments[0].arguments[0].arguments[1],path));
  const spawnProven=testBodies.some(body=>body.body.filter(n=>n.type==='VariableDeclaration').flatMap(n=>n.declarations)
    .some(d=>d.init?.type==='CallExpression'&&d.init.callee?.name==='spawn'&&literal(d.init.arguments[0],'bash')
      &&d.init.arguments[1]?.type==='ArrayExpression'&&d.init.arguments[1].elements.length===1
      &&d.init.arguments[1].elements[0]?.callee?.name==='join'&&d.init.arguments[1].elements[0].arguments[0]?.name==='root'
      &&literal(d.init.arguments[1].elements[0].arguments[1],F5_SMOKE)));
  return yamlInput('.github/workflows/ci.yml')&&yamlInput('.github/workflows/nightly-regression.yml')&&spawnProven;
}
/** readSource及paths必须由调用方同一个固定Git tree给出；中央写入另须main/CAS。 */
export async function buildExistingOpsSources({ scope, repo, revision, paths, readSource }) {
  if (scope !== EXISTING_OPS_SCOPE || repo !== EXISTING_OPS_REPO || !/^[a-f0-9]{40}$/.test(revision || '') || !Array.isArray(paths)
    || paths.some(path => !sourcePath(path)) || new Set(paths).size !== paths.length || typeof readSource !== 'function') throw Error('OPS_SOURCE_INPUT_INVALID');
  await requireParser();
  const tree = new Set(paths), consumers = [];
  async function build(identity, prove) {
    const bindings = new Map(), gaps = [], relations = [];
    async function read(path) {
      if (!tree.has(path)) { gaps.push({ code: 'source_unavailable', path }); return null; }
      try {
        const text = await readSource(path, revision);
        if (typeof text !== 'string' || !text.trim()) throw Error('empty');
        bindings.set(path, { kind: 'code', repo, path, revision, digest: `sha256:${hash(text)}`, content_sha256: hash(text), scope: 'activity', validation_scope: 'consumer_source', status: 'verified' });
        return text;
      } catch { gaps.push({ code: 'source_unavailable', path }); return null; }
    }
    const requireProof = (condition, code) => { if (!condition) gaps.push({ code }); return Boolean(condition); };
    try { await prove({ read, requireProof, relations }); }
    catch { gaps.push({ code: 'source_structure_unproven' }); }
    consumers.push({ ...identity, definition_scope: 'consumer_evidence', status: gaps.length ? 'unknown' : 'verified', gaps,
      // 部分链路不得留下可认领的成功绑定。
      bindings: gaps.length ? [] : [...bindings.values()].sort((a, b) => a.path.localeCompare(b.path)), input_relations: gaps.length ? [] : relations });
  }
  await build(EXISTING_OPS_IDENTITIES[0], async ({ read, requireProof, relations }) => {
    const deployment = await read('.github/workflows/brain-ci-deploy.yml');
    const trigger = await read('scripts/ci/gate3-trigger-deploy.sh');
    const route = await read('packages/brain/src/routes/ops.js');
    const local = await read('scripts/deploy-local.sh');
    const deploy = await read('scripts/brain-deploy.sh');
    const migrate = await read('packages/brain/src/migrate.js');
    const auth = await read('scripts/lib/internal-auth-token.sh');
    requireProof(deployment && workflowRuns(deployment).some(r => shellLines(r.run).some(line => /^HTTP_CODE=\$\(bash scripts\/ci\/gate3-trigger-deploy\.sh "\$\{BRAIN_URL\}"\)$/.test(line))), 'deployment_entry_unproven');
    requireProof(trigger && shellLines(trigger).some(line => /-X POST "\$\{BRAIN_URL\}\/api\/brain\/deploy"/.test(line)), 'deploy_request_unproven');
    requireProof(route && deployRouteProven(route), 'deploy_route_unproven');
    requireProof(local && shellLines(local).includes('bash "$MAIN_SCRIPTS/brain-deploy.sh"'), 'deployment_script_unproven');
    requireProof(deploy && shellLines(deploy).some(line => /\bnode src\/migrate\.js(?:\)|\s|$)/.test(line) && !line.startsWith('echo ')), 'migration_execution_unproven');
    requireProof(auth && deploy && shellLines(deploy).includes('source "$SCRIPT_DIR/lib/internal-auth-token.sh"') && shellLines(deploy).some(line=>/^ensure_cecelia_internal_token "\$CECELIA_INTERNAL_ENV_FILE" \|\| exit 1$/.test(line)), 'deployment_auth_helper_unproven');
    if(auth)relations.push({consumer_path:'scripts/brain-deploy.sh',input_path:'scripts/lib/internal-auth-token.sh',kind:'bash_source_call',revision});
    const inputProven = migrationInputProven(migrate);
    if (requireProof(inputProven, 'migration_input_unproven')) for (const path of paths.filter(path => /^packages\/brain\/migrations\/[^/]+\.sql$/.test(path))) {
      if (await read(path)) relations.push({ consumer_path: 'packages/brain/src/migrate.js', input_path: path, kind: 'migration_sql', selector: 'top_level_sql_sorted', revision });
    }
  });
  await build(EXISTING_OPS_IDENTITIES[1], async ({ read, requireProof, relations }) => {
    const nightly = await read('.github/workflows/nightly-regression.yml');
    const ci = await read('.github/workflows/ci.yml');
    const config = await read('packages/brain/vitest.config.js');
    const integrationConfig = await read('packages/brain/vitest.integration.config.js');
    const nightlyRuns = nightly ? workflowRuns(nightly) : [];
    requireProof(nightlyRuns.some(r => shellLines(r.run).some(line => /^npx vitest run --shard=\$SHARD\/6\b/.test(line))), 'nightly_full_unit_unproven');
    requireProof(nightlyRuns.some(r => shellLines(r.run).some(line => /^cd packages\/brain && npx vitest run (?:--config vitest\.integration\.config\.js )?src\/__tests__\/integration\/(?:\s|$)/.test(line))), 'nightly_integration_unproven');
    requireProof(ci && workflowRuns(ci).some(r => shellLines(r.run.replace(/\\\r?\n/g, ' ')).some(line => /^npx vitest run\s+--config vitest\.integration\.config\.js\b/.test(line))), 'ci_integration_unproven');
    requireProof(config && nativeTestSelectorProven(config), 'native_test_selector_unproven');
    requireProof(integrationConfig && nativeIntegrationConfigProven(integrationConfig), 'native_integration_config_unproven');
    const schemaPath = 'packages/brain/src/lib/existing-ops-source.js';
    // 读取固定修订的协议标记，不向旧修订追加新的 binding 或重写其摘要。
    const expanded = tree.has(schemaPath) && expandedSelectorSchema(await readSource(schemaPath, revision));
    const selectors = expanded && config ? regressionSelectors(config) : null;
    if (selectors) for (const path of paths.filter(path => path.startsWith('tests/regression/') && !path.split('/').some(part => part.startsWith('.'))
      && selectors.include.some(pattern => pattern.test(path)) && !selectors.exclude.some(pattern => pattern.test(path)))) {
      if (await read(path)) relations.push({ consumer_path: 'packages/brain/vitest.config.js', input_path: path,
        kind: 'literal_vitest_regression_selector', selector: 'native_nightly_include_minus_exclude', revision });
    }
    const ciDoc = ci ? yaml.load(ci) : null, versionJob = 'brain-version-bump-gate', versionPath = 'scripts/ci/check-brain-version-bump.sh';
    if (expanded && ciDoc?.jobs?.[versionJob]) {
      const job = ciDoc.jobs[versionJob];
      const invoked = job.if === "github.event_name == 'pull_request'" && ciDoc.jobs['ci-passed']?.needs?.includes(versionJob)
        && job.steps?.some(step => step.if === undefined && typeof step.run === 'string' && step.run.trim() === `bash ${versionPath}`);
      if (requireProof(invoked, 'required_version_gate_unproven') && await read(versionPath))
        relations.push({ consumer_path: '.github/workflows/ci.yml', input_path: versionPath, kind: 'required_pr_bash_gate', revision });
    }
    // 老main没有新入口时保留旧证据；一旦入口存在，其真实条件流与所有依赖必须全部证明。
    let multiWorkflow=false;
    if(tree.has(IMPACT_WORKFLOW)){
      const text=await readSource(IMPACT_WORKFLOW,revision);
      multiWorkflow=workflowRuns(text).some(step=>hash(step.run)===IMPACT_GATE_SHA256);
    }
    if(!multiWorkflow&&tree.has(IMPACT_WORKFLOW)){
      const workflow=await read(IMPACT_WORKFLOW),prPath='scripts/ci/implementation-pr-gate.mjs',gatePath='scripts/ci/implementation-gate.mjs';
      const pr=await read(prPath),gate=await read(gatePath);
      requireProof(workflow&&pr&&gate&&legacyImpactRunnerProven(workflow,pr,gate),'legacy_impact_runner_unproven');
      relations.push({consumer_path:IMPACT_WORKFLOW,input_path:prPath,kind:'direct_admission_runner',revision},
        {consumer_path:prPath,input_path:gatePath,kind:'reachable_named_import_call',revision});
    }
    if(multiWorkflow){
      const workflow=await read(IMPACT_WORKFLOW),entry=await read(MULTI_ENTRY),multi=await read(MULTI_SOURCE);
      const prPath='scripts/ci/implementation-pr-gate.mjs',gatePath='scripts/ci/implementation-gate.mjs';
      const pr=await read(prPath),gate=await read(gatePath);
      requireProof(workflow&&impactRunnerProven(workflow),'impact_pr_runner_unproven');
      requireProof(entry&&multi&&pr&&gate&&impactImportsProven(entry,multi,pr,gate),'impact_reachable_import_unproven');
      relations.push({consumer_path:IMPACT_WORKFLOW,input_path:MULTI_ENTRY,kind:'conditional_pr_admission_runner',revision},
        ...[[MULTI_ENTRY,MULTI_SOURCE],[MULTI_ENTRY,prPath],[MULTI_SOURCE,gatePath]].map(([consumer_path,input_path])=>({consumer_path,input_path,kind:'reachable_named_import_call',revision})));
    }
    if(tree.has(NIGHTLY_READER)){
      const doc=ci?yaml.load(ci):null,job='lint-auto-merge-decision';
      const invoked=doc?.jobs?.[job]?.steps?.some(s=>typeof s.run==='string'&&shellLines(s.run).includes(`node --test ${NIGHTLY_READER}`));
      requireProof(invoked&&doc.jobs['ci-passed']?.needs?.includes(job),'nightly_reader_ci_unproven');
      const reader=await read(NIGHTLY_READER),smoke=await read(F5_SMOKE);
      requireProof(reader&&nightlyReaderProven(reader),'nightly_reader_inputs_unproven');
      requireProof(smoke&&shellLines(smoke).some(line=>line==='bash "$(dirname "${BASH_SOURCE[0]}")/healthz-smoke.sh" \\'),'nightly_health_script_unproven');
      await read(HEALTH_SMOKE);
      relations.push({consumer_path:'.github/workflows/ci.yml',input_path:NIGHTLY_READER,kind:'required_node_test',revision},
        ...['.github/workflows/ci.yml','.github/workflows/nightly-regression.yml'].map(input_path=>({consumer_path:NIGHTLY_READER,input_path,kind:'yaml_readfile_input',revision})),
        {consumer_path:NIGHTLY_READER,input_path:F5_SMOKE,kind:'node_test_spawn_bash',revision},
        {consumer_path:F5_SMOKE,input_path:HEALTH_SMOKE,kind:'relative_bash_call',revision});
    }
    // CI确实还原配置literal PG清单；没有实际选择器的其它文件继续不认领。
    const explicit=paths.filter(path => /^packages\/brain\/src\/__tests__\/integration\/[^\n]+\.(?:test|spec)\.(?:[cm]?js)$/.test(path));
    const configured=config?integrationConfigInputs(config).filter(path=>tree.has(path)&&/\.(?:[cm]?js)$/.test(path)):[];
    for (const path of [...new Set([...explicit,...configured])]) {
      const test = await read(path);
      if (!test) continue;
      relations.push({ consumer_path: explicit.includes(path)?'.github/workflows/nightly-regression.yml':'packages/brain/vitest.integration.config.js', input_path: path,
        kind: explicit.includes(path)?'explicit_vitest_directory':'literal_postgres_config_input', revision });
      // URL必须真实readFileSync直接输入，SQL关系来自调用表达式而非目录名字。
      const inputs = literalSqlInputs(test);
      for (const inputPath of inputs) {
        const segments = path.split('/').slice(0, -1);
        for (const part of inputPath.split('/')) { if (part === '..') segments.pop(); else if (part !== '.') segments.push(part); }
        const input = segments.join('/');
        if (!/^packages\/brain\/migrations\/(?:rollback\/)?[^/]+\.sql$/.test(input)) continue;
        if (await read(input)) relations.push({ consumer_path: path, input_path: input, kind: 'literal_readfile_url_sql', revision });
      }
    }
  });
  return { schema_version: 1, scope, repo, revision, source_basis: 'fixed_git_tree', consumers,
    workflows: EXISTING_OPS_IDENTITIES.map(identity => ({ workflow_id: identity.workflow_id, key: identity.workflow_key, capability_id: identity.capability_id,
      executable: false, coverage: { status: 'unknown', verified_reference_ids: consumers.find(c => c.workflow_id === identity.workflow_id)?.status === 'verified' ? [identity.reference_id] : [], unverified_reference_ids: [...identity.unverified_reference_ids] } })) };
}
