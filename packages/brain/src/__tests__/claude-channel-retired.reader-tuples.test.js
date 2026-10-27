// 固定已审九成员必须整组命中；仅供防复活守卫取得只读数据资格，不执行封套源码。
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { describe, it, expect } from 'vitest';

const OLD_READER_HASHES = [
  [
    "existing-ops-stage-source.js",
    "549aae515174fc9963ed48220abb10886c76b364e2066969e4e66d1f79bbb745"
  ],
  [
    "existing-ops-stage-modes.js",
    "8266c7b1f74b11a0161684f83e3deb189ee101e2a0b64578cacffaaff1711752"
  ],
  [
    "existing-ops-stage-envelopes.js",
    "1fda2fc1f3bf3ef7684930e46ac8dc0364bd1af1f8f27e97c7eb197fe23a6d8f"
  ],
  [
    "existing-ops-provenance-envelope.js",
    "27c87c40b07ef90e87d642042afbdeb6a770a71ec74582da312599ec6fae5d5e"
  ],
  [
    "existing-ops-provenance-core-envelope.js",
    "c3e8769e7f053fc63d52074235b521df5134e65c31d34f151bb6a9400fa4ab93"
  ],
  [
    "existing-ops-provenance-entry-envelopes.js",
    "126a93b9db9856fe06894a394ecb9e0afd099860b9fb54e8927c56c8b96a15bb"
  ],
  [
    "existing-ops-provenance-local-envelopes.js",
    "ef359ef987229815f3d258ff78535fb55dc909bb64eae88d67ce63d0ea55c7f4"
  ],
  [
    "existing-ops-native-evidence-source.js",
    "db5308fd90094044e2e4942dc704c90a41e6a225fd5bf04d0f5b876959175eb0"
  ],
  [
    "existing-ops-native-evidence-envelopes.js",
    "ed0b4b01fb98b9ee5c852736286ae22ad7ce28252936840df257666778949c57"
  ]
];
export const PROVENANCE_CALLER_SHA256 = 'ac312d50ee66676fc27d1574d126cdf86f36e25d01facad5ecd2d0f3b77a7bb0';
export function provenanceReaderTuples(root) {
  const old = new Map(OLD_READER_HASHES.map(([name, hash]) => [path.join(root, name), hash]));
  const next = new Map(old);
  next.set(path.join(root, 'existing-ops-native-evidence-source.js'), 'ccb6cc8fbe31d00212d1f564053902a2000461d408b65131cfbe6e44195f5662');
  next.set(path.join(root, 'existing-ops-native-evidence-envelopes.js'), '0eb9a1ed9e0dc12ad04f4e2fd50c5253cd75e53386237847c85c0d436ba03e19');
  // 新consumer仅在当前已审九成员与完整runtime同时命中时取得资格。
  const doc = new Map(next);
  doc.set(path.join(root, 'existing-ops-runtime-source.js'), '116a965527c5aa69b174746299eabceee7fc398e1a49bce55cd6e06bd2625832');
  const rootNpm = new Map(doc);
  rootNpm.set(path.join(root, 'existing-ops-runtime-source.js'), 'cfa08d753497e7bdcde34bfe9dcba4a44a32392b03fc8abdf746d0c4449fe6ab');
  // 已审SOURCEPREP必须连同实际build caller与runtime整组匹配；旧四组不变。
  const history = new Map(rootNpm);
  for (const [name, hash] of [
    ['build-source', '0ab51a41fd56b8bbb8be840b3caf8f8bd025dceeefdd6cd24e039f3ead903435'],
    ['stage-source', '4efb563d9e3a8c7fa08523c81c730ba1efefa82cbd0de4811c6facb2794bf5ea'],
    ['provenance-envelope', 'ade6df8d35b187ce0495ebd163fa0489379f37114fe2111b4677a4b622933a95'],
    ['native-evidence-source', '675be567f871855220a89301f1dbf50dbcc0a900e02c2ed3303ec39d3a647b3c'],
    ['native-evidence-envelopes', '44abae0d93238048356f5573765320b92ad54e481ba78f5925a3c558a8b86013'],
    ['runtime-source', '48f919b399f133feadcfb0678ef67c95550d199e3d97fb213ccb9276d93abbf7'],
  ]) history.set(path.join(root, 'existing-ops-' + name + '.js'), hash);
  return [old, next, doc, rootNpm, history];
}
export function matchesProvenanceReaderTuple(sources, tuples, hashSource) {
  try {
    return tuples.some(tuple => [...tuple].every(([file, hash]) =>
      typeof sources.get(file) === 'string' && hashSource(sources.get(file)) === hash));
  } catch { return false; }
}
// 旧helper逐字来自23cb825c；旧data是当前模块已保留的固定88688字节前缀，免复制大压缩原文。
const OLD_NATIVE_HELPER = "// 只解析完整已审源码；静态依赖与选中evaluate的可达调用分别登记。\nimport { NATIVE_EVIDENCE_ENVELOPES as REVIEWED } from './existing-ops-native-evidence-envelopes.js';\n\nconst P = 'packages/brain/scripts/coding-workflow/';\nexport const NATIVE_PROVENANCE_PATHS = Object.freeze(Object.fromEntries(Object.entries({\n  recordInputs: 'record-provenance-inputs', recordQa: 'record-provenance-qa', nativeEvidence: 'native-evidence',\n  qaReport: 'qa-report', evidence: 'evidence', transcript: 'transcript',\n}).map(([key, name]) => [key, `${P}lib/${name}.mjs`])));\nconst canonical = value => JSON.stringify(value, (key, item) => ['start', 'end', 'raw'].includes(key) ? undefined : item);\nconst same = (a, b) => canonical(a) === canonical(b);\nconst nodes = value => !value || typeof value !== 'object' ? [] : [\n  ...(value.type ? [value] : []), ...Object.values(value).flatMap(x => Array.isArray(x) ? x.flatMap(nodes) : nodes(x)),\n];\nconst declaration = n => n?.type === 'ExportNamedDeclaration' ? n.declaration : n;\nconst fn = (tree, name) => tree.body.map(declaration).find(n => n?.type === 'FunctionDeclaration' && n.id.name === name);\nconst exported = (tree, name) => tree.body.some(n => n.type === 'ExportNamedDeclaration' && n.declaration === fn(tree, name));\nconst calls = (tree, name) => nodes(tree).filter(n => n.type === 'CallExpression' && n.callee?.name === name);\nconst named = (tree, source, name) => tree.body.some(n => n.type === 'ImportDeclaration' && n.source.value === source\n  && n.specifiers.some(s => s.type === 'ImportSpecifier' && s.local.name === name && s.imported.name === name));\nconst expression = (text, parse) => parse(text).body[0].expression;\nconst oneCall = (tree, text, name, parse) => same(calls(tree, name), [expression(text, parse)]);\n\nfunction nativeLinks(trees, parse) {\n  const { recordProvenance: core, recordQa: qa, recordInputs: inputs, nativeEvidence: native } = trees;\n  if (!named(core, './record-provenance-inputs.mjs', 'writeJudgeInput')\n    || !named(core, './record-provenance-inputs.mjs', 'validateJudgeStageInput')\n    || !named(core, './record-provenance-qa.mjs', 'assembleCurrentQa')\n    || !named(core, './record-provenance-qa.mjs', 'validateQaAssembly')\n    || !named(qa, './native-evidence.mjs', 'strictNativeExecutions')\n    || !named(qa, './native-evidence.mjs', 'compileQaReport')) return false;\n  if (!['assembleCurrentQa', 'validateQaAssembly'].every(n => exported(qa, n))\n    || !['writeJudgeInput', 'validateJudgeStageInput'].every(n => exported(inputs, n))\n    || !['strictNativeExecutions', 'compileQaReport'].every(n => exported(native, n))) return false;\n  if (!oneCall(fn(core, 'compileCurrentQaEvidence'), 'assembleCurrentQa(c, reportRel)', 'assembleCurrentQa', parse)\n    || !oneCall(fn(core, 'sealJudgeInput'), 'writeJudgeInput(c, materials)', 'writeJudgeInput', parse)\n    || !oneCall(fn(core, 'validateStage'), 'validateQaAssembly(c, stage, all)', 'validateQaAssembly', parse)\n    || !oneCall(fn(core, 'validateStage'), 'validateJudgeStageInput(c, stage, all)', 'validateJudgeStageInput', parse)\n    || !oneCall(fn(qa, 'assembleCurrentQa'), 'strictNativeExecutions(native.stdout)', 'strictNativeExecutions', parse)\n    || !oneCall(fn(qa, 'assembleCurrentQa'), \"parseQaReport(draftBytes.toString('utf8'), { executions: commands, draft: true })\", 'parseQaReport', parse)\n    || !oneCall(fn(qa, 'assembleCurrentQa'), \"compileQaReport(draftBytes.toString('utf8'), parsed, commands, ledgerIdentity(c, native, c.startedHead))\", 'compileQaReport', parse)\n    || !oneCall(fn(qa, 'validateQaAssembly'), \"compileQaReport(bytes.toString('utf8'), parsed, commands, ledgerIdentity(c, native, stage.head_before))\", 'compileQaReport', parse)) return false;\n  // 真实stdin值由spawn计算；capture检查实际字段，不能以计划receipt hash替代。\n  const capture = fn(core, 'captureNativeExecution');\n  if (!nodes(capture).some(n => same(n, expression('run.stdin_sha256 === c.judgeInput.stdin_sha256', parse)))\n    || !nodes(capture).some(n => same(n, expression('run.stdin_bytes === c.judgeInput.stdin_bytes', parse)))\n    || !nodes(capture).some(n => same(n, expression('run.stdin_expected === true', parse)))\n    || !nodes(capture).some(n => same(n, expression('run.stdin_finished === true', parse)))) return false;\n  return true;\n}\n\n/** 全体模块必须是同一已审组合，不能各自命中不同历史版本。 */\nexport function nativeEvidenceForwarding(sources, parse) {\n  try {\n    const trees = {};\n    for (const [key, text] of Object.entries(REVIEWED.support)) {\n      // build/CLI只在实际消费者证明时读取；publish不能借此声称执行CLI。\n      if (['test', 'helper', 'activity', 'cli', 'protocol'].includes(key)) continue;\n      if (typeof sources[key] !== 'string') return null;\n      trees[key] = parse(sources[key]);\n      if (!same(trees[key], parse(text))) return null;\n    }\n    return nativeLinks(trees, parse) ? { trees, version: 'native_evidence' } : null;\n  } catch { return null; }\n}\nexport function nativeBuildSources(sources, parse) {\n  try {\n    for (const key of ['test', 'helper', 'activity', 'cli', 'protocol']) {\n      if (typeof sources[key] !== 'string' || !same(parse(sources[key]), parse(REVIEWED.support[key]))) return false;\n    }\n    const cli = parse(sources.cli), spawn = fn(cli, 'spawnClaude');\n    return named(cli, './record-provenance.mjs', 'captureNativeExecution')\n      && named(cli, 'node:crypto', 'createHash') && calls(spawn, 'spawn').length === 1\n      && oneCall(fn(cli, 'runClaude'), 'captureNativeExecution({ ...result, tag })', 'captureNativeExecution', parse)\n      && nodes(spawn).some(n => same(n, expression(\"createHash('sha256').update(stdin).digest('hex')\", parse)));\n  } catch { return false; }\n}\nexport function nativeEvidenceStages(entries, parse) {\n  try {\n    if (!Object.entries(REVIEWED.entries).every(([name, text]) => typeof entries[name] === 'string'\n      && same(parse(entries[name]), parse(text)))) return false;\n    const evaluate = parse(entries.evaluate);\n    return named(evaluate, '../lib/record-provenance.mjs', 'compileCurrentQaEvidence')\n      && oneCall(fn(evaluate, 'judge'), 'compileCurrentQaEvidence(rel)', 'compileCurrentQaEvidence', parse);\n  } catch { return false; }\n}\nexport const nativeStageTest = name => REVIEWED.tests[name];\n// 仅由已完成完整AST+真实调用证明的normalizer使用，不改变未识别代码。\nexport const nativeCompatibleCli = () => REVIEWED.legacyCli;\n\nexport const nativeStaticEdges = () => [\n  ['record-provenance', 'record-provenance-inputs'], ['record-provenance', 'record-provenance-qa'],\n  ['record-provenance', 'native-evidence'], ['record-provenance-qa', 'record-provenance-inputs'],\n  ['record-provenance-qa', 'native-evidence'], ['record-provenance-qa', 'qa-report'],\n  ['qa-report', 'evidence'], ['qa-report', 'native-evidence'], ['transcript', 'native-evidence'],\n  ['native-evidence', 'evidence'],\n].map(([consumer, input]) => [P + `lib/${consumer}.mjs`, P + `lib/${input}.mjs`, 'provenance_static_import_dependency']);\n\n/** 仅选中evaluate测试且完整entry证明后，登记可达编译链；不声明模型/产品PASS。 */\nexport function nativeEvaluateEdges(entry) {\n  return [\n    [entry, P + 'lib/record-provenance.mjs', 'stage_evaluate_native_compilation'],\n    [P + 'lib/record-provenance.mjs', P + 'lib/record-provenance-qa.mjs', 'stage_evaluate_native_compilation'],\n    [P + 'lib/record-provenance-qa.mjs', P + 'lib/native-evidence.mjs', 'stage_evaluate_native_compilation'],\n  ];\n}\n";
export function restoreOldNativeReader(sources, file) {
  const value = path.basename(file) === 'existing-ops-native-evidence-source.js'
    ? OLD_NATIVE_HELPER : Buffer.from(sources.get(file)).subarray(0, 88688).toString('utf8');
  sources.set(file, value);
}
// Main ancestor fixture: original tests keep exercising their original whole combinations.
export function readHistoricalReader(file) {
  if (path.basename(file).startsWith('existing-ops-') && path.extname(file) === '.js') {
    return execFileSync('git', ['show', '0bbee7b45e4ce79ed2752785fbdb0fd805357879:packages/brain/src/lib/' + path.basename(file)], { cwd: path.dirname(file), encoding: 'utf8', maxBuffer: 1024 * 1024 });
  }
  return readFileSync(file, 'utf8');
}
const sha = value => createHash('sha256').update(value).digest('hex');
const hashSource = text => sha(JSON.stringify(parse(text, { ecmaVersion: 'latest', sourceType: 'module' }),
  (key, value) => ['start', 'end', 'raw'].includes(key) ? undefined : value));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib');
