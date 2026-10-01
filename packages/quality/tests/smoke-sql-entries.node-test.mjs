import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fixture, root, clientCommands } from './fixtures/smoke-production-guard-fixture.mjs';

const entries = JSON.parse(await readFile(resolve(root, 'packages/quality/smoke-sql-targets.json'), 'utf8'));
const safe = 'postgresql://localhost:5432/cecelia_test';
const unsafe = 'postgresql://localhost:5432/cecelia';

for (const weighted of ['harness-weighted-reservation-smoke.sh', 'managed-script-capacity-smoke.sh']) {
test(`${weighted} actual Node PG integration wrapper joins the live write inventory and classification`, async () => {
  const inventory = await readFile(resolve(root, 'packages/quality/smoke-write-targets.txt'), 'utf8');
  assert.ok(inventory.split('\n').includes(weighted), 'Node PG writes must not depend on literal psql discovery');
  assert.equal(entries[weighted]?.kind, 'write');
  assert.match(entries[weighted].connection, /TEST_DATABASE_URL.*DB_/);
  const source = await readFile(resolve(root, 'packages/brain/scripts/smoke', weighted), 'utf8');
  assert.match(source, /vitest\.integration\.config\.js/);
  assert.match(source, weighted.startsWith('harness-') ? /attempt-weighted-reservation\.pg\.integration\.test\.js/ : /script-capacity-reservation\.pg\.integration\.test\.js/);
  if (weighted.startsWith('managed-')) assert.match(source, /script-managed-executor\.pg\.integration\.test\.js/);
});

for (const [name, overrides, accepted] of [
  ['default', {}, false],
  ['production URI overrides safe DB_*', { SMOKE_ALLOW_WRITE: '1', TEST_DATABASE_URL: unsafe }, false],
  ['production DB_* fallback', { SMOKE_ALLOW_WRITE: '1', TEST_DATABASE_URL: '', DB_NAME: 'cecelia' }, false],
  ['remote same-name URI', { SMOKE_ALLOW_WRITE: '1', TEST_DATABASE_URL: 'postgresql://remote.invalid/cecelia_test' }, false],
  ['query host/port override', { SMOKE_ALLOW_WRITE: '1', TEST_DATABASE_URL: safe + '?host=remote.invalid&port=6543' }, false],
  ['socket production database', { SMOKE_ALLOW_WRITE: '1', TEST_DATABASE_URL: 'socket:/tmp/cecelia_test?db=cecelia' }, false],
  ['unknown safe suffix', { SMOKE_ALLOW_WRITE: '1', TEST_DATABASE_URL: 'postgresql://localhost:5432/unrelated_test' }, false],
  ['URI missing host uses PGHOST', { SMOKE_ALLOW_WRITE: '1', TEST_DATABASE_URL: 'postgresql:///cecelia_test', PGHOST: 'remote.invalid' }, false],
  ['URI missing port uses PGPORT', { SMOKE_ALLOW_WRITE: '1', TEST_DATABASE_URL: 'postgresql://localhost/cecelia_test', PGPORT: '6543' }, false],
  ['remote DB_* fallback', { SMOKE_ALLOW_WRITE: '1', TEST_DATABASE_URL: '', DB_HOST: 'remote.invalid' }, false],
  ['explicit safe URI ignores ineffective PG host/port', { SMOKE_ALLOW_WRITE: '1', PGHOST: 'remote.invalid', PGPORT: '6543' }, true],
  ['safe explicit DB_* fallback ignores ineffective PG host/port', { SMOKE_ALLOW_WRITE: '1', TEST_DATABASE_URL: '', PGHOST: 'remote.invalid', PGPORT: '6543' }, true],
  ['safe URI default port agrees with PGPORT', { SMOKE_ALLOW_WRITE: '1', TEST_DATABASE_URL: 'postgresql://localhost/cecelia_test', PGPORT: '5432' }, true],
  ['actual wrapper default DB_* overrides ineffective PG host/port', { SMOKE_ALLOW_WRITE: '1',
    TEST_DATABASE_URL: '', DB_NAME: '', DB_HOST: '', DB_PORT: '', PGHOST: 'remote.invalid', PGPORT: '6543' }, true],
]) {
  test(`${weighted} actual Node PG smoke target before Vitest execution: ${name}`, async () => {
    const temp = await mkdtemp(resolve(tmpdir(), 'weighted-smoke-boundary-'));
    const marker = resolve(temp, 'vitest-execution');
    const boundary = resolve(temp, 'boundary.sh');
    try {
      // Execute actual wrapper validation and guard; stop before dependency lookup or real PG suite.
      await writeFile(boundary, `set -T\ntrap 'case "$BASH_COMMAND" in exec\\ node*) printf reached > "$WEIGHTED_BOUNDARY"; exit 97;; esac' DEBUG\n`);
      await fixture(async ({ smoke, dockerCalls, psqlCalls, requests }) => {
        const result = await smoke(weighted, { BASH_ENV: boundary, WEIGHTED_BOUNDARY: marker,
          DB_NAME: 'cecelia_test', DB_HOST: 'localhost', DB_PORT: '5432', TEST_DATABASE_URL: safe,
          PGHOST: 'localhost', PGPORT: '5432', ...overrides });
        if (accepted) {
          assert.equal(result.code, 97, result.output); await readFile(marker);
          assert.ok(requests.some(req => req.url === '/api/brain/health'));
        } else {
          await assert.rejects(readFile(marker), { code: 'ENOENT' });
          if (!overrides.SMOKE_ALLOW_WRITE) {
            assert.deepEqual(await dockerCalls(), []); assert.deepEqual(requests, []);
          }
        }
        assert.deepEqual(await psqlCalls(), []);
        assert.ok((await dockerCalls()).every(args => ['context', 'inspect'].includes(args[0])), 'no Docker business operation');
        assert.ok(requests.every(req => req.method === 'GET' && req.url === '/api/brain/health'), 'no HTTP business write');
      });
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
}
}
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
  return { TEST_DATABASE_URL: connection, DATABASE_URL: connection, BRAIN_DB_URL: connection, DB_URL: connection, DB: connection,
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
