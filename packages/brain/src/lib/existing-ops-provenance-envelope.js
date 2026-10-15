/** V2 仅接受已审闭包形状；不执行候选模块，不信其声明或文件 hash。 */
import { ENVELOPES } from './existing-ops-build-envelopes.js';
import { REVIEWED as CORE } from './existing-ops-provenance-core-envelope.js';
import { REVIEWED as LOCAL } from './existing-ops-provenance-local-envelopes.js';
import { REVIEWED as ENTRY } from './existing-ops-provenance-entry-envelopes.js';

const PREFIX = 'packages/brain/scripts/coding-workflow/lib/';
export const PROVENANCE_SOURCE_PATHS = Object.freeze({
  activityProvenance: PREFIX + 'activity-provenance.mjs',
  recordProvenance: PREFIX + 'record-provenance.mjs',
  recordStore: PREFIX + 'record-provenance-store.mjs',
  recordRecords: PREFIX + 'record-provenance-records.mjs',
  provenancePath: PREFIX + 'provenance-path.mjs',
});
const canonical = value => JSON.stringify(value, (key, item) => ['start', 'end', 'raw'].includes(key) ? undefined : item);
const same = (a, b) => canonical(a) === canonical(b);
const declaration = node => node?.type === 'ExportNamedDeclaration' ? node.declaration : node;
const fn = (tree, name) => tree.body.map(declaration).find(n => n?.type === 'FunctionDeclaration' && n.id.name === name);
const exported = (tree, name) => tree.body.some(n => n.type === 'ExportNamedDeclaration' && n.declaration === fn(tree, name));
const nodes = node => !node || typeof node !== 'object' ? [] : [...(node.type ? [node] : []), ...Object.values(node).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const calls = (node, name) => nodes(node).filter(n => n.type === 'CallExpression' && n.callee.name === name);
const member = (node, object, property) => node?.type === 'MemberExpression' && !node.computed && node.object.name === object && node.property.name === property;
const namedImport = (tree, source, name) => tree.body.some(n => n.type === 'ImportDeclaration' && n.source.value === source
  && n.specifiers.some(s => s.type === 'ImportSpecifier' && s.imported.name === name && s.local.name === name));
const edit = (text, changes) => changes.sort((a, b) => b.node.start - a.node.start).reduce((value, { node, replacement }) => value.slice(0, node.start) + replacement + value.slice(node.end), text);

/** 完整本地新增模块限制前置校验、导入初始化、存储绑定；旧 Node/库边界保持原合同。 */
function forwardingSources(sources, parse) {
  const trees = {};
  for (const [key, reviewed] of Object.entries({ ...CORE, ...LOCAL })) {
    if (typeof sources?.[key] !== 'string') return null;
    trees[key] = parse(sources[key]);
    if (!same(trees[key], parse(reviewed))) return null;
  }
  const activity = trees.activityProvenance, core = trees.recordProvenance;
  const recorded = fn(activity, 'runRecordedActivity'), context = fn(core, 'withRecordProvenance');
  if (!exported(activity, 'runRecordedActivity') || !exported(core, 'withRecordProvenance')
    || !namedImport(activity, './record-provenance.mjs', 'withRecordProvenance')
    || !namedImport(core, 'node:async_hooks', 'AsyncLocalStorage')) return null;
  // 非 self 直接转发；self 由同一 input/handler 闭包转发，不把完成声明当执行。
  const handlers = calls(recorded, 'handler'), scopes = calls(recorded, 'withRecordProvenance');
  if (handlers.length !== 2 || handlers.some(n => n.arguments.length !== 1 || n.arguments[0].name !== 'input')
    || scopes.length !== 1 || scopes[0].arguments[1]?.type !== 'ArrowFunctionExpression'
    || !scopes[0].arguments[1].async || calls(scopes[0].arguments[1], 'handler').length !== 1) return null;
  const storage = nodes(core).filter(n => n.type === 'VariableDeclarator' && n.id.name === 'storage');
  const result = context?.body.body.at(-1);
  if (storage.length !== 1 || storage[0].init?.type !== 'NewExpression' || storage[0].init.callee.name !== 'AsyncLocalStorage'
    || storage[0].init.arguments.length || context.params[1]?.name !== 'fn' || result?.type !== 'ReturnStatement'
    || result.argument?.type !== 'CallExpression' || !member(result.argument.callee, 'storage', 'run')
    || result.argument.arguments.length !== 2 || result.argument.arguments[0].name !== 'c' || result.argument.arguments[1].name !== 'fn') return null;
  return trees;
}

/** 先证明新增闭包，再把已证明等价的插桩边投影给原封套；其余旧检查完全保留。 */
export function normalizeProvenanceBuild(sources, parse) {
  try {
    if (!forwardingSources(sources, parse)) return null;
    const activity = parse(sources.activity), protocol = parse(sources.protocol), cli = parse(sources.cli);
    const entry = activity.body.at(-1), runActivity = fn(protocol, 'runActivity'), runClaude = fn(cli, 'runClaude');
    const captureImports = cli.body.filter(n => n.type === 'ImportDeclaration' && n.source.value === './record-provenance.mjs');
    if (!same(entry, parse(ENTRY.entry).body[0]) || !same(runActivity, parse(ENTRY.runActivity).body[0])
      || !same(runClaude, parse(ENTRY.runClaude).body[0]) || captureImports.length !== 1
      || !same(captureImports[0], parse("import { captureNativeExecution } from './record-provenance.mjs';").body[0])) return null;
    const imports = nodes(runActivity).filter(n => n.type === 'ImportExpression');
    const recorded = calls(runActivity, 'runRecordedActivity');
    if (imports.length !== 1 || imports[0].source.value !== './activity-provenance.mjs' || recorded.length !== 1
      || recorded[0].arguments[2]?.type !== 'ArrowFunctionExpression' || calls(recorded[0].arguments[2], 'handler').length !== 1) return null;
    if (!exported(protocol, 'runActivity') || !exported(cli, 'runClaude')) return null;
    return { ...sources,
      activity: edit(sources.activity, [{ node: entry, replacement: ENVELOPES.entry }]),
      protocol: edit(sources.protocol, [{ node: runActivity, replacement: ENVELOPES.runActivity }]),
      cli: edit(sources.cli, [{ node: captureImports[0], replacement: '' }, { node: runClaude, replacement: ENVELOPES.runClaude }]),
    };
  } catch { return null; }
}

/** 只接受完整已审测试；正常 witness 的 beforeEach 必须把临时入口恢复为真实 ENTRY。 */
export function normalizeProvenancePublish(test, parse, sources) {
  try {
    if (!forwardingSources(sources, parse)) return null;
    const tree = parse(test);
    if (!same(tree, parse(ENTRY.publishTest))) return null;
    const group = tree.body.find(n => n.type === 'ExpressionStatement')?.expression;
    const body = group?.arguments[1]?.body.body;
    if (!body) return null;
    const setup = body.find(n => n.expression?.callee?.name === 'beforeEach')?.expression.arguments[0];
    const reset = setup?.body.body.find(n => n.type === 'ExpressionStatement' && n.expression.type === 'AssignmentExpression'
      && n.expression.left.name === 'activityEntry' && n.expression.right.name === 'ENTRY');
    const run = nodes(tree).find(n => n.type === 'VariableDeclarator' && n.id.name === 'run');
    if (!reset || run?.init?.body?.callee?.name !== 'runActivityProcess' || run.init.body.arguments[0]?.name !== 'activityEntry') return null;
    const changes = [{ node: reset, replacement: '' }, { node: run.init.body.arguments[0], replacement: 'ENTRY' }];
    const entryVariable = body.find(n => n.type === 'VariableDeclaration' && n.declarations.length === 1 && n.declarations[0].id.name === 'activityEntry');
    if (!entryVariable) return null;
    changes.push({ node: entryVariable, replacement: '' });
    for (const item of tree.body.filter(n => n.type === 'ImportDeclaration')) {
      if (item.source.value === '../lib/record-provenance.mjs') changes.push({ node: item, replacement: '' });
      if (item.source.value === 'node:url') changes.push({ node: item, replacement: "import { fileURLToPath } from 'node:url';" });
    }
    return edit(test, changes);
  } catch { return null; }
}
