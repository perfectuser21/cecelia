// 只解析完整已审源码；静态依赖与选中evaluate的可达调用分别登记。
import { NATIVE_EVIDENCE_ENVELOPES as REVIEWED } from './existing-ops-native-evidence-envelopes.js';

const P = 'packages/brain/scripts/coding-workflow/';
export const NATIVE_PROVENANCE_PATHS = Object.freeze(Object.fromEntries(Object.entries({
  recordInputs: 'record-provenance-inputs', recordQa: 'record-provenance-qa', nativeEvidence: 'native-evidence',
  qaReport: 'qa-report', evidence: 'evidence', transcript: 'transcript',
}).map(([key, name]) => [key, `${P}lib/${name}.mjs`])));
const canonical = value => JSON.stringify(value, (key, item) => ['start', 'end', 'raw'].includes(key) ? undefined : item);
const same = (a, b) => canonical(a) === canonical(b);
const nodes = value => !value || typeof value !== 'object' ? [] : [
  ...(value.type ? [value] : []), ...Object.values(value).flatMap(x => Array.isArray(x) ? x.flatMap(nodes) : nodes(x)),
];
const declaration = n => n?.type === 'ExportNamedDeclaration' ? n.declaration : n;
const fn = (tree, name) => tree.body.map(declaration).find(n => n?.type === 'FunctionDeclaration' && n.id.name === name);
const exported = (tree, name) => tree.body.some(n => n.type === 'ExportNamedDeclaration' && n.declaration === fn(tree, name));
const calls = (tree, name) => nodes(tree).filter(n => n.type === 'CallExpression' && n.callee?.name === name);
const named = (tree, source, name) => tree.body.some(n => n.type === 'ImportDeclaration' && n.source.value === source
  && n.specifiers.some(s => s.type === 'ImportSpecifier' && s.local.name === name && s.imported.name === name));
const expression = (text, parse) => parse(text).body[0].expression;
const oneCall = (tree, text, name, parse) => same(calls(tree, name), [expression(text, parse)]);

function nativeLinks(trees, parse) {
  const { recordProvenance: core, recordQa: qa, recordInputs: inputs, nativeEvidence: native } = trees;
  if (!named(core, './record-provenance-inputs.mjs', 'writeJudgeInput')
    || !named(core, './record-provenance-inputs.mjs', 'validateJudgeStageInput')
    || !named(core, './record-provenance-qa.mjs', 'assembleCurrentQa')
    || !named(core, './record-provenance-qa.mjs', 'validateQaAssembly')
    || !named(qa, './native-evidence.mjs', 'strictNativeExecutions')
    || !named(qa, './native-evidence.mjs', 'compileQaReport')) return false;
  if (!['assembleCurrentQa', 'validateQaAssembly'].every(n => exported(qa, n))
    || !['writeJudgeInput', 'validateJudgeStageInput'].every(n => exported(inputs, n))
    || !['strictNativeExecutions', 'compileQaReport'].every(n => exported(native, n))) return false;
  if (!oneCall(fn(core, 'compileCurrentQaEvidence'), 'assembleCurrentQa(c, reportRel)', 'assembleCurrentQa', parse)
    || !oneCall(fn(core, 'sealJudgeInput'), 'writeJudgeInput(c, materials)', 'writeJudgeInput', parse)
    || !oneCall(fn(core, 'validateStage'), 'validateQaAssembly(c, stage, all)', 'validateQaAssembly', parse)
    || !oneCall(fn(core, 'validateStage'), 'validateJudgeStageInput(c, stage, all)', 'validateJudgeStageInput', parse)
    || !oneCall(fn(qa, 'assembleCurrentQa'), 'strictNativeExecutions(native.stdout)', 'strictNativeExecutions', parse)
    || !oneCall(fn(qa, 'assembleCurrentQa'), "parseQaReport(draftBytes.toString('utf8'), { executions: commands, draft: true })", 'parseQaReport', parse)
    || !oneCall(fn(qa, 'assembleCurrentQa'), "compileQaReport(draftBytes.toString('utf8'), parsed, commands, ledgerIdentity(c, native, c.startedHead))", 'compileQaReport', parse)
    || !oneCall(fn(qa, 'validateQaAssembly'), "compileQaReport(bytes.toString('utf8'), parsed, commands, ledgerIdentity(c, native, stage.head_before))", 'compileQaReport', parse)) return false;
  // 真实stdin值由spawn计算；capture检查实际字段，不能以计划receipt hash替代。
  const capture = fn(core, 'captureNativeExecution');
  if (!nodes(capture).some(n => same(n, expression('run.stdin_sha256 === c.judgeInput.stdin_sha256', parse)))
    || !nodes(capture).some(n => same(n, expression('run.stdin_bytes === c.judgeInput.stdin_bytes', parse)))
    || !nodes(capture).some(n => same(n, expression('run.stdin_expected === true', parse)))
    || !nodes(capture).some(n => same(n, expression('run.stdin_finished === true', parse)))) return false;
  return true;
}

