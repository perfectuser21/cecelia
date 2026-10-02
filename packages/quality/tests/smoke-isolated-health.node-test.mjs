import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { resolve } from 'node:path';
import { isIsolatedRuntime } from '../../brain/src/runtime-safety.js';
import { root, fixture } from './fixtures/smoke-production-guard-fixture.mjs';

// Run the real health handler; inject only DB/probe I/O so no server automation starts.
async function actualHealth(env) {
  const source = await readFile(resolve(root, 'packages/brain/src/routes/goals.js'), 'utf8');
  const start = source.indexOf("router.get('/health',");
  assert.ok(start >= 0);
  let handler, body;
  vm.runInNewContext(source.slice(start, source.indexOf('\n/**', start)), {
    router: { get: (_, fn) => { handler = fn; } },
    isIsolatedRuntime: () => isIsolatedRuntime(env),
    pool: { query: async sql => ({ rows: [sql.includes('harness_initiative')
      ? { cnt: 0 } : { passed: 0, failed: 0, last_run_at: null }] }) },
    getTickStatus: async () => ({ loop_running: true, enabled: true }),
    getAllCBStates: () => ({}),
    dockerRuntimeProbe: async () => ({ enabled: false, status: 'disabled' }),
    checkXianBridgeHealth: async () => 'disabled',
    describeFleetTransportReadiness: () => ({ enabled: false, status: 'disabled' }),
    process: { env, uptime: () => 1 }, pkg: { version: 'fixture' },
  });
  const res = { json: value => { body = JSON.parse(JSON.stringify(value)); }, status: () => res };
  await handler({}, res);
  return body;
}

for (const NODE_ENV of ['test', 'development']) {
  test(`real ${NODE_ENV} passive health permits explicitly authorized fixture writes`, async () => {
    const health = await actualHealth({ NODE_ENV });
    assert.deepEqual(health.runtime, { isolated: true, background_automation: false });
    assert.equal(health.local_execution.role, 'disabled');
    assert.equal(health.local_execution.reason, 'runtime_isolated');
    await fixture(async ({ requests, smoke }) => {
      await smoke('notion-mapping-r4', { SMOKE_ALLOW_WRITE: '1' });
      assert.ok(requests.some(req => req.method === 'POST'), 'real passive test health blocked authorized fixture');
    }, { health });
  });
}
test('real production scheduler health still refuses writes behind matching test fixture identity', async () => {
  const health = await actualHealth({ NODE_ENV: 'production', CECELIA_LOCAL_EXECUTION_ENABLED: 'false' });
  assert.equal(health.local_execution.role, 'scheduler_only');
  await fixture(async ({ requests, smoke }) => {
    await smoke('notion-mapping-r4', { SMOKE_ALLOW_WRITE: '1' });
    assert.deepEqual(requests, [{ method: 'GET', url: '/api/brain/health' }]);
  }, { health });
});
for (const [name, mutate] of [
  ['isolation absent', h => { delete h.runtime.isolated; }],
  ['isolation false', h => { h.runtime.isolated = false; }],
  ['automation absent', h => { delete h.runtime.background_automation; }],
  ['automation active', h => { h.runtime.background_automation = true; }],
  ['execution absent', h => { delete h.local_execution.enabled; }],
  ['execution active', h => { h.local_execution.enabled = true; }],
  ['reason absent', h => { delete h.local_execution.reason; }],
  ['reason unknown', h => { h.local_execution.reason = 'unknown'; }],
  ['role absent', h => { delete h.local_execution.role; }],
  ['unknown role', h => { h.local_execution.role = 'unknown'; }],
]) {
  test(`passive health fails closed when ${name}`, async () => {
    const health = await actualHealth({ NODE_ENV: 'test' }); mutate(health);
    await fixture(async ({ requests, smoke }) => {
      await smoke('notion-mapping-r4', { SMOKE_ALLOW_WRITE: '1' });
      assert.deepEqual(requests, [{ method: 'GET', url: '/api/brain/health' }]);
    }, { health });
  });
}
test('real passive test health does not bypass default authorization', async () => {
  await fixture(async ({ requests, smoke, dockerCalls }) => {
    await smoke('notion-mapping-r4');
    assert.deepEqual(requests, []); assert.deepEqual(await dockerCalls(), []);
  }, { health: await actualHealth({ NODE_ENV: 'test' }) });
});
for (const [name, mutate] of [
  ['production DB', info => { info.Config.Env[1] = 'DB_NAME=cecelia'; }],
  ['production container', info => { info.Config.Env[0] = 'NODE_ENV=production'; }],
]) {
  test(`real passive health cannot bypass ${name} identity`, async () => {
    await fixture(async ({ requests, smoke, info }) => {
      mutate(info); await smoke('notion-mapping-r4', { SMOKE_ALLOW_WRITE: '1' }, info);
      assert.deepEqual(requests, []);
    }, { health: await actualHealth({ NODE_ENV: 'test' }) });
  });
}

for (const [name, overrides] of [
  ['default authorization', {}],
  ['URI query override', { SMOKE_ALLOW_WRITE: '1', DATABASE_URL: 'postgresql://localhost/cecelia_test?dbname=cecelia' }],
  ['remote same-named DB', { SMOKE_ALLOW_WRITE: '1', DATABASE_URL: 'postgresql://remote/cecelia_test' }],
  ['unlisted suffix-matching DB', { SMOKE_ALLOW_WRITE: '1', DATABASE_URL: 'postgresql://localhost/customer_test' }],
]) {
  test(`DDL smoke refuses ${name} before psql`, async () => {
    await fixture(async ({ smoke, psqlCalls, requests }) => {
      await smoke('alertness-schema', overrides);
      assert.deepEqual(await psqlCalls(), [], 'unverified DDL reached psql');
      assert.deepEqual(requests, []);
    });
  });
}
test('DDL smoke retains its transaction and uses the checked connection after explicit authorization', async () => {
  await fixture(async ({ smoke, psqlCalls, requests }) => {
    const result = await smoke('alertness-schema', { SMOKE_ALLOW_WRITE: '1' });
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(requests, [{ method: 'GET', url: '/api/brain/health' }]);
    const calls = await psqlCalls(); assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '-X');
    assert.equal(calls[0][1], 'postgresql://cecelia@localhost:5432/cecelia_test');
    const source = await readFile(resolve(root, 'packages/brain/scripts/smoke/alertness-schema-smoke.sh'), 'utf8');
    assert.match(source, /BEGIN;/); assert.match(source, /ROLLBACK;/);
    assert.match(source, /重复迁移丢失已有数据/);
  }, { health: await actualHealth({ NODE_ENV: 'test' }) });
});
