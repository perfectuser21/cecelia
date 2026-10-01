import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

it('native entry executes all permanent PG cases under UTC and Shanghai without skips', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const req = createRequire(new URL('../../../packages/brain/package.json', import.meta.url));
  const cli = path.join(path.dirname(req.resolve('vitest/package.json')), 'vitest.mjs');
  const execute = promisify(execFile);
  for (const TZ of ['UTC', 'Asia/Shanghai']) {
    const result = await execute(process.execPath, [cli, 'run', '--config', 'vitest.integration.config.js',
      'src/__tests__/commander-watchdog.pg.integration.test.js', '--maxWorkers=1', '--minWorkers=1'], {
      cwd: path.join(root, 'packages/brain'), timeout: 30000, maxBuffer: 2097152,
      env: { ...process.env, TZ, POSTGRES_INTEGRATION: '1', DB_NAME: process.env.DB_NAME ?? 'cecelia_test' },
    });
    expect(result.stdout).toMatch(/Test Files\s+1 passed \(1\)/);
    expect(result.stdout).toMatch(/Tests\s+10 passed \(10\)/);
    expect(result.stdout).not.toMatch(/skipped/);
  }
}, 65000);
