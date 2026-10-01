import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

// Execute the one permanent PostgreSQL suite through its real Vitest loader.
it('native entry executes the permanent PostgreSQL contract context suite', async () => {
  const brainRoot = fileURLToPath(new URL('../../packages/brain/', import.meta.url));
  const brainRequire = createRequire(new URL('../../packages/brain/package.json', import.meta.url));
  const cli = path.join(path.dirname(brainRequire.resolve('vitest/package.json')), 'vitest.mjs');
  const result = await promisify(execFile)(process.execPath, [
    cli, 'run', '--config', 'vitest.integration.config.js',
    'src/__tests__/integration/contract-task-context.pg.integration.test.js',
  ], {
    cwd: brainRoot, timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, DB_NAME: process.env.DB_NAME || 'cecelia_scratch', POSTGRES_INTEGRATION: '1' },
  });
  expect(result.stdout).toMatch(/Tests\s+13 passed \(13\)/);
}, 35_000);
