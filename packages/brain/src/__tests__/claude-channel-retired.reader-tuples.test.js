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
 const base=()=>new Map([...new Set([ENVELOPE_FILE,ENVELOPE_CONSUMER,...PROVENANCE_READER_HASHES.keys(),...six,path.join(root,'existing-ops-us-compose-source.js')])].map(f=>[f,readFileSync(f,'utf8')]));
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

// 仅测试守卫：ee25a25a9 已审只读 Acorn/摘要消费完整组合，禁止动态学习候选摘要。
// source.js 是 normalize() 投影的真实调用方，也必须固定；所有原进程检测仍执行。
const HASHES = {
  "existing-ops-source.js": "48a2f74d85054807992323d41f64097d6b88791a66c5ede39aae5584b20ec2f7",
  "existing-ops-build-source.js": ["679289bfaa20b407b9c9d87c6bf9632928247e3bd86e664f3f12393c5a1c8206", "f291969a4ce05b9597018188d71415162584266cb84ad392f1c0846dc7d3ced8"],
  "existing-ops-build-envelopes.js": "9d3165752c1a80a6891f5b1f24d1d8579a94b1d6f37692a8a065202388a7b403",
  "existing-ops-runtime-source.js": "48f919b399f133feadcfb0678ef67c95550d199e3d97fb213ccb9276d93abbf7",
  "existing-ops-stage-source.js": "4efb563d9e3a8c7fa08523c81c730ba1efefa82cbd0de4811c6facb2794bf5ea",
  "existing-ops-stage-envelopes.js": "1fda2fc1f3bf3ef7684930e46ac8dc0364bd1af1f8f27e97c7eb197fe23a6d8f",
  "existing-ops-stage-modes.js": "8266c7b1f74b11a0161684f83e3deb189ee101e2a0b64578cacffaaff1711752",
  "existing-ops-provenance-envelope.js": "ade6df8d35b187ce0495ebd163fa0489379f37114fe2111b4677a4b622933a95",
  "existing-ops-provenance-core-envelope.js": "c3e8769e7f053fc63d52074235b521df5134e65c31d34f151bb6a9400fa4ab93",
  "existing-ops-provenance-entry-envelopes.js": "126a93b9db9856fe06894a394ecb9e0afd099860b9fb54e8927c56c8b96a15bb",
  "existing-ops-provenance-local-envelopes.js": "ef359ef987229815f3d258ff78535fb55dc909bb64eae88d67ce63d0ea55c7f4",
  "existing-ops-native-evidence-source.js": "675be567f871855220a89301f1dbf50dbcc0a900e02c2ed3303ec39d3a647b3c",
  "existing-ops-native-evidence-envelopes.js": "44abae0d93238048356f5573765320b92ad54e481ba78f5925a3c558a8b86013"
};
const US_HASHES = {...HASHES,
 'existing-ops-runtime-source.js':'c6157fb97abf1131f80a8df747a68b0d0c4a86f8cc0c6fb8d112a111991821ba',
 'existing-ops-us-compose-source.js':'d8d3371783b3afbd085bd143e41be91a65d4ed865ff4c1ecb12648f4ae542235',
};
const B_HASHES = {...US_HASHES,
 "existing-ops-build-source.js":"237a57e9cd4d5d2545c0721effd1a3f67358b5dc8d0153ed26ea3ba18719e08c",
 "existing-ops-build-envelopes.js":"6aaea83ad1d73236fc2393a621cc1e059f55a622c29af0d77e7806f571df2c17"
};
const QA_HASHES = {...US_HASHES,
 'existing-ops-runtime-source.js':'21c3009b1b1ae0e2a114ad8d702487f2b7a3dde80ffc24b8a6d42c143b2c6947',
 'existing-ops-native-evidence-source.js':'04632ac4b6c0c25e141938d3ff68a7c3eda079056f6e82a35ebfede5f35050de',
};
const B_QA_HASHES = {...QA_HASHES,
 'existing-ops-build-source.js':B_HASHES['existing-ops-build-source.js'],
 'existing-ops-build-envelopes.js':B_HASHES['existing-ops-build-envelopes.js'],
};
const C_HASHES = {...US_HASHES,...{"existing-ops-build-source.js":"512317755a22aa943c501be12cf72e441254c3e30bfc496645d66913d3e5626f","existing-ops-build-envelopes.js":"64e460f1fc56f0e9422ac73e1082ea40f1b3835aa2bfc3d474ea998623962cc5"}};
const cache=new Map(), referenceCache=new Map();
function hash(text,parse,shape){
 if(!cache.has(text))cache.set(text,createHash('sha256').update(shape(parse(text))).digest('hex'));
 return cache.get(text);
}
export function reviewedADataRanges(src,{file,sources,root,parse,shape,rows,decoded,provenFingerprintReader}){
 const data=['build-envelopes','stage-envelopes','native-evidence-envelopes'].map(n=>path.join(root,`existing-ops-${n}.js`));
 if(!data.includes(file)||src!==sources?.get(file))return null;
 try{
  const runtime=sources.get(path.join(root,'existing-ops-runtime-source.js'));
  if(typeof runtime!=='string')return null;
  const build=sources.get(path.join(root,'existing-ops-build-source.js'));
  const isB=typeof build==='string'&&hash(build,parse,shape)===B_HASHES['existing-ops-build-source.js'];
  const isQa=hash(runtime,parse,shape)===QA_HASHES['existing-ops-runtime-source.js'];
  const isC=typeof build==='string'&&hash(build,parse,shape)===C_HASHES['existing-ops-build-source.js'];
  const selected=isC?C_HASHES:isB?(isQa?B_QA_HASHES:B_HASHES):isQa?QA_HASHES
   :hash(runtime,parse,shape)===US_HASHES['existing-ops-runtime-source.js']?US_HASHES:HASHES;
  const closure=new Set(Object.keys(selected).map(name=>path.join(root,name)));
  for(const [name,digest] of Object.entries(selected)){
   const text=sources.get(path.join(root,name));
   if(typeof text!=='string'||![].concat(digest).includes(hash(text,parse,shape)))return null;
  }
  // 准确固定所有内部消费者；外部不得取得原文或传入 eval 解析器。
  // source.js 仅向注册器返回摘要/关系，允许正常调用；其完整 AST 已在上面绑定。
  const protectedNames=Object.keys(selected).filter(n=>n!=='existing-ops-source.js');
  for(const [consumer,text] of sources){
   if(closure.has(consumer)||provenFingerprintReader(consumer,text))continue;
   if(!referenceCache.has(text))referenceCache.set(text,decoded(text));
   if(referenceCache.get(text).some(value=>protectedNames.some(name=>value.includes(name))))return null;
  }
  return rows(parse(src)).filter(({node})=>node.type==='Literal'&&typeof node.value==='string'
   ||node.type==='TemplateLiteral'&&node.expressions.length===0).map(({node})=>[node.start,node.end]);
 }catch{return null;}
}

