import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const quickcheck = readFileSync('scripts/quickcheck.sh', 'utf8');
const brainPackage = JSON.parse(readFileSync('packages/brain/package.json', 'utf8'));
const vitestConfig = readFileSync('packages/brain/vitest.config.js', 'utf8');
const okrIntegration = readFileSync(
  'packages/brain/src/__tests__/integration/okr-decomposition-flow.integration.test.js',
  'utf8',
);
const migrationIntegration = readFileSync(
  'packages/brain/src/__tests__/integration/kernel-release-runs.integration.test.js',
  'utf8',
);

describe('Draft PR #4457 DevOps blocker 合同 Red', () => {
  it('QuickCheck 未具备三条件 OOM 分类', async () => {
    expect(quickcheck).toMatch(/OOM|out of memory|Worker.*(?:exited|terminated)/i);
    expect(quickcheck).toMatch(/Tests?.*[0-9]+ passed/i);
    expect(quickcheck).toMatch(/Tests?.*[0-9]+ failed/i);
    expect(quickcheck).not.toMatch(/VITEST_OUT=.*\$\(/);
  });

  it('mutation seam 未完成双登记 ratchet', async () => {
    const seam = 'scripts/fleet-worker/github-mutation-equivalence-seam.test.cjs';
    expect(brainPackage.scripts['test:node']).toContain(seam);
    expect(vitestConfig).toContain(seam);
    expect(readFileSync(
      'packages/brain/src/__tests__/native-node-test-runner-registration.test.js',
      'utf8',
    )).toContain(seam);
  });

  it('OKR integration 仍依赖外部 Brain', async () => {
    expect(okrIntegration).toMatch(/supertest/);
    expect(okrIntegration).toMatch(/express\(/);
    expect(okrIntegration).not.toMatch(/\bBRAIN_URL\b|localhost:5221|brainAvailable|describe\.skip/);
    expect(okrIntegration).toMatch(/_test|cecelia_test/);
  });

  it('historical fixture 未显式排除 382', async () => {
    expect(migrationIntegration).toMatch(/369[\s\S]*381/);
    expect(migrationIntegration).toMatch(/not\.toContain\(['"]382['"]\)|includes\(['"]382['"]\).*false/);
  });
});
