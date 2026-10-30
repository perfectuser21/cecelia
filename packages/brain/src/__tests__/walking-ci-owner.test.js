import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planChecks } from '../../../../scripts/ci/basic-scope.mjs';
import { checkResults } from '../../../../scripts/ci/check-basic-results.mjs';

const workflow = yaml.load(readFileSync(new URL('../../../../.github/workflows/nightly-regression.yml', import.meta.url), 'utf8'));
describe('Walking actual CI owner and PG acceptance', () => {
  it('独立深度回归owner保留安全URI、socket和真实worker镜像', () => {
    const job = workflow.jobs['walking-ci-e2e'];
    expect(job).toBeDefined();
    const commands = job.steps.map(step => step.run || '').join('\n');
    expect(commands).toContain('DATABASE_URL'); expect(commands).toContain('/var/run/docker.sock');
    // worker 镜像本地名 alpine:latest 必须预先备好，且经镜像源拉取（不直连 Docker Hub，任务 7294cf3a）
    expect(commands).toContain('docker pull mirror.gcr.io/library/alpine:latest');
    expect(commands).toContain('docker tag mirror.gcr.io/library/alpine:latest alpine:latest');
    expect(commands).toContain('WALKING_CI_OWNER=1');
    expect(commands).toContain('walking-skeleton-1node-smoke.sh');
    expect(workflow.on.pull_request).toBeUndefined();
    expect(workflow.on.schedule).toHaveLength(1);
    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(job.steps.some(step => step.uses?.includes('skills-source'))).toBe(false);
    expect(job.env.DATABASE_URL).toBe('postgresql://cecelia:isolated-ci@localhost:5432/cecelia_test');
    expect(job.if).toBeUndefined();
    expect(commands).toContain('node --test packages/quality/tests/walking-checkpointer-guard.node-test.mjs');
  });
  it.each(['success', 'failure', 'cancelled', 'skipped', 'timed_out', '', 'unknown'])('普通PR汇总严格检查实际checks结果 %j，独立demo不伪装required', result => {
    const needs = {plan: {result: 'success'}, security: {result: 'success'}, checks: {result}};
    if (result === 'success') expect(() => checkResults(needs)).not.toThrow();
    else expect(() => checkResults(needs)).toThrow();
    expect(planChecks([], {full: true}).some(row => row.component === 'walking-ci-e2e')).toBe(false);
  });
  it('实际目标拒绝守卫仍执行，缺失或生产checkpointer在HTTP前被拒', () => {
    const command = workflow.jobs['walking-ci-e2e'].steps.find(step => step.name === 'Permanent actual target rejection regression');
    const [executable, ...args] = command.run.split(' ');
    const result = spawnSync(executable, ['--test-reporter=tap', ...args], {
      cwd: fileURLToPath(new URL('../../../../', import.meta.url)), encoding: 'utf8', timeout: 20000,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/# pass 3\b/);
    expect(result.stdout).toMatch(/# fail 0\b/);
  }, 25000);
  it('真实深度回归命令shell语法有效且只清理专属容器', () => {
    const job = workflow.jobs['walking-ci-e2e'];
    for (const step of job.steps.filter(step => step.run))
      expect(spawnSync('bash', ['-n'], {input: step.run, encoding: 'utf8'}).status, step.name).toBe(0);
    const cleanup = job.steps.find(step => step.name === 'Cleanup dedicated Brain fixture');
    expect(cleanup.if).toBe('always()');
    expect(cleanup.run).toContain('docker rm -f cecelia-brain-walking-ci');
  });
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
