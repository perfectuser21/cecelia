import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve(process.cwd(), '../../.github/workflows/ci.yml'), 'utf8');

describe('Engine CI cross-workspace dependency setup', () => {
  it('installs Brain workspace dependencies before Engine tests import Brain contracts', () => {
    const engineJob = workflow.match(/^  engine-tests:\n([\s\S]*?)(?=^  [a-zA-Z0-9_-]+:\n)/m)?.[1] ?? '';
    const brainInstall = engineJob.indexOf('npm ci --workspace=packages/brain');
    const engineTests = engineJob.indexOf('npx vitest run');

    expect(brainInstall).toBeGreaterThanOrEqual(0);
    expect(engineTests).toBeGreaterThan(brainInstall);
  });
});
