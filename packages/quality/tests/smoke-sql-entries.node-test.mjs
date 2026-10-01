import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fixture, root, clientCommands } from './fixtures/smoke-production-guard-fixture.mjs';

const entries = JSON.parse(await readFile(resolve(root, 'packages/quality/smoke-sql-targets.json'), 'utf8'));
const safe = 'postgresql://localhost:5432/cecelia_test';
const unsafe = 'postgresql://localhost:5432/cecelia';
for (const [name, classification] of Object.entries(entries)) {
  if (classification.kind !== 'readonly') continue;
  test(`${name}: readonly classification cannot execute curl or psql startup configuration`, async () => {
    const source = await readFile(resolve(root, 'packages/brain/scripts/smoke', name), 'utf8');
    const commands = clientCommands(source);
    assert.equal(/\bpsql[ \t]+(?!-X(?:[ \t]|$))/.test(commands), false, 'readonly SQL can execute psqlrc writes');
    assert.equal(/\bcurl[ \t]+(?!-q(?:[ \t]|$))/.test(commands), false, 'readonly HTTP can execute curlrc overrides');
  });
}
function connectionEnv(connection, database) {
  return { DATABASE_URL: connection, BRAIN_DB_URL: connection, DB_URL: connection, DB: connection,
    SCRIPT_SMOKE_DB_URL: connection, GOV_GUARD_SMOKE_DB_URL: connection, TASK_RUN_SMOKE_DB_URL: connection,
    CONTAINER_DATABASE_URL: connection, DB_NAME: database, DB_HOST: 'localhost', DB_PORT: '5432',
    PGDATABASE: database, PGHOST: 'localhost', PGPORT: '5432', GUARD_EXECUTION_BOUNDARY: '1' };
}
// DEBUG boundary stops every script at its first non-guard external operation.
// It exercises the real Bash control flow without executing business Node, SQL, or credential fallback.
for (const [name, classification] of Object.entries(entries)) {
  if (classification.kind !== 'write') continue;
  test(`${name}: default authorization refuses before any external operation`, async () => {
    await fixture(async ({ smoke, reachedBoundary, psqlCalls, dockerCalls, requests }) => {
      await smoke(name, connectionEnv(safe, 'cecelia_test'));
      assert.equal(await reachedBoundary(), false, 'unauthorized entry reached an external operation');
      assert.deepEqual(await psqlCalls(), []); assert.deepEqual(await dockerCalls(), []);
      assert.deepEqual(requests, []);
    });
  });
  test(`${name}: production connection refuses before any external operation`, async () => {
    await fixture(async ({ smoke, reachedBoundary, psqlCalls, requests }) => {
      await smoke(name, { ...connectionEnv(unsafe, 'cecelia'), SMOKE_ALLOW_WRITE: '1' });
      assert.equal(await reachedBoundary(), false, 'production connection reached an external operation');
      assert.deepEqual(await psqlCalls(), []); assert.deepEqual(requests, []);
    });
  });
  test(`${name}: checked safe connection reaches the controlled execution boundary`, async () => {
    await fixture(async ({ smoke, reachedBoundary, requests }) => {
      const result = await smoke(name, { ...connectionEnv(safe, 'cecelia_test'), SMOKE_ALLOW_WRITE: '1' });
      assert.equal(await reachedBoundary(), true, result.output);
      assert.ok(requests.some(req => req.url === '/api/brain/health'), 'entry did not verify live target identity');
    });
  });
}
for (const [name, overrides] of [
  ['autoblock-sql-param-fix-smoke.sh', { BRAIN_DB_URL: unsafe }],
  ['model-accounts-smoke.sh', { DATABASE_URL: '', DB_URL: unsafe, DB: safe }],
  ['script-executor-dispatch-smoke.sh', { SCRIPT_SMOKE_DB_URL: unsafe }],
  ['task-governance-guards-smoke.sh', { GOV_GUARD_SMOKE_DB_URL: unsafe }],
  ['task-run-primitive-smoke.sh', { TASK_RUN_SMOKE_DB_URL: unsafe }],
  ['account-quota-gate-smoke.sh', { PGDATABASE: 'cecelia' }],
  ['crontab-ledger-smoke.sh', { PGDATABASE: 'cecelia' }],
  ['openclaw-cron-ledger-smoke.sh', { PGDATABASE: 'cecelia' }],
  ['journeys-bizarea-smoke.sh', { DB_NAME: 'cecelia' }],
  ['t10-capture-atom-routing-smoke.sh', { DB_NAME: 'cecelia' }],
  ['preview-ledger-activate-smoke.sh', { DB_NAME: 'cecelia', PGDATABASE: 'cecelia_test' }],
  ['workflow-run-lost-deadline-smoke.sh', { DATABASE_URL: '', PGDATABASE: 'cecelia' }],
  ['c8a-harness-checkpoint-resume.sh', { CONTAINER_DATABASE_URL: unsafe }],
]) {
  test(`${name}: unused safe URI cannot hide the actual production connection`, async () => {
    await fixture(async ({ smoke, reachedBoundary, psqlCalls, requests }) => {
      await smoke(name, { ...connectionEnv(safe, 'cecelia_test'), SMOKE_ALLOW_WRITE: '1', ...overrides });
      assert.equal(await reachedBoundary(), false);
      assert.deepEqual(await psqlCalls(), []);
      assert.ok(requests.every(req => req.method === 'GET' && req.url === '/api/brain/health'));
    });
  });
}