/** 全体模块必须是同一已审组合，不能各自命中不同历史版本。 */
export function nativeEvidenceForwarding(sources, parse) {
  try {
    const trees = {};
    for (const [key, text] of Object.entries(REVIEWED.support)) {
      // build/CLI只在实际消费者证明时读取；publish不能借此声称执行CLI。
      if (['test', 'helper', 'activity', 'cli', 'protocol'].includes(key)) continue;
      if (typeof sources[key] !== 'string') return null;
      trees[key] = parse(sources[key]);
      if (!same(trees[key], parse(text))) return null;
    }
    return nativeLinks(trees, parse) ? { trees, version: 'native_evidence' } : null;
  } catch { return null; }
}
export function nativeBuildSources(sources, parse) {
  try {
    for (const key of ['test', 'helper', 'activity', 'cli', 'protocol']) {
      if (typeof sources[key] !== 'string' || !same(parse(sources[key]), parse(REVIEWED.support[key]))) return false;
    }
    const cli = parse(sources.cli), spawn = fn(cli, 'spawnClaude');
    return named(cli, './record-provenance.mjs', 'captureNativeExecution')
      && named(cli, 'node:crypto', 'createHash') && calls(spawn, 'spawn').length === 1
      && oneCall(fn(cli, 'runClaude'), 'captureNativeExecution({ ...result, tag })', 'captureNativeExecution', parse)
      && nodes(spawn).some(n => same(n, expression("createHash('sha256').update(stdin).digest('hex')", parse)));
  } catch { return false; }
}
export function nativeEvidenceStages(entries, parse) {
  try {
    if (!Object.entries(REVIEWED.entries).every(([name, text]) => typeof entries[name] === 'string'
      && same(parse(entries[name]), parse(text)))) return false;
    const evaluate = parse(entries.evaluate);
    return named(evaluate, '../lib/record-provenance.mjs', 'compileCurrentQaEvidence')
      && oneCall(fn(evaluate, 'judge'), 'compileCurrentQaEvidence(rel)', 'compileCurrentQaEvidence', parse);
  } catch { return false; }
}
export const nativeStageTest = name => REVIEWED.tests[name];
// 仅由已完成完整AST+真实调用证明的normalizer使用，不改变未识别代码。
export const nativeCompatibleCli = () => REVIEWED.legacyCli;

export const nativeStaticEdges = () => [
  ['record-provenance', 'record-provenance-inputs'], ['record-provenance', 'record-provenance-qa'],
  ['record-provenance', 'native-evidence'], ['record-provenance-qa', 'record-provenance-inputs'],
  ['record-provenance-qa', 'native-evidence'], ['record-provenance-qa', 'qa-report'],
  ['qa-report', 'evidence'], ['qa-report', 'native-evidence'], ['transcript', 'native-evidence'],
  ['native-evidence', 'evidence'],
].map(([consumer, input]) => [P + `lib/${consumer}.mjs`, P + `lib/${input}.mjs`, 'provenance_static_import_dependency']);

/** 仅选中evaluate测试且完整entry证明后，登记可达编译链；不声明模型/产品PASS。 */
export function nativeEvaluateEdges(entry) {
  return [
    [entry, P + 'lib/record-provenance.mjs', 'stage_evaluate_native_compilation'],
    [P + 'lib/record-provenance.mjs', P + 'lib/record-provenance-qa.mjs', 'stage_evaluate_native_compilation'],
    [P + 'lib/record-provenance-qa.mjs', P + 'lib/native-evidence.mjs', 'stage_evaluate_native_compilation'],
  ];
}
