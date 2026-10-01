import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../packages/brain/src/db-config.js';
import { createTempMigratedDb } from '../packages/brain/src/__tests__/helpers/temp-migrated-db.js';
import { parse } from 'yaml';
import brainConfig from '../packages/brain/vitest.config.js';
import brainIntegrationConfig from '../packages/brain/vitest.integration.config.js';
import { REPO_ROOT } from './helpers/repo-root.js';

const POSTGRES_TESTS = [
  'src/__tests__/integration/account-quota-ledger.pg.integration.test.js',
  'src/__tests__/integration/escalation-cancel-pending-sql.integration.test.js',
  'src/__tests__/commander-watchdog.pg.integration.test.js',
  'src/__tests__/integration/script-executor-chain.pg.integration.test.js',
  'src/__tests__/integration/script-executor-constraints.pg.integration.test.js',
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
    expect(exclude).toContain('src/__tests__/integration/**');
  });

  it('runs every excluded PostgreSQL test explicitly in brain-integration', () => {
    const integrationStep = workflow.jobs['brain-integration'].steps.find(
      (step: { name?: string }) => step.name === 'Integration Tests',
    );
    const integrationExclude = brainIntegrationConfig.test?.exclude ?? [];

    expect(integrationStep).toBeDefined();
    expect(integrationStep.env.POSTGRES_INTEGRATION).toBe('1');
    expect(integrationExclude).not.toContain('src/__tests__/integration/**');
    expect(integrationStep.run).toContain('--config vitest.integration.config.js');
    for (const testPath of POSTGRES_TESTS) {
      expect(integrationStep.run).toContain(testPath);
      expect(integrationExclude).not.toContain(testPath);
    }
  });
  it('E2E Smoke入口保留三条真PG过滤器并使用集成配置', () => {
    const smokeStep = workflow.jobs['e2e-smoke'].steps.find(
      (step: { name?: string }) => step.name?.startsWith('E2E Smoke Tests'),
    );
    expect(smokeStep).toBeDefined();
    expect(smokeStep.run).toContain('--config vitest.integration.config.js');
    expect(smokeStep.env.POSTGRES_INTEGRATION).toBe('1');
    expect(smokeStep.run).not.toContain('--passWithNoTests');
    for (const testPath of [
      'src/__tests__/integration/golden-path.integration.test.js',
      'src/__tests__/integration/agent-lifecycle.integration.test.js',
      'src/__tests__/integration/dev-task-lifecycle.e2e.test.js',
    ]) {
      expect(smokeStep.run).toContain(testPath);
      expect(brainIntegrationConfig.test?.exclude).not.toContain(testPath);
    }
  });

  it('guards migration fixtures before connecting outside the explicit CI PostgreSQL lane', () => {
    const helper = readFileSync(join(REPO_ROOT, 'packages/brain/src/__tests__/helpers/temp-migrated-db.js'), 'utf8');
    expect(helper).toMatch(/process\.env\.CI !== 'true'/);
    expect(helper).toMatch(/process\.env\.POSTGRES_INTEGRATION !== '1'/);
    expect(helper.indexOf('migration fixtures require CI PostgreSQL')).toBeLessThan(helper.indexOf('CREATE DATABASE'));
    expect(helper).toContain("DB_DEFAULTS.database === 'cecelia'");
  });

  it('拒绝本机、缺开关和生产库，保护在创建连接之前生效', async () => {
    const oldCI = process.env.CI;
    const oldPG = process.env.POSTGRES_INTEGRATION;
    const oldDB = DB_DEFAULTS.database;
    try {
      process.env.CI = 'false';
      process.env.POSTGRES_INTEGRATION = '1';
      await expect(createTempMigratedDb('blocked')).rejects.toThrow('migration fixtures require CI PostgreSQL');
      process.env.CI = 'true';
      delete process.env.POSTGRES_INTEGRATION;
      await expect(createTempMigratedDb('blocked')).rejects.toThrow('migration fixtures require CI PostgreSQL');
      process.env.POSTGRES_INTEGRATION = '1';
      DB_DEFAULTS.database = 'cecelia';
      await expect(createTempMigratedDb('blocked')).rejects.toThrow('migration fixtures reject production DB');
    } finally {
      if (oldCI === undefined) delete process.env.CI;
      else process.env.CI = oldCI;
      if (oldPG === undefined) delete process.env.POSTGRES_INTEGRATION;
      else process.env.POSTGRES_INTEGRATION = oldPG;
      DB_DEFAULTS.database = oldDB;
    }
  });

  it('quota and PREPARE fixtures use the guarded test DB configuration', () => {
    for (const file of ['account-quota-ledger.pg.integration.test.js', 'escalation-cancel-pending-sql.integration.test.js']) {
      const source = readFileSync(join(REPO_ROOT, 'packages/brain/src/__tests__/integration', file), 'utf8');
      expect(source).toContain("import { DB_DEFAULTS } from '../../db-config.js'");
      expect(source).not.toContain('connectionString:');
      if (file.startsWith('account-quota-ledger')) {
        expect(source).toContain("process.env.CI !== 'true'");
        expect(source).toContain("process.env.POSTGRES_INTEGRATION !== '1'");
      }
    }
  });
});
