/** V2 仅接受已审闭包形状；不执行候选模块，不信其声明或文件 hash。 */
import { ENVELOPES } from './existing-ops-build-envelopes.js';
import { REVIEWED as CORE, ISOLATION_REVIEWED as ISOLATION_CORE } from './existing-ops-provenance-core-envelope.js';
import { REVIEWED as LOCAL, ISOLATION_REVIEWED as ISOLATION_LOCAL, MERGE_REVIEWED as MERGE_LOCAL } from './existing-ops-provenance-local-envelopes.js';
import { REVIEWED as ENTRY } from './existing-ops-provenance-entry-envelopes.js';
import { NATIVE_PROVENANCE_PATHS, NATIVE_HISTORY_PATH, nativeEvidenceForwarding, nativeBuildSources, nativeCompatibleCli } from './existing-ops-native-evidence-source.js';

const PREFIX = 'packages/brain/scripts/coding-workflow/lib/';
export const PROVENANCE_SOURCE_PATHS = Object.freeze({
  activityProvenance: PREFIX + 'activity-provenance.mjs',
  recordProvenance: PREFIX + 'record-provenance.mjs',
  recordStore: PREFIX + 'record-provenance-store.mjs',
  recordRecords: PREFIX + 'record-provenance-records.mjs',
  provenancePath: PREFIX + 'provenance-path.mjs',
  qaIsolation: PREFIX + 'qa-isolation.mjs',
  sourceProvenance: 'packages/brain/scripts/coding-workflow/runner/lib/source-provenance.mjs',
  sourceMergeProof: 'packages/brain/scripts/coding-workflow/runner/lib/source-merge-proof.mjs',
  ...NATIVE_PROVENANCE_PATHS,
});
// 旧mandatory集合不变；可选history源码只从实际固定树读取，完整tuple仍独立校验。
export async function readProvenanceSources(paths, readSource, revision) {
  const sources = Object.fromEntries(await Promise.all(Object.entries(PROVENANCE_SOURCE_PATHS)
    .filter(([, path]) => paths.includes(path)).map(async ([key, path]) => [key, await readSource(path, revision)])));
  if (paths.includes(NATIVE_HISTORY_PATH)) sources.recordHistory = await readSource(NATIVE_HISTORY_PATH, revision);
  return sources;
}
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
  const native = nativeEvidenceForwarding(sources, parse);
  let trees = native?.trees, version = native?.version;
  const bundles = { recorded: { ...CORE, ...LOCAL }, isolation: { ...CORE, ...LOCAL, ...ISOLATION_CORE, ...ISOLATION_LOCAL }, source_merge: { ...CORE, ...LOCAL, ...ISOLATION_CORE, ...ISOLATION_LOCAL, ...MERGE_LOCAL } };
  for (const [name, bundle] of native ? [] : Object.entries(bundles)) {
    const candidate = {};
    if (!Object.entries(bundle).every(([key, reviewed]) => {
      if (typeof sources?.[key] !== 'string') return false;
      candidate[key] = parse(sources[key]);
      return same(candidate[key], parse(reviewed));
    })) continue;
    trees = candidate; version = name; break;
  }
  if (!trees) return null;
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
  if (['isolation', 'source_merge', 'native_evidence'].includes(version) && !isolationLinks(trees)) return null;
  if (['source_merge', 'native_evidence'].includes(version) && !mergeReadLinks(trees, parse)) return null;
  return { trees, version };
}

/** 完整已审 AST 之外，明确锚定实际导入/调用；静态依赖不冒称本次执行了隐藏。 */
function isolationLinks(trees) {
  const core = trees.recordProvenance, helper = trees.qaIsolation, activity = trees.activityProvenance;
  for (const name of ['startQaIsolation', 'verifyQaIsolation', 'isolationProjection']) {
    if (!namedImport(core, './qa-isolation.mjs', name) || !exported(helper, name)) return false;
  }
  if (calls(fn(core, 'beginEvaluateIsolation'), 'startQaIsolation').length !== 1
    || !namedImport(helper, './record-provenance-store.mjs', 'writeEvent')
    || calls(fn(helper, 'startQaIsolation'), 'writeEvent').length !== 2
    || calls(fn(core, 'verifyQaRound'), 'verifyQaIsolation').length !== 1) return false;
  const recorded = fn(activity, 'runRecordedActivity');
  const sealed = nodes(recorded).find(n => n.type === 'VariableDeclarator' && n.id.name === 'sealed');
  return namedImport(activity, './record-provenance.mjs', 'sealStageEvidence')
    && sealed?.init?.type === 'CallExpression' && sealed.init.callee.name === 'sealStageEvidence'
    && nodes(recorded).some(n => n.type === 'Property' && n.key.name === 'source_stage_event_id' && member(n.value, 'sealed', 'id'));
}


