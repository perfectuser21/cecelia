import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

it('native entry executes immutable PF deadlock regression suite', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const suite = fileURLToPath(new URL('../../tests/regression/tailscale-us-exit/pf-identity-free.test.py', import.meta.url));
  expect(createHash('sha256').update(readFileSync(suite)).digest('hex')).toBe('f79b12301e1791e7d61ae8b0aa7a0f5b3fe0c399cdd402d8bbf8b36345a15ad5');
  const recovery = fileURLToPath(new URL('../../tests/regression/tailscale-us-exit/pf-recovery.test.py', import.meta.url));
  expect(createHash('sha256').update(readFileSync(recovery)).digest('hex')).toBe('09346ac3f4a44bde0304e12f4c61697458e3603b4d28271cbed5392bac87b0d4');
  const result = await promisify(execFile)('python3', [suite, '-v'], {
    cwd: root, timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  const output = result.stdout + result.stderr;
  expect(output).toMatch(/Ran 45 tests/);
  expect(output).toMatch(/\nOK(?: \(skipped=1\))?\s*$/);
  expect(output).not.toMatch(/FAILED|Traceback/);
}, 35_000);
