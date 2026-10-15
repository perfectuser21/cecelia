/** 额外协议的窄执行关系证明；只解析固定 Git 字节，不执行候选代码。 */
import yaml from 'js-yaml';
const TEST = 'packages/brain/scripts/coding-workflow/runner/__tests__/run-once.test.mjs';
const SANDBOX = 'packages/brain/scripts/coding-workflow/runner/__tests__/helpers/sandbox.mjs';
const RUNNER = 'packages/brain/scripts/coding-workflow/runner/run-once.mjs';
const PROVIDER = 'scripts/ci/implementation-main-snapshot.mjs';
const PROVIDER_TEST = 'scripts/ci/__tests__/implementation-main-snapshot.test.mjs';
const WORKFLOW = '.github/workflows/implementation-impact.yml';
const canonical = value => JSON.stringify(value, (key, item) => ['start', 'end', 'raw'].includes(key) ? undefined : item);
function nodes(root) {
  if (!root || typeof root !== 'object') return [];
  return [...(root.type ? [root] : []), ...Object.values(root).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
}
const names = node => nodes(node).filter(n => n.type === 'Identifier').map(n => n.name);
function boundNames(node) {
  if (!node) return [];
  if (node.type === 'Identifier') return [node.name];
  if (node.type === 'AssignmentPattern') return boundNames(node.left);
  if (node.type === 'RestElement') return boundNames(node.argument);
  if (node.type === 'ArrayPattern') return node.elements.flatMap(boundNames);
  if (node.type === 'ObjectPattern') return node.properties.flatMap(p => boundNames(p.type === 'RestElement' ? p.argument : p.value));
  return [];
}
const declaration = n => n.type === 'ExportNamedDeclaration' ? n.declaration : n;
function imported(program, source, name, kind = 'ImportSpecifier') {
  return program.body.find(n => n.type === 'ImportDeclaration' && n.source.value === source)?.specifiers
    .find(n => n.type === kind && n.local.name === name && (kind !== 'ImportSpecifier' || n.imported.name === name));
}
/** 关键执行对象只可读固定成员；不能作为值逃逸到别名、参数或容器。 */
function escapedObject(node, parent = null) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'Identifier' && ['process','path','spawn','fileURLToPath','Promise'].includes(node.name)) {
    const bindingKey = parent?.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand;
    const memberRead = parent?.type === 'MemberExpression' && parent.object === node && !parent.computed
      && (node.name === 'process' ? ['env','execPath'].includes(parent.property.name) : node.name === 'path' && ['join','dirname'].includes(parent.property.name));
    const invocation = ['CallExpression','NewExpression'].includes(parent?.type) && parent.callee === node;
    if (!bindingKey && !memberRead && !invocation) return true;
  }
  return Object.values(node).some(value => Array.isArray(value) ? value.some(child => escapedObject(child,node)) : value && typeof value === 'object' && escapedObject(value,node));
}
/** 拒绝所有相关名字的局部遮蔽或赋值，允许列表只含已证明的唯一声明。 */
function bindingsIntact(program, protectedNames, allowed) {
  const touches = node => names(node).some(name => protectedNames.includes(name));
  return !nodes(program).some(n => {
    if (allowed.includes(n)) return false;
    if (n.type.startsWith('Import') && n.local) return protectedNames.includes(n.local.name);
    if (n.type === 'VariableDeclarator') return boundNames(n.id).some(name => protectedNames.includes(name)) || protectedNames.includes('process') && escapedObject(n.init);
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(n.type))
      return [...boundNames(n.id), ...n.params.flatMap(boundNames)].some(name => protectedNames.includes(name));
    if (n.type === 'CatchClause') return boundNames(n.param).some(name => protectedNames.includes(name));
    if (n.type === 'AssignmentExpression') return touches(n.left);
    if (n.type === 'UpdateExpression') return touches(n.argument);
    if (['CallExpression','NewExpression'].includes(n.type) && ['eval','Function'].includes(n.callee?.name)) return true;
    if (n.type === 'CallExpression' && ['Object','Reflect'].includes(n.callee?.object?.name) && ['assign','defineProperty','defineProperties','set','deleteProperty'].includes(n.callee?.property?.name)) return touches(n.arguments[0]);
    return false;
  });
}
export function runtimeSelectorEnabled(text, parse) {
  const list = parse(text).body.filter(n => n.type === 'ExportNamedDeclaration').map(declaration).filter(n => n?.type === 'VariableDeclaration')
    .flatMap(n => n.declarations.filter(d => d.id?.name === 'EXISTING_OPS_RUNTIME_SELECTOR_SCHEMA').map(d => ({ parent:n, d })));
  if (!list.length) return false;
  if (list.length !== 1 || list[0].parent.kind !== 'const' || list[0].d.init?.type !== 'Literal' || ![0,1].includes(list[0].d.init.value)) throw Error('runtime_selector_schema_unknown');
  return list[0].d.init.value === 1;
}
function testCallsRunner(text, parse) {
  const program = parse(text), required = [imported(program, 'vitest', 'describe'), imported(program, 'vitest', 'it'), imported(program, './helpers/sandbox.mjs', 'runOnceProcess')];
  if (required.some(n => !n) || !bindingsIntact(program, ['describe','it','runOnceProcess'], required)) return false;
  const callback = call => (call?.arguments?.length === 2 || call?.arguments?.length === 3 && call.arguments[2]?.type === 'Literal' && typeof call.arguments[2].value === 'number' && call.arguments[2].value > 0) && call.arguments[0]?.type === 'Literal'
    && ['ArrowFunctionExpression','FunctionExpression'].includes(call.arguments[1]?.type) && call.arguments[1].params.length === 0
    && call.arguments[1].body.type === 'BlockStatement' ? call.arguments[1].body.body : null;
  const invoked = expression => expression?.type === 'AwaitExpression' && expression.argument?.type === 'CallExpression'
    && expression.argument.callee?.name === 'runOnceProcess' && expression.argument.arguments.length === 1 && expression.argument.arguments[0].type !== 'SpreadElement';
  function active(statements, inTest = false) {
    for (const statement of statements || []) {
      if (!['ImportDeclaration','ExportNamedDeclaration','VariableDeclaration','FunctionDeclaration','ExpressionStatement','EmptyStatement'].includes(statement.type)) return false;
      if (inTest && (invoked(statement.expression) || statement.type === 'VariableDeclaration' && statement.declarations.some(d => invoked(d.init)))) return true;
      const call = statement.type === 'ExpressionStatement' ? statement.expression : null;
      if (call?.type !== 'CallExpression') continue;
      if (call.callee?.name === 'describe' && active(callback(call))) return true;
      if (call.callee?.name === 'it' && active(callback(call), true)) return true;
    }
    return false;
  }
  return active(program.body);
}
// 精确证明现有唯一子进程封套：AST 忽略格式/注释，但不猜测新控制流或新 argv。
const SANDBOX_TEMPLATE = `
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RUN_ONCE = path.join(HERE, '../../run-once.mjs');
export function runOnceProcess(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [RUN_ONCE], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}`;
function sandboxRunsRunner(text, parse) {
  const program = parse(text), template = parse(SANDBOX_TEMPLATE);
  const required = [imported(program, 'node:path', 'path', 'ImportDefaultSpecifier'), imported(program, 'node:child_process', 'spawn'), imported(program, 'node:url', 'fileURLToPath')];
  const statements = program.body.map(declaration), variables = statements.filter(n => n?.type === 'VariableDeclaration').flatMap(n => n.declarations);
  const here = variables.find(n => n.id?.name === 'HERE'), runner = variables.find(n => n.id?.name === 'RUN_ONCE');
  const fn = statements.find(n => n?.type === 'FunctionDeclaration' && n.id.name === 'runOnceProcess');
  if (required.some(n => !n) || !bindingsIntact(program, ['path','spawn','fileURLToPath','HERE','RUN_ONCE','runOnceProcess','process','Promise'], [...required,here,runner,fn])) return false;
  if (program.body.some(n => !['ImportDeclaration','VariableDeclaration','FunctionDeclaration','ExportNamedDeclaration'].includes(n.type))) return false;
  return template.body.every(expected => program.body.some(actual => canonical(actual) === canonical(expected)));
}
export async function collectRuntimeSources({ parse, paths, selectors, read, readSource, revision, relations, requireProof, ci }) {
  const selected = paths.filter(path => /^packages\/brain\/scripts\/coding-workflow\/.+\.(?:test|spec)\.(?:m?js)$/.test(path) && !path.split('/').some(p => p.startsWith('.'))
    && selectors.include.some(p => p.test(path)) && !selectors.exclude.some(p => p.test(path)));
  const relation = (consumer_path,input_path,kind) => relations.push({consumer_path,input_path,kind,revision});
  for (const path of selected) {
    const text = await read(path);
    if (text) { parse(text); relation('packages/brain/vitest.config.js',path,'literal_vitest_native_script_selector'); }
  }
  if (selected.includes(TEST)) {
    const test = await readSource(TEST,revision), sandbox = await read(SANDBOX);
    if (requireProof(testCallsRunner(test,parse) && sandbox && sandboxRunsRunner(sandbox,parse),'native_runner_execution_unproven')) {
      await read(RUNNER); relation(TEST,SANDBOX,'active_named_test_helper_call'); relation(SANDBOX,RUNNER,'native_node_runner_spawn');
    }
  }
  if (paths.includes(PROVIDER)) {
    const doc = yaml.load(await readSource(WORKFLOW,revision)), job = doc?.jobs?.['snapshot-main'];
    const run = job?.steps?.find(s => s.run?.trim() === `set -euo pipefail\nnode tooling/${PROVIDER}`);
    const checkout = job?.steps?.find(s => s.uses === 'actions/checkout@v4' && s.with?.repository === 'perfectuser21/cecelia' && s.with?.path === 'tooling');
    const guard = job?.steps?.find(s => s['working-directory'] === 'tooling' && s.run?.trim() === 'set -euo pipefail\ngit merge-base --is-ancestor HEAD origin/main');
    const ciDoc = yaml.load(ci), testJob = ciDoc?.jobs?.['lint-auto-merge-decision'];
    const rootRun = (doc, job, step, cwd) => !doc.defaults && !job.defaults && step?.['working-directory'] === cwd && step?.shell === undefined && !job['continue-on-error'] && !step?.['continue-on-error'];
    const testRun = testJob?.steps?.find(s => s.run?.trim() === `node --test ${PROVIDER_TEST}` && s.if === undefined);
    const source = checkout && guard && run && rootRun(doc,job,run,undefined) && rootRun(doc,job,guard,'tooling') && run.if === undefined && guard.if === undefined && checkout.if === undefined
      && job.steps.indexOf(checkout) < job.steps.indexOf(guard) && job.steps.indexOf(guard) < job.steps.indexOf(run)
      && job.if === "inputs.export_device_patrol_source_identity != true && github.event_name != 'pull_request' && github.ref == 'refs/heads/main'";
    if (requireProof(source && testRun && testJob.if === undefined && rootRun(ciDoc,testJob,testRun,undefined) && ciDoc.jobs['ci-passed']?.needs?.includes('lint-auto-merge-decision'),'native_provider_execution_unproven')) {
      await read(PROVIDER); await read(PROVIDER_TEST);
      relation(WORKFLOW,PROVIDER,'trusted_main_snapshot_node_entry'); relation('.github/workflows/ci.yml',PROVIDER_TEST,'required_node_test');
    }
  }
}
