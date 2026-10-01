import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

it('native entry verifies canonical repository and legacy safeguards', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const req = createRequire(new URL('../../../packages/brain/package.json', import.meta.url));
  const cli = path.join(path.dirname(req.resolve('vitest/package.json')), 'vitest.mjs');
  const execute = promisify(execFile);
  const flow = await execute(process.execPath, [cli, 'run',
    'tests/gp/f1/step3-canonical-workspace-repo.test.js', '--maxWorkers=1', '--minWorkers=1'],
  { cwd: root, timeout: 30000, maxBuffer: 2097152 });
  expect(flow.stdout).toMatch(/Tests\s+1 passed \(1\)/);
  const result = await execute(process.execPath, [cli, 'run',
    'src/orchestrator/workspace-spec-canonical-repo.test.js', 'src/orchestrator/workspace-spec.test.js',
    '--maxWorkers=1', '--minWorkers=1'],
  { cwd: path.join(root, 'packages/brain'), timeout: 30000, maxBuffer: 2097152 });
  expect(result.stdout).toMatch(/Tests\s+84 passed \(84\)/);
}, 35000);
