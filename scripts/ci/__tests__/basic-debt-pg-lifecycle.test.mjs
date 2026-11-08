import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cleanProcessEnv } from '../private-pg-backend.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/pg-lifecycle-preload.cjs', import.meta.url));
function run(t, failConnect = false) {
  const directory = mkdtempSync(join(tmpdir(), 'debt-pg-lifecycle-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const part of ['home', 'tmp']) mkdirSync(join(directory, part));
  const output = join(directory, 'report.json'), trace = join(directory, 'trace.json');
  const child = spawnSync(process.execPath, ['--require', fixture, join(root, 'scripts/ci/run-debt-pg.mjs'),
    '--native-bin', join(directory, 'fake-bin'), '--file', 'packages/brain/src/__tests__/migration-015.test.js',
    '--output', output], { cwd: root, encoding: 'utf8', timeout: 30000,
    env: { ...cleanProcessEnv(directory), PG_LIFECYCLE_FAKE_BIN: join(directory, 'fake-bin'),
      PG_LIFECYCLE_TRACE: trace, ...(failConnect ? { PG_LIFECYCLE_CONNECT_FAIL: '1' } : {}) } });
  return { child, report: JSON.parse(readFileSync(output, 'utf8')),
    trace: JSON.parse(readFileSync(trace, 'utf8')) };
}

test('actual private-PG CLI waits for identity connection end before force DROP', t => {
  const { child, report, trace } = run(t);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(report.status, 'passed');
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].tests, 1); // Synthetic receipt: only runner lifecycle is under test.
  assert.equal(trace.drops, 1);
  assert.equal(trace.backendStopped, true);
  assert.ok(trace.identity.length > 0 && trace.identity.every(client => client.closed));
});

test('identity connection failure remains failed, writes a receipt and still closes owned backend', t => {
  const { child, report, trace } = run(t, true);
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /synthetic identity connect failed/);
  assert.equal(report.status, 'failed');
  assert.equal(trace.drops, 0);
  assert.equal(trace.backendStopped, true);
});