export function registerReviewedAGuardTests({ BRAIN_ROOT, findClaudeInvocations }) {
 const root=path.join(BRAIN_ROOT,'src/lib');
 const names=['source','build-source','build-envelopes','runtime-source','us-compose-source','stage-source','stage-envelopes','stage-modes','provenance-envelope','provenance-core-envelope','provenance-entry-envelopes','provenance-local-envelopes','native-evidence-source','native-evidence-envelopes'];
 const files=names.map(n=>path.join(root,`existing-ops-${n}.js`));
 const data=path.join(root,'existing-ops-build-envelopes.js');
 const base=()=>new Map(files.map(f=>[f,readFileSync(f,'utf8')]));
 const legacyBase=()=>new Map(files.map(f=>[f,execFileSync('git',['show','6e9076aab2002e301304256b4936e2790f9de8e7:packages/brain/src/lib/'+path.basename(f)],{cwd:BRAIN_ROOT,encoding:'utf8'})]));
 const scan=(s,f=data)=>findClaudeInvocations(s.get(f),{file:f,sources:s});
 describe('A封套精确只读闭包及执行防复活',()=>{
  it('旧main完整13成员仍可审，新runtime缺新增前置不能借旧闭包',()=>{
   const s=legacyBase(),runtime=path.join(root,'existing-ops-runtime-source.js'),helper=path.join(root,'existing-ops-us-compose-source.js');
   s.set(runtime,execFileSync('git',['show','f4bf6aceb7f28e9d39944bf9bd0fb70a340f3439:packages/brain/src/lib/existing-ops-runtime-source.js'],{encoding:'utf8'}));s.delete(helper);
   expect(scan(s)).toEqual([]);
   s.set(runtime,base().get(runtime));expect(scan(s).some(h=>h.rule==='E1')).toBe(true);
  });
  it('已发布旧collector闭包保留，旧版追加执行仍拒绝',()=>{
   const s=legacyBase(), file=path.join(root,'existing-ops-build-source.js');
   const old=execFileSync('git',['show','65e7ffffe65debcd8e32039da5de50d5c99f00fb:packages/brain/src/lib/existing-ops-build-source.js'],{cwd:BRAIN_ROOT,encoding:'utf8'});
   s.set(file,old);expect(scan(s)).toEqual([]);
   s.set(file,old+'\neval(A_ENVELOPES.reviewed.any);');expect(scan(s).some(h=>h.rule==='E1')).toBe(true);
  });
  it.each(['build-source','build-envelopes'])('B只读闭包禁止A/B混配 %s',name=>{const s=base();s.set(path.join(root,`existing-ops-${name}.js`),execFileSync('git',['show',`5dd82456a80b77dda054f5994d1561e1106317eb:packages/brain/src/lib/existing-ops-${name}.js`],{encoding:'utf8'}));expect(scan(s).some(h=>h.rule==='E1')).toBe(true)});
  it.each(['build','stage','native-evidence'])('%s完整已审组合无误报',name=>{const f=path.join(root,`existing-ops-${name}-envelopes.js`);expect(scan(base(),f)).toEqual([]);});
  it.each(files)('任何闭包成员突变或缺失必须拒绝：%s',f=>{const s=base();s.set(f,s.get(f)+'\nexport const unknownClosure=true;');expect(scan(s).some(h=>h.rule==='E1')).toBe(true);const missing=base();missing.delete(f);expect(findClaudeInvocations(base().get(data),{file:data,sources:missing}).some(h=>h.rule==='E1')).toBe(true);});
  it.each(['eval','raw','spawn','alias','interpolation','escaped','concat','dynamic','caller'])('%s不能继承只读资格',kind=>{
   const s=base(),consumer=path.join(root,'existing-ops-build-source.js'),extra=path.join(root,'third.js');
   if(kind==='eval')s.set(consumer,s.get(consumer)+'\neval(A_ENVELOPES.reviewed.any);');
   if(kind==='raw')s.set(consumer,s.get(consumer)+'\nexport const raw=A_ENVELOPES;');
   if(kind==='spawn'||kind==='alias')s.set(data,s.get(data)+(kind==='spawn'?"\nspawn('claude',['-p']);":"\nimport {spawn as launch} from 'node:child_process';launch('claude',['-p']);"));
   if(kind==='interpolation')s.set(data,s.get(data).replace('spawnParameters: `','spawnParameters: `${launch("claude")}'));
   if(kind==='escaped')s.set(extra,"import {A_ENVELOPES} from './existing-ops-build-\\u0065nvelopes.js';eval(A_ENVELOPES.reviewed.any);");
   if(kind==='concat')s.set(extra,"const m=await import('./existing-ops-build-'+'envelopes.js');eval(m.A_ENVELOPES.reviewed.any);");
   if(kind==='dynamic')s.set(extra,"const m=await import('./existing-ops-build-envelopes.js');eval(m.A_ENVELOPES.reviewed.any);");
   if(kind==='caller'){const f=path.join(root,'existing-ops-source.js');s.set(f,s.get(f)+'\neval(await reviewedAContext(options));');}
   expect(scan(s).some(h=>h.rule==='E1')).toBe(true);
   if(['spawn','alias'].includes(kind))expect(scan(s).some(h=>h.rule==='R1')).toBe(true);
  });
  it('当前文件字节不能借sources旧副本取得资格',()=>{const s=base();expect(findClaudeInvocations(s.get(data)+"\nspawn('claude',['-p']);",{file:data,sources:s}).some(h=>h.rule==='R1')).toBe(true);});
 });
}