/** 完整 AST 固定前置条件；另外证明返回事实来自真实 reader，而非候选自述。 */
function mergeReadLinks(trees, parse) {
  const reader = trees.sourceProvenance, proof = trees.sourceMergeProof, core = trees.recordProvenance;
  const facts = fn(reader, 'sourceFacts'), verified = fn(reader, 'verifiedSource'), chain = fn(proof, 'verifySourceChain');
  if (!exported(reader, 'sourceFacts') || !exported(proof, 'verifySourceChain')
    || !namedImport(reader, './source-merge-proof.mjs', 'verifySourceChain')
    || !namedImport(reader, '../../lib/record-provenance.mjs', 'provenanceProjection')
    || !namedImport(proof, '../../lib/record-provenance.mjs', 'verifyRecordProvenance')
    || !namedImport(proof, '../../lib/record-provenance.mjs', 'controllerIdentity')
    || !exported(core, 'verifyRecordProvenance') || !exported(core, 'controllerIdentity')) return false;
  const expression = text => parse(text).body[0].expression;
  if (!same(calls(facts, 'verifiedSource'), [expression("verifiedSource({ repoSlug: 'perfectuser21/cecelia' }, worktree, intent, head)")])
    || !same(calls(verified, 'verifySourceChain'), [expression('verifySourceChain(worktree, intent, head, requiredQaRound)')])
    || !same(facts.body.body.at(-1), parse('function f(){ return { ...provenanceProjection(proof), sync }; }').body[0].body.body[0])
    || !same(calls(chain, 'verifyRecordProvenance'), [expression('verifyRecordProvenance(options)')])
    || !same(calls(chain, 'walkSourceMerges'), [expression('walkSourceMerges(c, head, requiredQaRound, all, verify)')])
    || calls(chain, 'events').length !== 2
    || !same(chain.body.body.at(-1), parse('function f(){ return { proof, sync }; }').body[0].body.body[0])) return false;
  // URL 数组真正传给原 core：那里逐文件 noLinks/stat/readFileSync/hash；不是 writer 执行边。
  const identity = calls(proof, 'controllerIdentity');
  const expected = expression("controllerIdentity(import.meta.url, ['./source-merge.mjs', './source-provenance.mjs', './cifix.mjs', './pr-branch.mjs', './proc.mjs', './qa-gate.mjs', './repos.mjs'].map(p => new URL(p, import.meta.url)))");
  const identityFn = fn(core, 'controllerIdentity');
  return identity.length === 1 && same(identity[0], expected)
    && calls(identityFn, 'noLinks').length === 1
    && nodes(identityFn).some(n => n.type === 'CallExpression' && member(n.callee, 'fs', 'readFileSync'));
}

/** 版本来自完整源码组合；不读取候选提供的版本或状态声明。 */
export function provenanceSourceVersion(sources, parse) {
  try { return forwardingSources(sources, parse)?.version ?? null; } catch { return null; }
}

/** 先证明新增闭包，再把已证明等价的插桩边投影给原封套；其余旧检查完全保留。 */
export function normalizeProvenanceBuild(sources, parse) {
  try {
    const forwarded = forwardingSources(sources, parse);
    if (!forwarded) return null;
    if (forwarded.version === 'native_evidence' && !nativeBuildSources(sources, parse)) return null;
    // 新CLI的完整AST及实际capture/stdin链先被证明，才可投影旧消费者等价封套。
    const cliText = forwarded.version === 'native_evidence' ? nativeCompatibleCli() : sources.cli;
    const activity = parse(sources.activity), protocol = parse(sources.protocol), cli = parse(cliText);
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
      cli: edit(cliText, [{ node: captureImports[0], replacement: '' }, { node: runClaude, replacement: ENVELOPES.runClaude }]),
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
