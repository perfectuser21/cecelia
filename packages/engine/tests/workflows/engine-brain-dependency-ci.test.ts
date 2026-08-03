import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve(process.cwd(), '../../.github/workflows/ci.yml'), 'utf8');

describe('Engine CI cross-workspace dependency setup', () => {
  it('installs Brain and Engine dependencies atomically before Engine tests import Brain contracts', () => {
    const engineJob = workflow.match(/^  engine-tests:\n([\s\S]*?)(?=^  [a-zA-Z0-9_-]+:\n)/m)?.[1] ?? '';
    const workspaceInstall = engineJob.indexOf(
      'npm ci --workspace=packages/brain --workspace=packages/engine --ignore-scripts',
    );
    const engineTests = engineJob.indexOf('npx vitest run');

    expect(workspaceInstall).toBeGreaterThanOrEqual(0);
    expect(engineJob).not.toContain('cd packages/engine && npm ci');
    expect(engineTests).toBeGreaterThan(workspaceInstall);
  });
});
