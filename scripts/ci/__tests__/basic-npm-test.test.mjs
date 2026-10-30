import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync(new URL('../../../packages/brain/package.json', import.meta.url)));

test('Brain 标准 npm test 入口也必须保留异常退出码', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ci-npm-entry-'));
  try {
    for (const executable of ['npx', 'vitest']) {
      writeFileSync(join(directory, executable), '#!/bin/sh\nprintf "Tests 1 passed (1)\\nUnhandled rejection\\n"\nexit 23\n', { mode: 0o755 });
    }
    const result = spawnSync('bash', ['-c', pkg.scripts.test], {
      cwd: directory, env: { ...process.env, PATH: `${directory}:${process.env.PATH}` }, encoding: 'utf8',
    });
    assert.equal(result.status, 23, result.stdout + result.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