const tuples = provenanceReaderTuples(root);
const base = () => new Map([...tuples[0].keys()].map(file => [file, readHistoricalReader(file)]));
const helper = path.join(root, 'existing-ops-native-evidence-source.js');
const data = path.join(root, 'existing-ops-native-evidence-envelopes.js');
describe('claude-channel-retired.reader-tuples 防复活守卫完整九reader组合', () => {
  it.each(['old', 'new'])('%s完整组合取得资格，且旧原件逐字保全', version => {
    const sources = base();
    if (version === 'old') {
      for (const file of [helper, data]) restoreOldNativeReader(sources, file);
      expect(sha(sources.get(helper))).toBe('254f2f360ca306a618fb550b3ff9f5e78f5a62b5d41fbe1bc489ca29eed27d22');
      expect(sha(sources.get(data))).toBe('e83467bd21287620eb7a3a97728da99f58dcdd4d7dfeed1a90e1797806bb7587');
    }
    expect(matchesProvenanceReaderTuple(sources, tuples, hashSource)).toBe(true);
  });
  it.each([helper, data])('旧%s和另一新成员混搭不能取得资格', file => {
    const sources = base(); restoreOldNativeReader(sources, file);
    expect(matchesProvenanceReaderTuple(sources, tuples, hashSource)).toBe(false);
  });
  it.each([...tuples[0].keys()])('未知%s不能取得完整组合资格', file => {
    const sources = base(); sources.set(file, sources.get(file) + '\nexport const unreviewedReader = true;');
    expect(matchesProvenanceReaderTuple(sources, tuples, hashSource)).toBe(false);
  });
});

