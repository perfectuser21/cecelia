import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const workflow = readFileSync(path.join(root, '.github/workflows/nightly-regression.yml'), 'utf8');

function actualUnitStep() {
  const lines = workflow.split('\n');
  const name = lines.findIndex(line => line.trim() === '- name: Brain Unit Tests（全量 shard ${{ matrix.shard }}/6）');
  assert.notEqual(name, -1, '真实夜间测试步骤必须存在');
  const start = lines.findIndex((line, index) => index > name && line === '        run: |');
  assert.notEqual(start, -1);
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line && !line.startsWith('          ')) break;
    body.push(line.slice(10));
  }
  return body.join('\n').replaceAll('${{ matrix.shard }}', '1');
}

function runUnit({ code = 0, stdout = 'Tests 2 passed (2)\n', stderr = '', teeCode = 0 } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nightly-exit-'));
  try {
    mkdirSync(path.join(dir, 'packages/brain'), { recursive: true });
    mkdirSync(path.join(dir, 'bin'));
    writeFileSync(path.join(dir, 'bin/npx'), '#!' + process.execPath + '\nprocess.stdout.write(process.env.CASE_STDOUT); process.stderr.write(process.env.CASE_STDERR); process.exitCode=Number(process.env.CASE_CODE);\n', { mode: 0o755 });
    if (teeCode) {
      writeFileSync(path.join(dir, 'bin/tee'), '#!/bin/sh\ncat\nexit ' + teeCode + '\n', { mode: 0o755 });
    }
    return spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', actualUnitStep()], {
      cwd: dir,
      env: { ...process.env, PATH: path.join(dir, 'bin') + path.delimiter + process.env.PATH, CASE_CODE: String(code), CASE_STDOUT: stdout, CASE_STDERR: stderr },
      encoding: 'utf8',
      timeout: 10_000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('完整成功保持成功', () => assert.equal(runUnit().status, 0));
test('RPC中断且只有部分passed时保留非零退出', () => {
  const result = runUnit({ code: 1, stdout: 'Tests 1 passed (99)\n', stderr: 'Unhandled Error: Timeout calling onTaskUpdate\n' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
});
test('worker异常退出137不能由passed字样放行', () => assert.equal(runUnit({ code: 137 }).status, 137));
test('普通断言失败保留失败', () => assert.equal(runUnit({ code: 1, stdout: 'Tests 1 failed | 1 passed (2)\n' }).status, 1));
test('错误含NoTests及部分passed仍然失败', () => assert.equal(runUnit({ code: 1, stderr: 'No test files found\nUnhandled Error\n' }).status, 1));
test('完整夜间回归的空测试集合不能成功', () => assert.equal(runUnit({ code: 1, stdout: 'No test files found\n' }).status, 1));
test('tee写入失败必须传播', () => assert.equal(runUnit({ teeCode: 74 }).status, 74));
