const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const HELPER = resolve(__dirname, 'raw-result-writer.cjs');
const RESULT_ROOT = '/tmp/cecelia-prompts';

function managedPath(attemptId) {
  return `${RESULT_ROOT}/${attemptId}.result.json`;
}

function runHelper({
  attemptId = randomUUID(),
  resultPath,
  input = '{"verdict":"DONE"}',
  resultFilePresence = 'value',
} = {}) {
  const path = resultPath ?? managedPath(attemptId);
  const env = {
    ...process.env,
    HARNESS_ATTEMPT_ID: attemptId,
  };
  if (resultFilePresence === 'value') env.BRAIN_RESULT_FILE = path;
  if (resultFilePresence === 'empty') env.BRAIN_RESULT_FILE = '';
  return {
    attemptId,
    path,
    execution: spawnSync('node', [HELPER], {
      env,
      input,
      encoding: 'utf8',
    }),
  };
}

function prepareRegular(path, mode = 0o600) {
  mkdirSync(RESULT_ROOT, { recursive: true });
  writeFileSync(path, '', { mode });
  chmodSync(path, mode);
}

function cleanup(path) {
  if (existsSync(path) || lstatSafe(path)?.isSymbolicLink()) unlinkSync(path);
}

function lstatSafe(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

test('managed writer requires BRAIN_RESULT_FILE to be present and non-empty', () => {
  for (const resultFilePresence of ['unset', 'empty']) {
    const run = runHelper({ resultFilePresence });
    assert.notEqual(run.execution.status, 0);
    assert.match(run.execution.stderr, /BRAIN_RESULT_FILE/);
  }
});

test('managed writer accepts only the exact attempt-owned runtime path', () => {
  const attemptId = randomUUID();
  for (const resultPath of [
    `/tmp/${attemptId}.result.json`,
    `${RESULT_ROOT}/${randomUUID()}.result.json`,
    `${RESULT_ROOT}/${attemptId}/../stolen.result.json`,
  ]) {
    const run = runHelper({ attemptId, resultPath });
    assert.notEqual(run.execution.status, 0);
    assert.match(run.execution.stderr, /path mismatch/);
  }
});

test('managed writer requires a precreated regular mode-0600 target and rejects symlinks', () => {
  mkdirSync(RESULT_ROOT, { recursive: true });

  const missing = runHelper();
  cleanup(missing.path);
  assert.notEqual(missing.execution.status, 0);
  assert.match(missing.execution.stderr, /precreated regular/);

  const loose = runHelper();
  prepareRegular(loose.path, 0o644);
  const looseResult = runHelper({
    attemptId: loose.attemptId,
    resultPath: loose.path,
  });
  assert.notEqual(looseResult.execution.status, 0);
  assert.match(looseResult.execution.stderr, /mode 0600/);
  cleanup(loose.path);

  const victim = `${RESULT_ROOT}/${randomUUID()}.victim.json`;
  writeFileSync(victim, '{"safe":true}\n', { mode: 0o600 });
  const linked = runHelper();
  symlinkSync(victim, linked.path);
  const linkedResult = runHelper({
    attemptId: linked.attemptId,
    resultPath: linked.path,
  });
  assert.notEqual(linkedResult.execution.status, 0);
  assert.match(linkedResult.execution.stderr, /precreated regular|symlink/);
  assert.equal(readFileSync(victim, 'utf8'), '{"safe":true}\n');
  assert.equal(lstatSync(linked.path).isSymbolicLink(), true);
  cleanup(linked.path);
  cleanup(victim);

  const fifo = runHelper();
  execFileSync('mkfifo', [fifo.path]);
  const fifoResult = runHelper({
    attemptId: fifo.attemptId,
    resultPath: fifo.path,
  });
  assert.notEqual(fifoResult.execution.status, 0);
  assert.match(fifoResult.execution.stderr, /precreated regular/);
  cleanup(fifo.path);
});

test('managed writer accepts only a bounded JSON object from stdin', () => {
  for (const input of [
    '',
    'not-json',
    '[]',
    'null',
    JSON.stringify({ value: 'x'.repeat(1024 * 1024) }),
  ]) {
    const run = runHelper({ input });
    prepareRegular(run.path);
    const result = runHelper({
      attemptId: run.attemptId,
      resultPath: run.path,
      input,
    });
    assert.notEqual(result.execution.status, 0);
    cleanup(run.path);
  }
});

test('validation failure preserves the old inode and removes every temp file', () => {
  const run = runHelper();
  prepareRegular(run.path);
  writeFileSync(run.path, '{"old":true}\n', { mode: 0o600 });
  const before = lstatSync(run.path);
  const tempPrefix = `.${run.attemptId}.result.json.tmp.`;
  const beforeTemps = readdirSync(RESULT_ROOT).filter((name) => name.startsWith(tempPrefix));

  const failed = runHelper({
    attemptId: run.attemptId,
    resultPath: run.path,
    input: 'not-json',
  });

  const after = lstatSync(run.path);
  const afterTemps = readdirSync(RESULT_ROOT).filter((name) => name.startsWith(tempPrefix));
  assert.notEqual(failed.execution.status, 0);
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino);
  assert.equal(readFileSync(run.path, 'utf8'), '{"old":true}\n');
  assert.deepEqual(afterTemps, beforeTemps);
  cleanup(run.path);
});

test('managed writer atomically replaces the precreated file, preserves 0600, and leaves no temp', () => {
  const payload = {
    verdict: 'PASS',
    task_id: '44444444-4444-4444-8444-444444444444',
    attempt_id: 'placeholder',
  };
  const run = runHelper();
  payload.attempt_id = run.attemptId;
  prepareRegular(run.path);
  const result = runHelper({
    attemptId: run.attemptId,
    resultPath: run.path,
    input: JSON.stringify(payload),
  });

  assert.equal(result.execution.status, 0, result.execution.stderr);
  assert.equal(result.execution.stdout, '');
  assert.deepEqual(JSON.parse(readFileSync(run.path, 'utf8')), payload);
  assert.equal(lstatSync(run.path).mode & 0o777, 0o600);
  assert.equal(
    readdirSync(RESULT_ROOT).some(
      (name) => name.startsWith(`.${run.attemptId}.result.json.tmp.`),
    ),
    false,
  );
  cleanup(run.path);
});
