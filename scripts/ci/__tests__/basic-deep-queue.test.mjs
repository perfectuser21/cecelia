import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';

// 官方发布ESM含裸JSON import，按仓内既有适配只打包，不修改schema/引擎。
const directory = mkdtempSync(join(tmpdir(), 'deep-official-queue-'));
after(() => rmSync(directory, {recursive: true, force: true}));
const bundle = buildSync({stdin: {
  contents: "export {parseWorkflow, NoOperationTraceWriter} from '@actions/workflow-parser';",
  resolveDir: fileURLToPath(new URL('../../../', import.meta.url)),
}, bundle: true, platform: 'node', format: 'cjs', write: false});
const entry = join(directory, 'official.cjs');
writeFileSync(entry, bundle.outputFiles[0].contents);
const {parseWorkflow, NoOperationTraceWriter} = createRequire(import.meta.url)(entry);
const source = readFileSync(new URL('../../../.github/workflows/nightly-regression.yml', import.meta.url), 'utf8');
const parse = content => parseWorkflow({name: 'nightly-regression.yml', content}, new NoOperationTraceWriter());

function policy(content) {
  const parsed = parse(content);
  assert.deepEqual(parsed.context.errors.getErrors(), [], '实际完整workflow必须通过官方schema');
  const concurrency = parsed.value.find('concurrency');
  assert.ok(concurrency, '不能移除全局串行锁');
  const result = {};
  for (const key of ['group', 'queue', 'cancel-in-progress']) {
    const token = concurrency.find(key);
    assert.ok(token, `必须显式声明${key}`);
    assert.equal(token.isExpression, false, `${key}不得按ref/事件变化`);
    result[key] = token.value;
  }
  return result;
}

test('实际Deep完整workflow由官方schema接受', () => {
  assert.deepEqual(parse(source).context.errors.getErrors(), []);
});

test('所有ref仍共享原deep-regression串行锁，仅将pending容量改为官方max', () => {
  assert.deepEqual(policy(source), {group: 'deep-regression', queue: 'max', 'cancel-in-progress': false});
});

test('省略queue、改回single、按ref分组或取消running均不满足本合同', () => {
  for (const changed of [source.replace(/^  queue: max\n/m, ''),
    source.replace(/^  queue: max$/m, '  queue: single'),
    source.replace(/^  group: deep-regression$/m, '  group: deep-${{ github.ref }}'),
    source.replace(/^  cancel-in-progress: false$/m, '  cancel-in-progress: true')]) {
    assert.notEqual(changed, source, '必须变异真实字段，不得未命中仍绿');
    assert.throws(() => assert.deepEqual(policy(changed), {group: 'deep-regression', queue: 'max', 'cancel-in-progress': false}));
  }
});

test('官方schema拒绝queue的未知私密上下文', () => {
  const changed = source.replace(/^  queue: max$/m, '  queue: ${{ secrets.PRIVATE }}');
  assert.notEqual(changed, source);
  assert.ok(parse(changed).context.errors.getErrors().length > 0);
});

// 这里只核配置合同；GitHub服务端的100 pending/单running语义来自官方文档。
// https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
// 不能用本地自造scheduler证明真实GitHub已经保住队列。
