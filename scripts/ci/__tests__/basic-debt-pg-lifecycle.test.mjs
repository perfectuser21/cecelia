import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cleanProcessEnv } from '../private-pg-backend.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/pg-lifecycle-preload.cjs', import.meta.url));
function run(t, failConnect = false, files = ['packages/brain/src/__tests__/migration-015.test.js']) {
  const directory = mkdtempSync(join(tmpdir(), 'debt-pg-lifecycle-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const part of ['home', 'tmp']) mkdirSync(join(directory, part));
  const output = join(directory, 'report.json'), trace = join(directory, 'trace.json');
  const child = spawnSync(process.execPath, ['--require', fixture, join(root, 'scripts/ci/run-debt-pg.mjs'),
    '--native-bin', join(directory, 'fake-bin'), ...files.flatMap(file => ['--file', file]),
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

const manualFiles = ['rumination-dedup.test.js', 'initiative-orchestration-migration.test.js']
  .map(name => 'packages/brain/src/__tests__/' + name);
test('actual default CLI runs 43 current contracts and never invokes the two dormant contracts', t => {
  const { child, report, trace } = run(t, false, []);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(report.results.length, 43);
  assert.ok(trace.commands.filter(command => command.args.includes('--outputFile')).every(command => command.explicitFiles === '0'));
  for (const file of manualFiles) assert.equal(report.results.some(row => row.path === file), false);
  assert.ok(report.results.some(row => row.path.endsWith('/cortex-memory.test.js')));
  assert.equal(trace.commands.filter(command => command.args[0] === 'packages/brain/src/migrate.js').length, 1);
  assert.equal(trace.backendStopped, true);
});
for (const file of manualFiles) test(`actual explicit CLI still runs the preserved contract ${file}`, t => {
  const { child, report, trace } = run(t, false, [file]);
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(report.results.map(row => row.path), [file]);
  assert.ok(trace.commands.filter(command => command.args.includes('--outputFile')).every(command => command.explicitFiles === '1'));
  assert.equal(report.results[0].tests, 1); // Synthetic receipt proves runner selection/lifecycle, not PG assertions.
  assert.equal(trace.backendStopped, true);
});

for (const mutation of ['unknown-field', 'unknown-status', 'invalid-default', 'unknown-manifest-field'])
  test(`actual CLI rejects ${mutation} before starting any backend`, t => {
    const directory = realpathSync(mkdtempSync(join(tmpdir(), 'debt-pg-selection-invalid-')));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const put = (file, content) => { const path = join(directory, file);
      mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); return path; };
    for (const name of ['run-debt-pg.mjs', 'private-pg-backend.mjs', 'private-pg-contract.mjs'])
      put('scripts/ci/' + name, readFileSync(join(root, 'scripts/ci/' + name)));
    put('packages/brain/package.json', '{"type":"module"}');
    const row = { path: 'packages/brain/src/fixture.test.js', mode: 'empty', status: 'ready' };
    const manifest = { schema_version: 1, tests: [row] };
    if (mutation === 'unknown-field') row.defaut = false;
    if (mutation === 'unknown-status') row.status = 'dormant';
    if (mutation === 'invalid-default') row.default = 'false';
    if (mutation === 'unknown-manifest-field') manifest.fallback = true;
    put('scripts/ci/debt-pg-tests.json', JSON.stringify(manifest));
    put(row.path, '// file identity fixture; no test or database execution');
    const trace = join(directory, 'trace.json');
    const child = spawnSync(process.execPath, ['--require', fixture,
      join(directory, 'scripts/ci/run-debt-pg.mjs'), '--native-bin', join(directory, 'fake-bin')],
      { encoding: 'utf8', env: { ...cleanProcessEnv(directory),
        PG_LIFECYCLE_FAKE_BIN: join(directory, 'fake-bin'), PG_LIFECYCLE_TRACE: trace } });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /manifest.*invalid/i);
    assert.doesNotMatch(child.stderr, /SyntaxError|ERR_MODULE_NOT_FOUND/);
    assert.equal(JSON.parse(readFileSync(trace)).commands.length, 0, 'must reject before backend startup');
  });