export function registerReaderTupleGuardTests({ BRAIN_ROOT, ENVELOPE_FILE, ENVELOPE_CONSUMER, NATIVE_HELPER, NATIVE_DATA, PROVENANCE_READER_HASHES, findClaudeInvocations }) {
describe('sourceprep history reader完整新组合',()=>{
 const root=path.join(BRAIN_ROOT,'src/lib');
 const six=['source','build-source','stage-source','provenance-envelope','native-evidence-source','native-evidence-envelopes','runtime-source'].map(n=>path.join(root,'existing-ops-'+n+'.js'));
 const base=()=>new Map([...new Set([ENVELOPE_FILE,ENVELOPE_CONSUMER,...PROVENANCE_READER_HASHES.keys(),...six])].map(f=>[f,readFileSync(f,'utf8')]));
 const scan=(s,f=NATIVE_DATA)=>findClaudeInvocations(s.get(f),{file:f,sources:s});
 it.each([ENVELOPE_FILE,NATIVE_DATA,path.join(root,'existing-ops-stage-envelopes.js')])('新完整caller/runtime/reader使%s取得资格',f=>expect(scan(base(),f)).toEqual([]));
 it.each(six)('新组合混入旧%s拒绝',f=>{
  const s=base();s.set(f,readHistoricalReader(f));expect(scan(s).some(h=>h.rule==='E1')).toBe(true);
 });
 it.each(six)('新组合未知%s拒绝',f=>{
  const s=base();s.set(f,s.get(f)+'\nexport const unknownHistoryReader=true;');expect(scan(s).some(h=>h.rule==='E1')).toBe(true);
 });
 it('仅新caller配完整旧reader拒绝',()=>{
  const s=base();for(const f of [...PROVENANCE_READER_HASHES.keys(),six.at(-1)])s.set(f,readHistoricalReader(f));
  expect(scan(s).some(h=>h.rule==='E1')).toBe(true);
 });
 it.each(['noop','eval','raw export','claude'])('新runtime %s不能继承资格',kind=>{
  const s=base(),f=six.at(-1),old=s.get(f);
  if(kind==='noop')s.set(f,old.replace('const support = await readProvenanceSources(paths, readSource, revision);','const support = {};'));
  if(kind==='eval')s.set(f,old+'\neval(candidate);');
  if(kind==='raw export')s.set(f,old+"\nimport { ENVELOPES } from './existing-ops-build-envelopes.js';export const raw=ENVELOPES;");
  if(kind==='claude')s.set(f,old+"\nimport { spawn } from 'node:child_process';spawn('claude',['-p','probe']);");
  expect(s.get(f)).not.toBe(old);expect(scan(s).some(h=>h.rule==='E1')).toBe(true);
  if(kind==='claude')expect(scan(s,f).some(h=>h.rule==='R1')).toBe(true);
 });
 it('新增第三消费者仍拒绝',()=>{
  const s=base();s.set(path.join(root,'unknown-history-reader.js'),"import { nativeEvidenceForwarding } from './existing-ops-native-evidence-source.js';nativeEvidenceForwarding(candidate,eval);");
  expect(scan(s).some(h=>h.rule==='E1')).toBe(true);
 });
});
describe('doc reader完整组合资格',()=>{
 const runtime=path.join(BRAIN_ROOT,'src/lib/existing-ops-runtime-source.js');
 const stage=path.join(BRAIN_ROOT,'src/lib/existing-ops-stage-envelopes.js');
 const base=()=>new Map([ENVELOPE_FILE,ENVELOPE_CONSUMER,...PROVENANCE_READER_HASHES.keys(),runtime].map(file=>[file,readHistoricalReader(file)]));
 const scan=(sources,file=NATIVE_DATA)=>findClaudeInvocations(sources.get(file),{file,sources});
 it.each([ENVELOPE_FILE,NATIVE_DATA,stage])('完整十成员使%s取得只读资格',file=>{
  expect(scan(base(),file)).toEqual([]);
 });
 it('root npm新十成员整组取得资格且旧doc十成员仍可重放',()=>{
  expect(scan(base())).toEqual([]);
  const old=base();old.set(runtime,execFileSync('git',['show','88be2549bed2a8d8a3b5a6324bf5ea6267dda0da:packages/brain/src/lib/existing-ops-runtime-source.js'],{cwd:BRAIN_ROOT,encoding:'utf8',maxBuffer:1024*1024}));
  expect(scan(old)).toEqual([]);
 });
 it('旧九成员加新runtime是未经审查的混搭',()=>{
  const sources=base();for(const file of [NATIVE_HELPER,NATIVE_DATA])restoreOldNativeReader(sources,file);
  expect(scan(sources).some(hit=>hit.rule==='E1')).toBe(true);
 });
 it.each([
  ['unknown',s=>s+'\nexport const unreviewedReader = true;'],
  ['eval callback',s=>s.replace('provenanceSourceVersion(support, parse)','provenanceSourceVersion(support, eval)')],
  ['raw export',s=>s+"\nimport { ENVELOPES } from './existing-ops-build-envelopes.js';export const raw = ENVELOPES;"],
  ['template execution',s=>s+"\nimport { ENVELOPES } from './existing-ops-build-envelopes.js';eval(ENVELOPES.spawnParameters);"],
 ])('runtime %s不继承资格',(_name,edit)=>{
  const sources=base();sources.set(runtime,edit(sources.get(runtime)));
  expect(scan(sources).some(hit=>hit.rule==='E1')).toBe(true);
 });
 it('第三消费者不继承资格',()=>{
  const sources=base();sources.set(path.join(BRAIN_ROOT,'src/lib/unknown-doc-reader.js'),"import { provenanceSourceVersion } from './existing-ops-provenance-envelope.js';provenanceSourceVersion(candidate,eval);");
  expect(scan(sources).some(hit=>hit.rule==='E1')).toBe(true);
 });
 it('runtime进程调用仍同时触发E1和R1',()=>{
  const sources=base();sources.set(runtime,sources.get(runtime)+"\nimport { spawn } from 'node:child_process';spawn('claude',['-p','probe']);");
  expect(scan(sources).some(hit=>hit.rule==='E1')).toBe(true);
  expect(scan(sources,runtime).some(hit=>hit.rule==='R1')).toBe(true);
 });
});
describe('完整九模块来源reader组合不能按成员混搭',()=>{
 const root=path.join(BRAIN_ROOT,'src/lib'), names=[...PROVENANCE_READER_HASHES.keys()];
 const base=()=>new Map([ENVELOPE_FILE,ENVELOPE_CONSUMER,...names].map(file=>[file,readHistoricalReader(file)]));
 const old=restoreOldNativeReader;
 const scan=sources=>findClaudeInvocations(sources.get(NATIVE_DATA),{file:NATIVE_DATA,sources});
 it.each(['old','new'])('%s完整固定组合取得只读资格',version=>{
  const sources=base();if(version==='old')for(const file of [NATIVE_HELPER,NATIVE_DATA])old(sources,file);
  expect(scan(sources)).toEqual([]);
 });
 it.each([NATIVE_HELPER,NATIVE_DATA])('只恢复旧%s形成混搭必须拒绝',file=>{
  const sources=base();old(sources,file);expect(scan(sources).some(hit=>hit.rule==='E1')).toBe(true);
 });
 it.each([NATIVE_HELPER,NATIVE_DATA])('未知%s即使其余成员正确也拒绝',file=>{
  const sources=base();sources.set(file,sources.get(file)+'\nexport const unreviewedReader = true;');expect(scan(sources).some(hit=>hit.rule==='E1')).toBe(true);
 });
});
}
