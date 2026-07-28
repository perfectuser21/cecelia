const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const test = require('node:test');

const HELPER = resolve(__dirname, 'raw-result-writer.cjs');
const RESULT_ROOT = '/tmp/cecelia-prompts';
const CHANNEL_VERSION = 'attempt-result-file/v1';
const MAX_BYTES = 1024 * 1024;

function managedPath(attemptId) {
  return `${RESULT_ROOT}/${attemptId}.result.json`;
}

function runHelper({
  attemptId = randomUUID(),
  resultPath,
  input = '{"verdict":"DONE"}',
  resultFilePresence = 'value',
  channelVersionPresence = 'value',
  channelVersion = CHANNEL_VERSION,
  maxBytesPresence = 'value',
  maxBytes = String(MAX_BYTES),
} = {}) {
  const path = resultPath ?? managedPath(attemptId);
  const env = {
    ...process.env,
    HARNESS_ATTEMPT_ID: attemptId,
  };
  if (resultFilePresence === 'value') env.BRAIN_RESULT_FILE = path;
  if (resultFilePresence === 'empty') env.BRAIN_RESULT_FILE = '';
  if (resultFilePresence === 'unset') delete env.BRAIN_RESULT_FILE;
  if (channelVersionPresence === 'value') {
    env.BRAIN_RESULT_CHANNEL_VERSION = channelVersion;
  } else if (channelVersionPresence === 'empty') {
    env.BRAIN_RESULT_CHANNEL_VERSION = '';
  } else {
    delete env.BRAIN_RESULT_CHANNEL_VERSION;
  }
  if (maxBytesPresence === 'value') env.BRAIN_RESULT_MAX_BYTES = maxBytes;
  else if (maxBytesPresence === 'empty') env.BRAIN_RESULT_MAX_BYTES = '';
  else delete env.BRAIN_RESULT_MAX_BYTES;
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

test('managed writer requires channel v1 and a present non-empty BRAIN_RESULT_FILE', () => {
  for (const channel of [
    { channelVersionPresence: 'empty' },
    { channelVersion: 'attempt-result-file/v2' },
  ]) {
    const run = runHelper(channel);
    assert.notEqual(run.execution.status, 0);
    assert.match(run.execution.stderr, /BRAIN_RESULT_CHANNEL_VERSION/);
  }

  for (const resultFilePresence of ['unset', 'empty']) {
    const run = runHelper({ resultFilePresence });
    assert.notEqual(run.execution.status, 0);
    assert.match(run.execution.stderr, /BRAIN_RESULT_FILE/);
  }
});

test('managed writer requires a canonical strict positive max-bytes value no larger than 1 MiB', () => {
  for (const maxBytes of ['', '0', '-1', '1.5', '01', '+1', ' 1', '1048577']) {
    const run = runHelper({
      maxBytes,
      maxBytesPresence: maxBytes === '' ? 'empty' : 'value',
    });
    assert.notEqual(run.execution.status, 0);
    assert.match(run.execution.stderr, /BRAIN_RESULT_MAX_BYTES/);
  }
  const unset = runHelper({ maxBytesPresence: 'unset' });
  assert.notEqual(unset.execution.status, 0);
  assert.match(unset.execution.stderr, /BRAIN_RESULT_MAX_BYTES/);
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

test('managed writer enforces max bytes on both stdin and canonical encoded output', () => {
  const inputTooLarge = runHelper({ input: '{"a":1} ', maxBytes: '7' });
  prepareRegular(inputTooLarge.path);
  const inputResult = runHelper({
    attemptId: inputTooLarge.attemptId,
    resultPath: inputTooLarge.path,
    input: '{"a":1} ',
    maxBytes: '7',
  });
  assert.notEqual(inputResult.execution.status, 0);
  assert.match(inputResult.execution.stderr, /input.*7 bytes/);
  cleanup(inputTooLarge.path);

  const outputTooLarge = runHelper({ input: '{"a":1}', maxBytes: '7' });
  prepareRegular(outputTooLarge.path);
  const outputResult = runHelper({
    attemptId: outputTooLarge.attemptId,
    resultPath: outputTooLarge.path,
    input: '{"a":1}',
    maxBytes: '7',
  });
  assert.notEqual(outputResult.execution.status, 0);
  assert.match(outputResult.execution.stderr, /encoded.*7 bytes/);
  cleanup(outputTooLarge.path);
});

test('writer rejects malformed UTF-8 even when replacement decoding would form valid JSON', () => {
  const run = runHelper();
  prepareRegular(run.path);
  const result = runHelper({
    attemptId: run.attemptId,
    resultPath: run.path,
    input: Buffer.from([
      0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d,
    ]),
  });
  assert.notEqual(result.execution.status, 0);
  assert.match(result.execution.stderr, /UTF-8/);
  cleanup(run.path);
});

test('legacy writer atomically creates an arbitrary headed or relay path when channel version is unset', () => {
  const legacyRoot = mkdtempSync(join(tmpdir(), 'cecelia-legacy-result-'));
  try {
    const resultPath = join(legacyRoot, 'headed-result.json');
    const result = runHelper({
      resultPath,
      channelVersionPresence: 'unset',
      maxBytesPresence: 'unset',
      input: '{"verdict":"PASS"}',
    });
    assert.equal(result.execution.status, 0, result.execution.stderr);
    assert.deepEqual(JSON.parse(readFileSync(resultPath, 'utf8')), { verdict: 'PASS' });
    assert.equal(lstatSync(resultPath).mode & 0o777, 0o600);
  } finally {
    rmSync(legacyRoot, { recursive: true, force: true });
  }
});

test('legacy writer accepts an existing regular target but rejects symlinks and non-files', () => {
  const legacyRoot = mkdtempSync(join(tmpdir(), 'cecelia-legacy-existing-'));
  try {
    const regularPath = join(legacyRoot, 'regular.json');
    writeFileSync(regularPath, '{"old":true}\n', { mode: 0o644 });
    chmodSync(regularPath, 0o644);
    const regular = runHelper({
      resultPath: regularPath,
      channelVersionPresence: 'unset',
      maxBytesPresence: 'unset',
      input: '{"verdict":"PASS"}',
    });
    assert.equal(regular.execution.status, 0, regular.execution.stderr);
    assert.deepEqual(JSON.parse(readFileSync(regularPath, 'utf8')), { verdict: 'PASS' });
    assert.equal(lstatSync(regularPath).mode & 0o777, 0o600);

    const victimPath = join(legacyRoot, 'victim.json');
    const symlinkPath = join(legacyRoot, 'symlink.json');
    writeFileSync(victimPath, '{"safe":true}\n', { mode: 0o600 });
    symlinkSync(victimPath, symlinkPath);
    const symlink = runHelper({
      resultPath: symlinkPath,
      channelVersionPresence: 'unset',
      maxBytesPresence: 'unset',
    });
    assert.notEqual(symlink.execution.status, 0);
    assert.match(symlink.execution.stderr, /regular file|symlink/);
    assert.equal(readFileSync(victimPath, 'utf8'), '{"safe":true}\n');
    assert.equal(lstatSync(symlinkPath).isSymbolicLink(), true);

    const fifoPath = join(legacyRoot, 'result.fifo');
    execFileSync('mkfifo', [fifoPath]);
    const fifo = runHelper({
      resultPath: fifoPath,
      channelVersionPresence: 'unset',
      maxBytesPresence: 'unset',
    });
    assert.notEqual(fifo.execution.status, 0);
    assert.match(fifo.execution.stderr, /regular file/);
  } finally {
    rmSync(legacyRoot, { recursive: true, force: true });
  }
});

test('legacy writer treats set-empty BRAIN_RESULT_FILE as fatal and never invents a fallback', () => {
  for (const resultFilePresence of ['empty', 'unset']) {
    const run = runHelper({
      resultFilePresence,
      channelVersionPresence: 'unset',
      maxBytesPresence: 'unset',
    });
    assert.notEqual(run.execution.status, 0);
    assert.match(run.execution.stderr, /BRAIN_RESULT_FILE/);
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
