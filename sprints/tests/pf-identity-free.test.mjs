import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

it('native entry executes immutable PF deadlock regression suite', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const suite = fileURLToPath(new URL('../../tests/regression/tailscale-us-exit/pf-identity-free.test.py', import.meta.url));
  expect(createHash('sha256').update(readFileSync(suite)).digest('hex')).toBe('820974b05576124e2844e7821397ccf1908a0f46cae3169b1d2f22ddab69490e');
  const result = await promisify(execFile)('python3', [suite, '-v'], {
    cwd: root, timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  const output = result.stdout + result.stderr;
  expect(output).toMatch(/Ran 27 tests/);
  expect(output).toMatch(/\nOK(?: \(skipped=1\))?\s*$/);
  expect(output).not.toMatch(/FAILED|Traceback/);
}, 35_000);
