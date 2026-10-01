import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fixture, root } from './fixtures/smoke-production-guard-fixture.mjs';

const entries = JSON.parse(await readFile(resolve(root, 'packages/quality/smoke-sql-targets.json'), 'utf8'));
const safe = 'postgresql://localhost:5432/cecelia_test';
const unsafe = 'postgresql://localhost:5432/cecelia';
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
