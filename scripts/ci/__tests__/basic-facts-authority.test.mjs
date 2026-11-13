import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'facts-authority-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  for (const path of ['scripts/facts-check.mjs', 'scripts/check-version-sync.sh',
    '.github/workflows/scripts/lint-migration-unique-version.cjs', 'DEFINITION.md', '.brain-versions',
    'packages/brain/package.json', 'packages/brain/package-lock.json', 'packages/brain/server.js',
    'packages/brain/src/tick-loop.js', 'packages/brain/src/lib/task-type-registry.js',
    'packages/brain/src/thalamus.js', 'packages/brain/src/cortex.js', 'packages/brain/src/selfcheck.js',
    'packages/brain/migrations']) {
    mkdirSync(dirname(join(directory, path)), {recursive: true});
    cpSync(join(root, path), join(directory, path), {recursive: true});
  }
  const env = {PATH: process.env.PATH, HOME: directory, TMPDIR: directory};
  const run = (command, ...args) => {
    const result = spawnSync(command, args, {cwd: directory, env, encoding: 'utf8', timeout: 15000});
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    return {...result, output: result.stdout + result.stderr};
  };
  return {directory, run, facts: () => run(process.execPath, 'scripts/facts-check.mjs')};
}

test('实际事实入口保留其余事实与代码完整性，重复检查由独立权威承担', t => {
  const f = fixture(t), result = f.facts();
  assert.equal(result.status, 0, result.output);
  for (const fact of ['brain_port', 'tick_loop_ms', 'tick_interval_min', 'task_types',
    'action_count', 'cortex_extra_actions', 'schema_version', 'selfcheck_version_sync'])
    assert.match(result.output, new RegExp(fact + ':'));
  assert.doesNotMatch(result.output, /brain_version:|migration_conflicts:|llm_fetch_timeouts:|all external LLM fetch calls/);
});

test('重复迁移编号仅由更严的独立lint拒绝，保留非下划线数字前缀边界', t => {
  const f = fixture(t);
  assert.equal(f.run(process.execPath, '.github/workflows/scripts/lint-migration-unique-version.cjs').status, 0);
  for (const name of ['001_duplicate.sql', '001duplicate.sql']) {
    const path = join(f.directory, 'packages/brain/migrations', name);
    writeFileSync(path, '-- duplicate fixture\n');
    const result = f.run(process.execPath, '.github/workflows/scripts/lint-migration-unique-version.cjs');
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /001/);
    assert.equal(f.facts().status, 0, '事实入口不应重复接管编号唯一性');
    rmSync(path);
  }
});

test('文档版本漂移仅由完整版本同步入口拒绝', t => {
  const f = fixture(t), path = join(f.directory, 'DEFINITION.md');
  assert.equal(f.run('bash', 'scripts/check-version-sync.sh').status, 0);
  const original = readFileSync(path, 'utf8');
  const changed = original.replace(/(Brain\s+版本[^:]*:\s*)[^\s]+/, (_, prefix) => prefix + '999.0.0');
  assert.notEqual(changed, original);
  writeFileSync(path, changed);
  const result = f.run('bash', 'scripts/check-version-sync.sh');
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /DEFINITION\.md: 999\.0\.0/);
  assert.equal(f.facts().status, 0, '事实入口不应重复接管版本同步');
});

test('事实入口仍拒绝不存在的schema地板', t => {
  const f = fixture(t);
  const schema = join(f.directory, 'packages/brain/src/selfcheck.js');
  const original = readFileSync(schema, 'utf8');
  writeFileSync(schema, original.replace(/EXPECTED_SCHEMA_VERSION\s*=\s*'\d+'/, "EXPECTED_SCHEMA_VERSION = '999999'"));
  const floor = f.facts();
  assert.equal(floor.status, 1);
  assert.match(floor.output, /地板='999999' 超过最高 migration/);
  writeFileSync(schema, original);

});
