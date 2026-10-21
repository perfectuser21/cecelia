/** 额外协议的窄执行关系证明；只解析固定 Git 字节，不执行候选代码。 */
import yaml from 'js-yaml';
import { createHash } from 'node:crypto';
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
    const memberKey = parent?.type === 'MemberExpression' && parent.property === node && !parent.computed;
    const memberRead = parent?.type === 'MemberExpression' && parent.object === node && !parent.computed && (node.name === 'process' ? ['env','execPath','pid'].includes(parent.property.name) : node.name === 'path' && ['join','dirname','resolve','basename'].includes(parent.property.name));
    const invocation = ['CallExpression','NewExpression'].includes(parent?.type) && parent.callee === node;
    if (!bindingKey && !memberKey && !memberRead && !invocation) return true;
  }
  return Object.values(node).some(value => Array.isArray(value) ? value.some(child => escapedObject(child,node)) : value && typeof value === 'object' && escapedObject(value,node));
}
/** 拒绝所有相关名字的局部遮蔽或赋值，允许列表只含已证明的唯一声明。 */
function bindingsIntact(program, protectedNames, allowed) {
  const touches = node => names(node).some(name => protectedNames.includes(name));
  return !nodes(program).some(n => {
    if (allowed.includes(n)) return false;
    const sandbox = protectedNames.includes('process');
    if (sandbox && n.type === 'Identifier' && ['Function','eval','globalThis','global'].includes(n.name)) return true;
    if (sandbox && ['CallExpression','NewExpression'].includes(n.type) && n.arguments.some(argument => escapedObject(argument))) return true;
    if (sandbox && n.type === 'ReturnStatement' && escapedObject(n.argument)) return true;
    if (n.type.startsWith('Import') && n.local) return protectedNames.includes(n.local.name);
    if (n.type === 'VariableDeclarator') return boundNames(n.id).some(name => protectedNames.includes(name)) || protectedNames.includes('process') && escapedObject(n.init);
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(n.type))
      return [...boundNames(n.id), ...n.params.flatMap(boundNames)].some(name => protectedNames.includes(name)) || sandbox && n.params.some(parameter => parameter.type === 'AssignmentPattern' && escapedObject(parameter.right));
    if (n.type === 'CatchClause') return boundNames(n.param).some(name => protectedNames.includes(name));
    if (n.type === 'AssignmentExpression') return touches(n.left) || sandbox && escapedObject(n.right);
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
  const optional = [imported(program,'node:path','path','ImportDefaultSpecifier'),imported(program,'node:child_process','spawn'),imported(program,'node:url','fileURLToPath')].filter(Boolean);
  if (required.some(n => !n) || !bindingsIntact(program, ['describe','it','runOnceProcess','process','path','spawn','fileURLToPath','Promise'], [...required,...optional])) return false;
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


// 两个协议由目标 Git 自己声明；旧冻结修订缺省关闭，不因当前进程升级改变其绑定。
export function ciEntrySelectorEnabled(text, parse, name) {
  const list = parse(text).body.filter(n => n.type === 'ExportNamedDeclaration').map(declaration)
    .filter(n => n?.type === 'VariableDeclaration').flatMap(n => n.declarations
      .filter(d => d.id?.name === name).map(d => ({ parent: n, d })));
  if (!list.length) return false;
  if (list.length !== 1 || list[0].parent.kind !== 'const' || list[0].d.init?.type !== 'Literal'
    || ![0, 1].includes(list[0].d.init.value)) throw Error('ci_entry_selector_schema_unknown');
  return list[0].d.init.value === 1;
}
const CI = '.github/workflows/ci.yml';
const AGGREGATE_READER = '.github/workflows/scripts/__tests__/ci-aggregate-results.test.mjs';
const SMOKE_WORKFLOW = '.github/workflows/ci-smoke-glob-runner.yml';
const GOLDSET_ENTRY = 'packages/quality/skill-distillation/scripts/goldset-eval.mjs';
// 已审完整 reader AST：包括顶层调用、真实 fs/URL 数据流、测试注册及 spawn 失败传播。
// 只忽略注释/格式；别名、遮蔽、控制流或未调用函数里的同名字符串均不能替代证明。
const AGGREGATE_READER_AST = '0f21916911e40f7c83c0315dd71b833c3f86c6e1d1a2132d22abeb73286f51b6';
function aggregateInputsProven(text, parse) {
  const program = parse(text);
  if (createHash('sha256').update(canonical(program)).digest('hex') !== AGGREGATE_READER_AST) return false;
  const fn = program.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'loadGate');
  const input = fn?.body.body[0]?.declarations?.[0]?.init;
  const url = input?.arguments?.[0], template = url?.arguments?.[0], meta = url?.arguments?.[1];
  if (input?.callee?.name !== 'readFileSync' || input.arguments.length !== 2 || input.arguments[1]?.value !== 'utf8'
    || url?.type !== 'NewExpression' || url.callee?.name !== 'URL' || url.arguments.length !== 2
    || template?.type !== 'TemplateLiteral' || template.expressions.length !== 1 || template.expressions[0]?.name !== 'filename'
    || template.quasis[0]?.value.cooked !== '../../' || template.quasis[1]?.value.cooked !== ''
    || meta?.type !== 'MemberExpression' || meta.computed || meta.object?.type !== 'MetaProperty'
    || meta.object.meta?.name !== 'import' || meta.object.property?.name !== 'meta' || meta.property?.name !== 'url') return false;
  const calls = program.body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations)
    .map(d => d.init).filter(n => n?.type === 'CallExpression' && n.callee?.name === 'loadGate');
  return calls.length === 2 && [['ci.yml', 'ci-passed'], ['ci-smoke-glob-runner.yml', 'smoke-glob-runner-passed']]
    .every(args => calls.some(n => n.arguments.length === 2 && n.arguments.every((a, i) => a.type === 'Literal' && a.value === args[i])));
}
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
const sha256 = text => createHash('sha256').update(text).digest('hex');
// 只固定实际入口之前的已审步骤（含入口），不锁死其它 job 的预算或后续步骤。
const CI_PREFIX = {
  'lint-auto-merge-decision': 'd3b6f0ffc4ba19728ee7bedf1c4e44780ad059e55a55fcc1005cb535ab7e031d',
  'goldset-eval': '1af5458b0a9cb29df7e20b6f1d22c3fac6f432c828888659720bc5b4ef4fcba6',
};
const AGGREGATE_PREFIX_BODIES = [
  ['.github/workflows/scripts/__tests__/should-auto-merge.test.sh', 'bad6be2a6cd7c51e97e97770d20f80de444f227a7466f9d839ebb18e7c5dd9ee'],
  ['.github/workflows/scripts/should-auto-merge.sh', '8c9f84f38c21170b5bb2f01a567c05b989843fbd8e4781fbcf7769d8e008e746'],
];
function ciNodeEntry(doc, jobId, command, condition, expectedEnv) {
  const job = doc?.jobs?.[jobId], steps = job?.steps;
  if (!job || !Array.isArray(steps) || job.if !== condition || job.defaults !== undefined || doc.defaults !== undefined
    || job.env !== undefined || job['continue-on-error'] !== undefined
    || job['runs-on'] !== 'ubuntu-latest' || ['container', 'services', 'strategy', 'uses', 'environment'].some(key => job[key] !== undefined)
    || canonical(doc.env) !== canonical({ CODEX_RELAY_HOME: '/tmp/ci-fake-codex-home' })
    || !Array.isArray(doc.jobs['ci-passed']?.needs) || !doc.jobs['ci-passed'].needs.includes(jobId)) return false;
  const matches = steps.filter(s => s.run === command);
  const step = matches[0], checkout = steps.find(s => s.uses === 'actions/checkout@v4');
  return matches.length === 1 && checkout && checkout.if === undefined && checkout.with === undefined
    && checkout['continue-on-error'] === undefined && steps.indexOf(checkout) < steps.indexOf(step)
    && step.if === undefined && step.shell === undefined && step['working-directory'] === undefined
    && step['continue-on-error'] === undefined && canonical(step.env) === canonical(expectedEnv)
    && sha256(JSON.stringify(sorted(steps.slice(0, steps.indexOf(step) + 1)))) === CI_PREFIX[jobId];
}
/** 仅绑定真实 CI node 入口；条件 job 保留条件语义，不扩展目录或伪造二进制输入摘要。 */
export async function collectCiEntrySources({ aggregate, goldset, parse, read, ci, revision, relations, requireProof }) {
  const doc = yaml.load(ci), relation = (consumer_path, input_path, kind) => relations.push({ consumer_path, input_path, kind, revision });
  if (aggregate) {
    const invoked = ciNodeEntry(doc, 'lint-auto-merge-decision', `node --test ${AGGREGATE_READER}`, undefined, undefined)
      && doc.jobs['lint-auto-merge-decision'].needs === undefined;
    let prefixProven = requireProof(invoked, 'aggregate_reader_ci_unproven');
    if (prefixProven) for (const [path, digest] of AGGREGATE_PREFIX_BODIES) {
      // 前置 shell 及其唯一子脚本已审为只读；仅前缀命令不够，脚本体变动同样关闭证明。
      const body = await read(path);
      if (!requireProof(body && sha256(body) === digest, 'aggregate_prefix_body_unproven')) prefixProven = false;
    }
    if (prefixProven) {
      relation(CI, AGGREGATE_PREFIX_BODIES[0][0], 'required_bash_prefix');
      relation(AGGREGATE_PREFIX_BODIES[0][0], AGGREGATE_PREFIX_BODIES[1][0], 'reviewed_bash_prefix_input');
      const text = await read(AGGREGATE_READER);
      if (requireProof(text && aggregateInputsProven(text, parse), 'aggregate_reader_inputs_unproven')) {
        relation(CI, AGGREGATE_READER, 'required_node_test');
        for (const input of [CI, SMOKE_WORKFLOW]) if (await read(input)) relation(AGGREGATE_READER, input, 'node_test_url_workflow_input');
      }
    }
  }
  if (goldset) {
    const invoked = ciNodeEntry(doc, 'goldset-eval', `node ${GOLDSET_ENTRY}`, "needs.changes.outputs.distill == 'true'", {
      TOAPIS_API_KEY: '${{ secrets.TOAPIS_API_KEY }}', TOAPIS_BASE_URL: '${{ secrets.TOAPIS_BASE_URL }}',
    }) && doc.jobs['goldset-eval'].needs === 'changes'
      && doc.jobs.changes?.outputs?.distill === '${{ steps.detect.outputs.distill }}';
    if (requireProof(invoked, 'goldset_ci_entry_unproven') && await read(GOLDSET_ENTRY))
      relation(CI, GOLDSET_ENTRY, 'conditional_required_node_entry');
  }
}

