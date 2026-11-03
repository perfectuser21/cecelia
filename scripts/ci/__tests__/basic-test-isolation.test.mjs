import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve('vitest/package.json', {paths:[join(root, 'packages/brain')]})), 'vitest.mjs');
const capture = 'packages/brain/src/routes/__tests__/captures-conversation-source.test.js';
const recovery = 'tests/gp/f1/step1-unblock-expired-selfheal.test.js';

// 私有目录只复制被测模块；所有默认数据库/设备锁入口是拒绝调用的替身。
function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'ci-test-isolation-'));
  const put = (file, text) => {
    mkdirSync(dirname(join(directory, file)), {recursive: true});
    writeFileSync(join(directory, file), text);
  };
  try {
    symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
    put('package.json', '{"type":"module"}');
    for (const file of [capture, recovery, 'packages/brain/src/routes/captures.js',
      'packages/brain/src/recovery-loop.js', 'packages/brain/src/lib/task-type-registry.js']) {
      put(file, readFileSync(join(root, file), 'utf8'));
    }
    const touch = join(directory, 'forbidden-resource');
    const deny = `import {appendFileSync} from 'node:fs';
function deny(){appendFileSync(${JSON.stringify(touch)}, 'called\\n');throw new Error('FORBIDDEN_DEFAULT_RESOURCE');}`;
    put('packages/brain/src/db.js', `${deny}\nexport default {query:deny};`);
    put('packages/brain/src/device-lock-helpers.js', `${deny}\nexport const sweepStaleDeviceLocks=deny;`);
    put('vitest.config.mjs', `export default {resolve:{alias:{vitest:${JSON.stringify(join(dirname(cli), 'dist/index.js'))}}},test:{include:['**/*.test.js'],exclude:['**/node_modules/**'],
maxWorkers:1,minWorkers:1,cache:false}};`);
    function execute(file) {
      const report = join(directory, 'report.json');
      const result = spawnSync(process.execPath, [cli, 'run', file, '--config', join(directory, 'vitest.config.mjs'),
        '--reporter=json', `--outputFile=${report}`], {cwd: directory, encoding:'utf8', timeout:30000});
      assert.ifError(result.error);
      assert.equal(result.signal, null, result.stderr);
      assert.ok(existsSync(report), result.stdout + result.stderr);
      return {...result, report:JSON.parse(readFileSync(report, 'utf8'))};
    }
    run({directory, put, execute, touch});
  } finally { rmSync(directory, {recursive:true, force:true}); }
}

test('captures 正例必须成功；数据库故障不能被 not-400 弱断言放过', () => fixture(({put, execute}) => {
  const healthy = execute(capture);
  assert.equal(healthy.status, 0, healthy.stdout + healthy.stderr + JSON.stringify(healthy.report.testResults));
  assert.equal(healthy.report.numPassedTests, 6);
  const source = readFileSync(join(root, 'packages/brain/src/routes/captures.js'), 'utf8');
  assert.ok(source.includes('pool.query('));
  put('packages/brain/src/routes/captures.js', source.replaceAll('pool.query(',
    "(() => { throw new Error('INJECTED_CAPTURE_DB_FAILURE'); })("));
  const broken = execute(capture);
  assert.notEqual(broken.status, 0, '数据库抛错但 source/nature 成功用例仍全部通过');
  const cases = broken.report.testResults.flatMap(suite => suite.assertionResults);
  const positives = cases.filter(row => /^(source=|nature=)/.test(row.title));
  assert.equal(positives.length, 4, '必须覆盖三个 source 和 session_summary 正例');
  assert.ok(positives.every(row => row.status === 'failed'), JSON.stringify(positives));
  assert.ok(cases.filter(row => /不再被接受|400 拒绝/.test(row.title)).every(row => row.status === 'passed'));
}));

test('TTL 自愈测试正确注入 pool 与设备锁；默认资源一旦调用即拒绝', () => fixture(({put, execute, touch}) => {
  const source = readFileSync(join(root, 'packages/brain/src/recovery-loop.js'), 'utf8');
  const anchor = 'const dbPool = opts.pool || pool;';
  assert.ok(source.includes(anchor));
  put('packages/brain/src/recovery-loop.js', source.replace(anchor,
    `${anchor}\nif (dbPool === pool) throw new Error('DEFAULT_POOL_SELECTED');`));
  const result = execute(recovery);
  assert.equal(result.status, 0, result.stdout + result.stderr + JSON.stringify(result.report.testResults));
  assert.equal(result.report.numPassedTests, 5);
  assert.equal(existsSync(touch), false, '默认 DB 或设备锁 sweep 被调用');
  const originalTest = readFileSync(join(root, recovery), 'utf8');
  for (const [mutation, marker] of [
    [originalTest.replaceAll('pool: { query:', 'dbPool: { query:'), 'DEFAULT_POOL_SELECTED'],
    [originalTest.replaceAll('sweepStaleDeviceLocks: vi.fn().mockResolvedValue(0),', ''), 'not be called at all'],
  ]) {
    assert.notEqual(mutation, originalTest, '反例必须实际改变测试');
    put(recovery, mutation);
    const broken = execute(recovery);
    assert.notEqual(broken.status, 0, '缺少依赖注入却通过');
    assert.equal(broken.report.numFailedTests, 3);
    assert.match(JSON.stringify(broken.report) + broken.stdout + broken.stderr, new RegExp(marker));
    assert.equal(existsSync(touch), false, '反例也不得调用真实资源');
  }
}));
