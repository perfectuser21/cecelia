import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

it('native entry verifies authenticated recovery and original guard', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const req = createRequire(new URL('../../../packages/brain/package.json', import.meta.url));
  const cli = path.join(path.dirname(req.resolve('vitest/package.json')), 'vitest.mjs');
  const execute = promisify(execFile);
  const gp = await execute(process.execPath, [cli,'run','tests/gp/f1/step1-controlled-recovery.test.js',
    '--maxWorkers=1','--minWorkers=1'], {cwd:root,timeout:30000,maxBuffer:2097152});
  expect(gp.stdout).toMatch(/Tests\s+1 passed \(1\)/);
  const unit = await execute(process.execPath, [cli,'run',
    'src/orchestrator/__tests__/recovery-rebase.test.js','src/orchestrator/__tests__/kernel-run-store.test.js',
    'src/__tests__/relay-runs-canonical-create.test.js','src/orchestrator/preflight/base-sha-reanchor.test.js',
    '--maxWorkers=1','--minWorkers=1'], {cwd:path.join(root,'packages/brain'),timeout:30000,maxBuffer:2097152});
  expect(unit.stdout).toMatch(/Test Files\s+4 passed \(4\)/);
},65000);