/** 隔离staging的已审调用边；完整固定来源不符即UNKNOWN，不把来源证明当运行PASS。 */
const stagingHash=text=>createHash('sha256').update(text).digest('hex');
const REVIEWED_FILES={
  ".github/workflows/auto-staging-deploy.yml": "65406abb24f3ef49fcef89b4a6f32163fb6b555fe35254e84ca66b910f7fde67",
  "scripts/staging-deploy.sh": "e8c35ccbe3eb599619c2f94d87d80c309f9694eacdd920ece6afffb3c3484a34",
  "scripts/lib/brain-staging.sh": "57697254e538f75b6a99e276e0b3d95405eb29f95c6a01686f5fd66dd5227089",
  "scripts/staging-verify.sh": "7174239878cb2b159e6cd8cc3ab8cb2af102ef75a7c188e1c6d73fae48932925",
  "scripts/wait-for-staging.sh": "feed4d74afc960f4c6ce73b27c63cf2249aef8cd5b17c9dea10199e3ab1251c0",
  "scripts/brain-deploy.sh": "b75e43593d5d24ddbfeec4a5eb46ba20602259aeb27664268401eb3de6d7a428"
};
const ROUTE_AST_SHA='7190b4987ffa5adbab19d5fcf17d341586db536bba7dfeb97c205aab63c910c4';
export function stagingSelectorVersion(text,parse){
 const declaration=parse(text).body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.type==='VariableDeclaration'&&n.declaration.declarations.some(d=>d.id?.name==='EXISTING_OPS_STAGING_SELECTOR_SCHEMA'))?.declaration;
 if(!declaration)return 0;
 const value=declaration.declarations.find(d=>d.id?.name==='EXISTING_OPS_STAGING_SELECTOR_SCHEMA')?.init;
 if(declaration.kind!=='const'||value?.type!=='Literal'||![0,1,2].includes(value.value))throw Error('staging_selector_schema_unknown');
 return value.value;
}

