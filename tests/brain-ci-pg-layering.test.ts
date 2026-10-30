import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../packages/brain/src/db-config.js';
import { createTempMigratedDb } from '../packages/brain/src/__tests__/helpers/temp-migrated-db.js';
import { spawnSync } from 'node:child_process';
import glob from 'fast-glob';
import { commandsFor } from '../scripts/ci/run-basic-check.mjs';
import { planChecks } from '../scripts/ci/basic-scope.mjs';
import deepIntegrationConfig from '../scripts/ci/deep-integration.config.mjs';
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

describe('Brain PostgreSQL test layering', () => {
  it('keeps real PostgreSQL tests out of brain-unit', () => {
    const exclude = brainConfig.test?.exclude ?? [];

    expect(exclude).toEqual(expect.arrayContaining(POSTGRES_TESTS));
    expect(exclude).toContain('src/__tests__/integration/**');
  });

  it('真实PG历史回归留在深度集成配置，完整选择文件而非只登记名字', () => {
    const selected = glob.sync(deepIntegrationConfig.test.include, {
      cwd: join(REPO_ROOT, 'packages/brain'), ignore: deepIntegrationConfig.test.exclude,
    });
    for (const testPath of POSTGRES_TESTS) expect(selected).toContain(testPath);
  });

  it('基础runtime跑道必须先正式迁移，再调用真实服务任务验收', () => {
    expect(planChecks(['packages/brain/src/routes/tasks.js'])).toContainEqual({component: 'brain-integration'});
    const steps = commandsFor('brain-integration');
    expect(steps.map(step => ({command: step.command, args: step.args}))).toEqual([
      {command: 'node', args: ['scripts/ci/basic-runtime-smoke.mjs', '--validate-only']},
      {command: 'node', args: ['src/migrate.js']},
      {command: 'node', args: ['--test', 'scripts/ci/__tests__/runtime-signal.integration.test.mjs']},
      {command: 'node', args: ['scripts/ci/basic-runtime-smoke.mjs']},
    ]);
  });

  it.each([
    ['probe-targets-cells-smoke.sh', 'migration-496-probe-targets-cells.pg.integration.test.js'],
    ['vs-model-areas-kind-smoke.sh', 'migration-493-vs-model.pg.integration.test.js'],
    ['vs-model-spans-smoke.sh', 'migration-495-vs-model-spans.pg.integration.test.js'],
    ['vs-model-workflows-smoke.sh', 'migration-494-vs-model-workflows.pg.integration.test.js'],
  ])('Smoke Glob入口 %s 保留真PG过滤器并用集成配置', (script, filter) => {
    const source = readFileSync(join(REPO_ROOT, 'packages/brain/scripts/smoke', script), 'utf8');
    const invocation = source.match(/^[^\n]*npx vitest run[^\n]*$/m)?.[0] ?? '';
    expect(invocation).toContain('--config vitest.integration.config.js');
    expect(invocation).toContain('POSTGRES_INTEGRATION=1');
    expect(invocation).toContain(`src/__tests__/integration/${filter}`);
    expect(invocation).not.toContain('--passWithNoTests');
    expect(brainIntegrationConfig.test?.exclude).not.toContain(`src/__tests__/integration/${filter}`);
  });

  it('基础runtime真实入口在连接前拒绝生产库，不能连接现有Brain冒充测试成功', () => {
    const smoke = commandsFor('brain-integration').find(step =>
      step.args.includes('scripts/ci/basic-runtime-smoke.mjs') && !step.args.includes('--validate-only'));
    expect(smoke).toBeDefined();
    const result = spawnSync(process.execPath, smoke.args, {
      cwd: smoke.cwd, encoding: 'utf8',
      env: {...process.env, DATABASE_URL: 'postgresql://ci:isolated@127.0.0.1:1/cecelia'},
      timeout: 5000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('只允许本机专用 cecelia_scratch 数据库');
    expect(result.stderr).not.toContain('ECONNREFUSED');
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
