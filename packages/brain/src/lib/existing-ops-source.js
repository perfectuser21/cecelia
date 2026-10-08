/** 已有工厂活动的只读消费者证据；不执行源码，也不声明完整流程可运行。 */
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { parse } from 'acorn';

export const EXISTING_OPS_REPO = 'perfectuser21/cecelia';
export const EXISTING_OPS_SCOPE = 'cecelia';
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
  return nodes(exclude.arguments[0]).some(n => call(n, 'POSTGRES_INTEGRATION_TESTS', 'includes'));
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
/** readSource及paths必须由调用方同一个固定Git tree给出；中央写入另须main/CAS。 */
export async function buildExistingOpsSources({ scope, repo, revision, paths, readSource }) {
  if (scope !== EXISTING_OPS_SCOPE || repo !== EXISTING_OPS_REPO || !/^[a-f0-9]{40}$/.test(revision || '') || !Array.isArray(paths)
    || paths.some(path => !sourcePath(path)) || new Set(paths).size !== paths.length || typeof readSource !== 'function') throw Error('OPS_SOURCE_INPUT_INVALID');
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
    requireProof(deployment && workflowRuns(deployment).some(r => shellLines(r.run).some(line => /^HTTP_CODE=\$\(bash scripts\/ci\/gate3-trigger-deploy\.sh "\$\{BRAIN_URL\}"\)$/.test(line))), 'deployment_entry_unproven');
    requireProof(trigger && shellLines(trigger).some(line => /-X POST "\$\{BRAIN_URL\}\/api\/brain\/deploy"/.test(line)), 'deploy_request_unproven');
    requireProof(route && deployRouteProven(route), 'deploy_route_unproven');
    requireProof(local && shellLines(local).includes('bash "$MAIN_SCRIPTS/brain-deploy.sh"'), 'deployment_script_unproven');
    requireProof(deploy && shellLines(deploy).some(line => /\bnode src\/migrate\.js(?:\)|\s|$)/.test(line) && !line.startsWith('echo ')), 'migration_execution_unproven');
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
    requireProof(nightlyRuns.some(r => shellLines(r.run).some(line => /^cd packages\/brain && npx vitest run src\/__tests__\/integration\//.test(line))), 'nightly_integration_unproven');
    requireProof(ci && workflowRuns(ci).some(r => shellLines(r.run.replace(/\\\r?\n/g, ' ')).some(line => /^npx vitest run\s+--config vitest\.integration\.config\.js\b/.test(line))), 'ci_integration_unproven');
    requireProof(config && nativeTestSelectorProven(config), 'native_test_selector_unproven');
    requireProof(integrationConfig && nativeIntegrationConfigProven(integrationConfig), 'native_integration_config_unproven');
    // 先只证明夜间明确指定的集成目录；unit动态exclude尚无静态证明，不宽认领全部测试。
    for (const path of paths.filter(path => /^packages\/brain\/src\/__tests__\/integration\/[^\n]+\.(?:test|spec)\.(?:[cm]?js)$/.test(path))) {
      const test = await read(path);
      if (!test) continue;
      relations.push({ consumer_path: '.github/workflows/nightly-regression.yml', input_path: path, kind: 'explicit_vitest_directory', revision });
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
