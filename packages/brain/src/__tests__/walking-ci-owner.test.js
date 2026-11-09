import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planChecks } from '../../../../scripts/ci/basic-scope.mjs';
import { checkResults, REQUIRED_JOBS } from '../../../../scripts/ci/check-basic-results.mjs';

const workflow = yaml.load(readFileSync(new URL('../../../../.github/workflows/nightly-regression.yml', import.meta.url), 'utf8'));
describe('Walking actual CI owner and PG acceptance', () => {
  it('旧样机退出nightly，真实消费者PG回归仍由集成目录发现', () => {
    expect(workflow.jobs['walking-ci-e2e']).toBeUndefined();
    expect(workflow.jobs['open-issue-on-failure'].needs).toEqual(['brain-integration', 'real-env-smoke']);
    expect(workflow.on.pull_request).toBeUndefined();
    expect(workflow.on.schedule).toHaveLength(1);
    expect(workflow.on).toHaveProperty('workflow_dispatch');
    const commands = workflow.jobs['brain-integration'].steps.map(step => step.run || '').join('\n');
    expect(commands).toContain('scripts/ci/deep-integration.config.mjs');
    const config = readFileSync(new URL('../../../../scripts/ci/deep-integration.config.mjs', import.meta.url), 'utf8');
    expect(config).toContain('src/**/integration/**/*.{test,spec}.?(c|m)[jt]s?(x)');
  });
  it.each(['success', 'failure', 'cancelled', 'skipped', 'timed_out', '', 'unknown'])('普通PR汇总严格检查实际checks结果 %j，独立demo不伪装required', result => {
    const needs = Object.fromEntries(REQUIRED_JOBS.map(job => [job, {result:job === 'checks' ? result : 'success'}]));
    if (result === 'success') expect(() => checkResults(needs)).not.toThrow();
    else expect(() => checkResults(needs)).toThrow();
    expect(planChecks([], {full: true}).some(row => row.component === 'walking-ci-e2e')).toBe(false);
  });
  it('实际目标拒绝守卫仍执行，缺失或生产checkpointer在HTTP前被拒', () => {
    const result = spawnSync(process.execPath, ['--test-reporter=tap', '--test', 'packages/brain/scripts/smoke/__tests__/walking-checkpointer-guard.node-test.mjs'], {
      cwd: fileURLToPath(new URL('../../../../', import.meta.url)), encoding: 'utf8', timeout: 20000,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/# pass 3\b/);
    expect(result.stdout).toMatch(/# fail 0\b/);
  }, 25000);
  it('two tracked threads require actual PG interrupt, final graph state and unique completion event', () => {
    const source = readFileSync(new URL('../../scripts/smoke/walking-skeleton-1node-smoke.sh', import.meta.url), 'utf8');
    expect(source).not.toContain('检测 endpoint 部署');
    expect(source).toContain('walking-ci-pg-state.mjs');
    expect(source).toContain('waiting'); expect(source).toContain('completed');
    expect(source).toContain('docker restart "$CONTAINER"');
    expect(source).not.toContain('docker compose');
    expect(source).toContain('260');
  });
});
