import { it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

it('native entry executes rescan remote race regression without skips', async () => {
  const execute = promisify(execFile);
  const cwd = fileURLToPath(new URL('../../../', import.meta.url));
  const result = await execute('node', ['--test', 'scripts/__tests__/rescan-fixture-isolation.test.mjs'],
    { cwd, timeout: 55000, maxBuffer: 1024 * 1024 });
  expect(result.stdout).toMatch(/(?:# |ℹ )tests 1/);
  expect(result.stdout).toMatch(/(?:# |ℹ )pass 1/);
  expect(result.stdout).toMatch(/(?:# |ℹ )fail 0/);
  expect(result.stdout).toMatch(/(?:# |ℹ )skipped 0/);
}, 60000);
