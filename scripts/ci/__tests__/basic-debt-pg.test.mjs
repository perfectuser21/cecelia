import test from 'node:test';
import assert from 'node:assert/strict';
import { privatePgConfig, verifyPrivatePg, assertOwnedDatabase, assertVitestReport, dropOwnedScratch, restoreDump } from '../private-pg-contract.mjs';
import { checked, cleanProcessEnv } from '../private-pg-backend.mjs';
import deep from '../deep-integration.config.mjs';
import privatePg from '../debt-pg.config.mjs';
import { createRequire } from 'node:module';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const glob = createRequire(import.meta.url)('fast-glob');

const owner = 'ci-debt-0123456789abcdef';
const env = { DB_HOST: '127.0.0.1', DB_PORT: '6543', DB_NAME: 'cecelia_scratch', DB_USER: 'ci', DB_PASSWORD: 'fixture', CECELIA_PRIVATE_PG_OWNER: owner };
test('显式私有PG配置保留密码、不读取默认服务，URL覆盖参数全部拒绝', () => {
  assert.equal(privatePgConfig(env).password, 'fixture');
  for (const query of ['host=outside.invalid', 'port=5432', 'options=-c%20search_path%3Dpublic', 'sslmode=disable']) {
    assert.throws(() => privatePgConfig({ ...env, TEST_DATABASE_URL: `postgresql://ci:fixture@127.0.0.1:6543/cecelia_scratch?${query}` }), /query/i);
  }
  for (const patch of [{ DB_PORT: '5432' }, { DB_HOST: 'outside.invalid' }, { DB_NAME: 'cecelia' }, { CECELIA_PRIVATE_PG_OWNER: '' }]) assert.throws(() => privatePgConfig({ ...env, ...patch }));
  assert.throws(() => privatePgConfig({ ...env, DATABASE_URL: 'postgresql://ci:fixture@127.0.0.1:6544/cecelia_scratch' }), /conflict/i);
});
test('身份与归属均实读，错误实例或非owner不能获得清理资格', async () => {
  const identity = { db: 'cecelia_scratch', host: '127.0.0.1', port: 6543, owner };
  await verifyPrivatePg({ query: async () => ({ rows: [identity] }) }, env);
  for (const field of ['db', 'host', 'port', 'owner']) {
    await assert.rejects(verifyPrivatePg({ query: async () => ({ rows: [{ ...identity, [field]: 'wrong' }] }) }, env));
  }
  assertOwnedDatabase(identity, privatePgConfig(env), owner);
  assert.throws(() => assertOwnedDatabase({ ...identity, owner: 'another-run' }, privatePgConfig(env), owner), /owner/i);
});
test('真实Vitest收据必须全部执行，失败、空集合、skip与todo均不能计绿', () => {
  const pass = { success: true, numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, testResults: [{ assertionResults: [{ status: 'passed' }, { status: 'passed' }] }] };
  assertVitestReport(pass);
  for (const patch of [{ success: false }, { numTotalTests: 0 }, { numFailedTests: 1 }, { numPendingTests: 1 }, { numTodoTests: 1 }, { testResults: [] }]) assert.throws(() => assertVitestReport({ ...pass, ...patch }));
});
test('非owner禁止DROP；恢复失败必须原样失败而非进入测试', async () => {
  let dropped = false;
  const admin = { query: async () => { dropped = true; } };
  await assert.rejects(dropOwnedScratch(admin, async () => { throw Error('owner mismatch'); }, () => {}), /owner/);
  assert.equal(dropped, false);
  await assert.rejects(dropOwnedScratch(admin, async () => {}, () => { throw Error('container owner mismatch'); }), /owner/);
  assert.equal(dropped, false);
  assert.throws(() => restoreDump(() => {}, Buffer.alloc(0)), /empty/);
  assert.throws(() => restoreDump(() => checked(process.execPath, ['-e', 'process.exit(19)']), Buffer.from('fixture SQL')), /19/);
});
test('子进程环境只含运行所需白名单，不继承模型、通知或数据库URL', () => {
  const env = cleanProcessEnv('/tmp/owned-fixture', '/usr/bin:/bin');
  assert.equal(env.HOME, '/tmp/owned-fixture/home');
  assert.equal(env.PATH, '/usr/bin:/bin');
  assert.deepEqual(Object.keys(env).sort(), ['GIT_CONFIG_GLOBAL','GIT_CONFIG_NOSYSTEM','GIT_TERMINAL_PROMPT','HOME','LANG','LC_ALL','PATH','TEMP','TMP','TMPDIR','TZ'].sort());
});
test('私有PG自动集合非空，正常Deep不得重复执行私有连接文件', () => {
  const collect = config => glob.sync(config.test.include, { cwd: resolve(root, 'packages/brain'), absolute: true, ignore: config.test.exclude }).map(p => relative(root, p));
  const selected = collect(privatePg), ordinary = collect(deep);
  assert.ok(selected.length >= 35);
  assert.ok(selected.includes('packages/brain/src/__tests__/integration/learning-current-contract.pg.integration.test.js'));
  assert.deepEqual(selected.filter(p => ordinary.includes(p)), []);
});
