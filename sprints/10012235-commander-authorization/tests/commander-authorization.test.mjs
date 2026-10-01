import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

it('native entry executes permanent task authorization and secret rejection suites', async () => {
  const brainRoot = fileURLToPath(new URL('../../../packages/brain/', import.meta.url));
  const brainRequire = createRequire(new URL('../../../packages/brain/package.json', import.meta.url));
  const cli = path.join(path.dirname(brainRequire.resolve('vitest/package.json')), 'vitest.mjs');
  const result = await promisify(execFile)(process.execPath, [
    cli, 'run',
    'src/orchestrator/__tests__/commander-profile.test.js',
    'src/orchestrator/__tests__/commander-contract.test.js',
    'src/orchestrator/__tests__/commander-bundle.test.js',
    'src/orchestrator/__tests__/commander-store.test.js',
    '--maxWorkers=1', '--minWorkers=1',
  ], { cwd: brainRoot, timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, DB_NAME: 'cecelia_scratch' },
  });
  expect(result.stdout).toMatch(/Test Files\s+4 passed \(4\)/);
  const assertions = result.stdout.match(/Tests\s+(\d+) passed \((\d+)\)/);
  expect(assertions).not.toBeNull();
  expect(Number(assertions[1])).toBeGreaterThanOrEqual(4);
  expect(assertions[1]).toBe(assertions[2]);
}, 35_000);
