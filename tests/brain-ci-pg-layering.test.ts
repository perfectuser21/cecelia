import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import brainConfig from '../packages/brain/vitest.config.js';
import brainIntegrationConfig from '../packages/brain/vitest.integration.config.js';
import { REPO_ROOT } from './helpers/repo-root.js';

const POSTGRES_TESTS = [
  'src/__tests__/migration-333.test.js',
  '../../tests/regression/relay-137fea96/contract-postdeploy-smoke-filter.test.ts',
];

const workflow = parse(
  readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8'),
);

describe('Brain PostgreSQL test layering', () => {
  it('keeps real PostgreSQL tests out of brain-unit', () => {
    const exclude = brainConfig.test?.exclude ?? [];

    expect(exclude).toEqual(expect.arrayContaining(POSTGRES_TESTS));
  });

  it('runs every excluded PostgreSQL test explicitly in brain-integration', () => {
    const integrationStep = workflow.jobs['brain-integration'].steps.find(
      (step: { name?: string }) => step.name === 'Integration Tests',
    );
    const integrationExclude = brainIntegrationConfig.test?.exclude ?? [];

    expect(integrationStep).toBeDefined();
    expect(integrationStep.run).toContain('--config vitest.integration.config.js');
    for (const testPath of POSTGRES_TESTS) {
      expect(integrationStep.run).toContain(testPath);
      expect(integrationExclude).not.toContain(testPath);
    }
  });
});
