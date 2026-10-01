import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

it('active-lock fixture isolates Docker failure and preserves real filesystem checks', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const own = mkdtempSync(join(tmpdir(), 'b9ce-docker-boundary-'));
  try {
    writeFileSync(join(own, 'docker'), `#!/bin/sh
if [ "$1" != ps ]; then exit 127; fi
if [ ! -f "$B9CE_DOCKER_COUNTER" ]; then
  : > "$B9CE_DOCKER_COUNTER"
  exit 124
fi
exit 0
`, { mode: 0o700 });
    const run = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'),
      'run', '../../tests/integration/startup-recovery-active-lock.test.js',
      '--maxWorkers=1', '--minWorkers=1'], {
      cwd: join(root, 'packages/brain'), encoding: 'utf8', timeout: 30000,
      env: { ...process.env, PATH: own + ':' + process.env.PATH,
        B9CE_DOCKER_COUNTER: join(own, 'counter'), DB_NAME: 'cecelia_scratch', DB: 'cecelia_scratch', TZ: 'UTC' },
    });
    expect(run.error, run.stderr).toBeUndefined();
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toContain('10 passed');
  } finally {
    rmSync(own, { recursive: true, force: true });
  }
}, 35000);
