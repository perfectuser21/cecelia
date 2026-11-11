'use strict';
const test = it;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = path.join(__dirname, 'attempt-limits-canary.cjs');
const localRequire = createRequire(filename);
test('failed real canary preserves Docker diagnostics without logging command credentials', async () => {
  const errors = [], childProcess = { env: {}, exitCode: 0 };
  const execFile = (_file, args, _options, callback) => {
    const absent = args[0] === 'inspect' || args[1] === 'inspect';
    const error = new Error('command included POSTGRES_PASSWORD=must-not-print');
    error.code = 1;
    error.stderr = absent ? 'No such container / network not found' : 'Docker daemon permission denied';
    callback(error, '', error.stderr);
  };
  await vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => name === 'node:child_process' ? { execFile }
      : name === './attempt-resources.cjs' ? { createAttemptResourceManager: options => ({
        provision: () => options.runCommand('docker', ['network', 'create']),
      }) } : localRequire(name),
    process: childProcess, console: { log() {}, error: (...args) => errors.push(args.join(' ')) },
  }, { filename });
  assert.equal(childProcess.exitCode, 1);
  assert.match(errors.join('\n'), /Docker daemon permission denied/);
  assert.doesNotMatch(errors.join('\n'), /must-not-print/);
});