function routeProven(text,parse){
 const program=parse(text),match=n=>n.type==='CallExpression'&&n.callee?.type==='MemberExpression'&&!n.callee.computed&&n.callee.object?.name==='router'&&n.callee.property?.name==='post'&&n.arguments[0]?.value==='/deploy';
 const entries=program.body.filter(n=>n.type==='ExpressionStatement').map(n=>n.expression).filter(match);
 return entries.length===1&&nodes(program).filter(match).length===1&&stagingHash(JSON.stringify(entries[0],(k,v)=>['start','end','raw'].includes(k)?undefined:v))===ROUTE_AST_SHA;
}
export async function collectIsolatedStagingSources({read,requireProof,relations,revision,route,parse}){
 // 这些完整shell/workflow已通过真实脚本正反例；任何控制流变化均需重新审查，不能按关键词认领。
 for(const[path,digest]of Object.entries(REVIEWED_FILES)){
  const source=await read(path);requireProof(source&&stagingHash(source)===digest,'isolated_staging_source_unproven');
 }
 requireProof(route&&routeProven(route,parse),'isolated_staging_route_unproven');
 for(const path of ['scripts/brain-build.sh','packages/brain/src/db-config.js'])await read(path);
 for(const[consumer_path,input_path,kind]of [
  ['.github/workflows/auto-staging-deploy.yml','packages/brain/src/routes/ops.js','reviewed_staging_deploy_request'],
  ['.github/workflows/auto-staging-deploy.yml','scripts/wait-for-staging.sh','reviewed_staging_receipt_wait'],
  ['packages/brain/src/routes/ops.js','scripts/staging-deploy.sh','reviewed_staging_script_exec'],
  ['scripts/staging-deploy.sh','scripts/lib/brain-staging.sh','bash_source_call'],
  ['scripts/staging-deploy.sh','scripts/brain-build.sh','fixed_sha_build_call'],
  ['scripts/brain-deploy.sh','scripts/lib/brain-staging.sh','bash_source_call'],
  ['scripts/lib/brain-staging.sh','scripts/staging-verify.sh','isolated_candidate_verification'],
  ['scripts/lib/brain-staging.sh','packages/brain/src/migrate.js','isolated_candidate_migration'],
  ['scripts/staging-verify.sh','packages/brain/src/db-config.js','candidate_database_readback'],
 ])relations.push({consumer_path,input_path,kind,revision});
}
