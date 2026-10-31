import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import unit from '../../vitest.config.js';
import integration from '../../vitest.integration.config.js';

const configUrl = new URL('../../vitest.real-env-smoke.config.js', import.meta.url);
const positivePath = 'src/__tests__/real-env/map-manifest-smoke.real-env.test.js';
describe('真实 Map Manifest smoke 的 CI 执行归属', () => {
  it('完整真实PG正例有独立配置且只有一个明确owner', async () => {
    expect(existsSync(configUrl), '真实PG正例不能仅排除或条件skip').toBe(true);
    const { default: config } = await import(fileURLToPath(configUrl));
    expect(config.test.include).toEqual([positivePath]);
    expect(config.test.exclude).not.toContain('src/__tests__/real-env/**');
    const positive = readFileSync(new URL('real-env/map-manifest-smoke.real-env.test.js', import.meta.url), 'utf8');
    expect(positive).toContain("expect.stringContaining('ALL PASS')");
    expect(positive).toContain('timeout: 30_000');
    expect(positive).not.toMatch(/skipIf|describe\.skip|it\.skip/);
  });
  it('普通unit/PG集成不执行已授权正例，但PG集成仍保留默认安全拒写验收', () => {
    expect(unit.test.exclude).toContain('src/__tests__/real-env/**');
    expect(integration.test.exclude).toContain('src/__tests__/real-env/**');
    expect(integration.test.exclude).not.toContain('src/__tests__/integration/**');
    const negative = readFileSync(new URL('integration/map-manifest-smoke.integration.test.js', import.meta.url), 'utf8');
    expect(negative).toContain('SMOKE_ALLOW_WRITE');
    expect(negative).toContain('existsSync(marker)');
  });
  it('专属正例有明确预算和独立owner，不重新执行572条串行smoke', () => {
    const workflow = yaml.load(readFileSync(new URL('../../../../.github/workflows/nightly-regression.yml', import.meta.url), 'utf8'));
    const job = workflow.jobs['real-env-smoke'];
    expect(job.if).toBeUndefined();
    expect(Number.isInteger(job['timeout-minutes'])).toBe(true);
    expect(job['timeout-minutes']).toBeGreaterThan(0);
    expect(job.steps.filter(step => step.run?.includes('--config vitest.real-env-smoke.config.js'))).toHaveLength(1);
    expect(job.steps.some(step => /run-smoke-ratchet|for .*scripts\/smoke/.test(step.run || ''))).toBe(false);
    expect(job.steps.some(step => step.uses?.includes('skills-source'))).toBe(false);
    for (const step of job.steps.filter(step => step.run))
      expect(spawnSync('bash', ['-n'], {input: step.run, encoding: 'utf8'}).status, step.name).toBe(0);
  });
  it('专属正例明确授权且普通PG无授权，实际cleanup仅操作专属容器', () => {
    const workflow = yaml.load(readFileSync(new URL('../../../../.github/workflows/nightly-regression.yml', import.meta.url), 'utf8'));
    const job = workflow.jobs['real-env-smoke'];
    const positive = job.steps.find(step => step.run?.includes('--config vitest.real-env-smoke.config.js'));
    expect(positive.env).toMatchObject({SMOKE_ALLOW_WRITE: '1', BRAIN_CONTAINER: 'cecelia-brain-smoke'});
    expect(job.services.postgres.env.POSTGRES_DB).toBe('cecelia_test');
    expect(workflow.jobs['brain-integration'].env.SMOKE_ALLOW_WRITE).toBeUndefined();
    expect(workflow.jobs['brain-integration'].steps.every(step => step.env?.SMOKE_ALLOW_WRITE === undefined)).toBe(true);
    const cleanup = job.steps.find(step => step.name === 'Cleanup brain container');
    expect(cleanup.if).toBe('always()');
    const temp = mkdtempSync(join(tmpdir(), 'map-ci-cleanup-'));
    const capture = join(temp, 'docker-commands');
    writeFileSync(join(temp, 'docker'), `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(process.env.CI_DOCKER_CAPTURE, JSON.stringify(process.argv.slice(2))+'\\n');\n`, {mode: 0o755});
    try {
      const result = spawnSync('bash', ['-c', cleanup.run], {encoding: 'utf8',
        env: {...process.env, PATH: `${temp}:${process.env.PATH}`, CI_DOCKER_CAPTURE: capture}});
      expect(result.status).toBe(0);
      expect(readFileSync(capture, 'utf8').trim().split('\n').map(line => JSON.parse(line)))
        .toEqual([['logs', 'cecelia-brain-smoke'], ['rm', '-f', 'cecelia-brain-smoke']]);
    } finally {rmSync(temp, {recursive: true, force: true});}
  });
});
