import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve(process.cwd(), '../../.github/workflows/ci.yml'), 'utf8');

describe('Engine CI cross-workspace dependency setup', () => {
  it('installs Brain and Engine dependencies atomically before Engine tests import Brain contracts', () => {
    const engineJob = workflow.match(/^  checks:\n([\s\S]*?)(?=^  [a-zA-Z0-9_-]+:\n)/m)?.[1] ?? '';
    const workspaceInstall = engineJob.indexOf(
      'npm ci --ignore-scripts',
    );
    const engineTests = engineJob.indexOf('node scripts/ci/run-basic-check.mjs');

    expect(workspaceInstall).toBeGreaterThanOrEqual(0);
    expect(engineJob).not.toContain('cd packages/engine && npm ci');
    expect(engineTests).toBeGreaterThan(workspaceInstall);
  });
});
