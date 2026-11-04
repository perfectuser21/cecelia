import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';

// 官方包的发布ESM含JSON裸import，Node22不能直接加载；只做CJS打包，不改schema/引擎。
const directory = mkdtempSync(join(tmpdir(), 'ci-official-concurrency-'));
after(() => rmSync(directory, {recursive: true, force: true}));
const bundle = buildSync({stdin: {
  contents: "export {parseWorkflow, NoOperationTraceWriter} from '@actions/workflow-parser'; export {Parser, Lexer, Evaluator, data} from '@actions/expressions';",
  resolveDir: fileURLToPath(new URL('../../../', import.meta.url)),
}, bundle: true, platform: 'node', format: 'cjs', write: false});
const entry = join(directory, 'official.cjs');
writeFileSync(entry, bundle.outputFiles[0].contents);
const {parseWorkflow, NoOperationTraceWriter, Parser, Lexer, Evaluator, data} = createRequire(import.meta.url)(entry);
const source = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const parsed = parseWorkflow({name: 'ci.yml', content: source}, new NoOperationTraceWriter());
const concurrency = parsed.value.find('concurrency');

function context(value) {
  if (value === null || value === undefined) return new data.Null();
  if (typeof value === 'string') return new data.StringData(value);
  if (typeof value === 'boolean') return new data.BooleanData(value);
  return new data.Dictionary(...Object.entries(value).map(([key, value]) => ({key, value: context(value)})));
}
function evaluate(token, github) {
  if (!token.isExpression) return token.value;
  // 官方workflow parser已将字符串插值编译为format表达式，完整交官方引擎执行。
  const ast = new Parser(new Lexer(token.expression).lex().tokens, ['github'], []).parse();
  const result = new Evaluator(ast, context({github})).evaluate();
  return typeof result.value === 'boolean' ? result.value : result.coerceString();
}
function policy(github) {
  return Object.fromEntries(['group', 'queue', 'cancel-in-progress'].map(key => {
    const token = concurrency.find(key);
    return [key, token ? evaluate(token, github) : (key === 'queue' ? 'single' : false)];
  }));
}
const pr = (login, ref, actor = login) => ({event_name: 'pull_request', ref, actor,
  event: {pull_request: {user: {login}}}});

test('官方workflow schema接受实际CI以及条件queue，只允许已知上下文', () => {
  const parsed = parseWorkflow({name: 'ci.yml', content: source}, new NoOperationTraceWriter());
  assert.deepEqual(parsed.context.errors.getErrors(), []);
  const invalid = source.replace(/queue:.*\n/, 'queue: ${{ secrets.PRIVATE }}\n');
  assert.notEqual(invalid, source, '必须测试实际queue字段，不能漏写后误绿');
  const rejected = parseWorkflow({name: 'bad.yml', content: invalid}, new NoOperationTraceWriter());
  assert.ok(rejected.context.errors.getErrors().length > 0, '官方schema必须拒绝queue非法context');
});

test('Dependabot不同PR共享同一组，保max队列且不取消运行；人工rerun也按PR作者识别', () => {
  const one = policy(pr('dependabot[bot]', 'refs/pull/1/merge'));
  const two = policy(pr('dependabot[bot]', 'refs/pull/2/merge', 'human-rerunner'));
  assert.deepEqual(one, {group: 'ci-dependabot', queue: 'max', 'cancel-in-progress': false});
  assert.deepEqual(two, one);
});

test('人类PR按ref分组，single且取消同PR旧提交，不被actor误判bot', () => {
  const one = policy(pr('human', 'refs/pull/3/merge', 'dependabot[bot]'));
  const two = policy(pr('human', 'refs/pull/4/merge'));
  assert.deepEqual(one, {group: 'ci-refs/pull/3/merge', queue: 'single', 'cancel-in-progress': true});
  assert.equal(two.group, 'ci-refs/pull/4/merge');
  assert.notEqual(one.group, two.group);
});

for (const event of ['push', 'workflow_dispatch']) test(event + '保持main分组、single和不取消，不因缺PR payload误判', () => {
  assert.deepEqual(policy({event_name: event, ref: 'refs/heads/main', actor: 'dependabot[bot]', event: {}}),
    {group: 'ci-refs/heads/main', queue: 'single', 'cancel-in-progress': false});
});

test('所有真实事件分支都不生成max+canceltrue非法组合', () => {
  for (const github of [pr('dependabot[bot]', 'refs/pull/1/merge'), pr('human', 'refs/pull/2/merge'),
    {event_name: 'push', ref: 'refs/heads/main', event: {}}, {event_name: 'workflow_dispatch', ref: 'refs/heads/main', event: {}}]) {
    const current = policy(github);
    assert.ok(!(current.queue === 'max' && current['cancel-in-progress'] === true));
  }
});
